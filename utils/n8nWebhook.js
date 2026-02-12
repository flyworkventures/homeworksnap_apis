/**
 * n8n Webhook Utility
 * Handles communication with n8n workflows
 */

const axios = require('axios');
const logger = require('./logger');

/**
 * Ensure string is properly UTF-8 encoded
 * Recursively processes objects and arrays to ensure all strings are UTF-8
 * @param {any} data - Data to encode
 * @returns {any} UTF-8 encoded data
 */
function ensureUTF8(data) {
  if (data === null || data === undefined) {
    return data;
  }
  
  if (typeof data === 'string') {
    // Ensure string is properly UTF-8 encoded
    // If string contains mojibake (corrupted characters), try to fix
    try {
      // Check if string contains common mojibake patterns
      if (data.includes('?') && /[ğüşıöçĞÜŞİÖÇ]/.test(data)) {
        // String might be corrupted, try to fix
        // Convert to buffer and back to ensure UTF-8
        const buffer = Buffer.from(data, 'utf8');
        return buffer.toString('utf8');
      }
      // If no corruption detected, return as is
      return data;
    } catch (e) {
      logger.warn('Error ensuring UTF-8 encoding:', e.message);
      return data;
    }
  } else if (Array.isArray(data)) {
    return data.map(item => ensureUTF8(item));
  } else if (data && typeof data === 'object') {
    const result = {};
    for (const key in data) {
      if (data.hasOwnProperty(key)) {
        result[key] = ensureUTF8(data[key]);
      }
    }
    return result;
  }
  return data;
}

/**
 * Retry wrapper for webhook calls
 * @param {Function} webhookFunction - Webhook function to retry
 * @param {number} maxRetries - Maximum number of retries (default: 3)
 * @param {number} baseDelay - Base delay in milliseconds (default: 2000)
 * @returns {Promise<Object>} Webhook result
 */
async function retryWebhook(webhookFunction, maxRetries = 3, baseDelay = 2000) {
  let lastError = null;
  
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      const result = await webhookFunction();
      
      // If successful, return immediately
      if (result.success) {
        if (attempt > 0) {
          logger.info(`Webhook succeeded on retry attempt ${attempt + 1}`);
        }
        return result;
      }
      
      // If failed but not an error (e.g., empty response), don't retry
      if (result.error && !result.error.includes('timeout') && !result.error.includes('ECONNREFUSED') && 
          !result.error.includes('ENOTFOUND') && result.status !== 500 && result.status !== 502 && 
          result.status !== 503 && result.status !== 504) {
        logger.warn(`Webhook returned non-retryable error: ${result.error}`);
        return result;
      }
      
      lastError = result;
      
      // If this is not the last attempt, wait before retrying
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt); // Exponential backoff
        logger.info(`Webhook failed, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries})`);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    } catch (error) {
      lastError = {
        success: false,
        error: error.message,
        code: error.code || 'UNKNOWN_ERROR',
      };
      
      // If this is not the last attempt, wait before retrying
      if (attempt < maxRetries) {
        const delay = baseDelay * Math.pow(2, attempt); // Exponential backoff
        logger.info(`Webhook error, retrying in ${delay}ms (attempt ${attempt + 1}/${maxRetries}):`, error.message);
        await new Promise(resolve => setTimeout(resolve, delay));
      }
    }
  }
  
  logger.error(`Webhook failed after ${maxRetries + 1} attempts`);
  return lastError || { success: false, error: 'Max retries exceeded' };
}

/**
 * Send homework image to n8n webhook (with retry)
 * @param {string} imageUrl - CDN URL of the homework image
 * @param {string} userId - User ID
 * @param {string} chatId - Chat ID (optional, for new chats)
 * @param {number} maxRetries - Maximum retry attempts (default: 3)
 * @returns {Promise<Object>} n8n response
 */
async function sendHomeworkImageToWebhook(imageUrl, userId, chatId = null, maxRetries = 3) {
  return retryWebhook(async () => {
    return await sendHomeworkImageToWebhookInternal(imageUrl, userId, chatId);
  }, maxRetries);
}

/**
 * Internal function to send homework image to n8n webhook (without retry)
 * @param {string} imageUrl - CDN URL of the homework image
 * @param {string} userId - User ID
 * @param {string} chatId - Chat ID (optional, for new chats)
 * @returns {Promise<Object>} n8n response
 */
async function sendHomeworkImageToWebhookInternal(imageUrl, userId, chatId = null) {
  const webhookUrl = process.env.N8N_WEBHOOK_URL_HOMEWORK_IMAGE;
  
  if (!webhookUrl) {
    logger.error('N8N_WEBHOOK_URL_HOMEWORK_IMAGE is not configured');
    return {
      success: false,
      error: 'N8N_WEBHOOK_URL_HOMEWORK_IMAGE is not configured',
      code: 'CONFIG_ERROR',
    };
  }

  try {

    const payload = {
      imageUrl,
      userId,
      chatId,
      timestamp: new Date().toISOString(),
    };

    logger.info(`Sending homework image to n8n webhook: ${webhookUrl}`);
    logger.info(`Payload:`, { imageUrl, userId, chatId });

    const response = await axios.post(webhookUrl, payload, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Accept': 'application/json; charset=utf-8',
        'Accept-Charset': 'utf-8',
      },
      timeout: 180000, // 3 minutes timeout (AI analiz işlemi uzun sürebilir)
      responseType: 'json',
      responseEncoding: 'utf8',
      validateStatus: function (status) {
        return status >= 200 && status < 500;
      },
    });

    logger.info(`n8n webhook response status: ${response.status}`);
    logger.info(`n8n webhook response data:`, JSON.stringify(response.data).substring(0, 500));

    if (response.status >= 200 && response.status < 300) {
      // Check if response.data exists and has content
      if (!response.data) {
        logger.warn('n8n webhook returned empty response data');
        return {
          success: false,
          error: 'Empty response from n8n webhook',
          status: response.status,
        };
      }
      
      // Ensure UTF-8 encoding for all response data
      const utf8Data = ensureUTF8(response.data);
      
      logger.info('n8n webhook response processed:', {
        hasData: !!utf8Data,
        dataType: typeof utf8Data,
        isArray: Array.isArray(utf8Data),
        keys: utf8Data && typeof utf8Data === 'object' ? Object.keys(utf8Data) : null,
      });
      
      return {
        success: true,
        data: utf8Data,
        status: response.status,
      };
    } else {
      logger.warn(`n8n webhook returned non-success status: ${response.status}`, {
        status: response.status,
        data: response.data,
      });
      return {
        success: false,
        error: response.data || 'Unknown error',
        status: response.status,
      };
    }
  } catch (error) {
    logger.error('n8n webhook error:', {
      message: error.message,
      code: error.code,
      response: error.response ? {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data,
      } : null,
      stack: error.stack,
    });

    // Don't throw error, return error object instead
    if (error.code === 'ECONNABORTED') {
      return {
        success: false,
        error: 'n8n webhook timeout - request took too long',
        code: 'TIMEOUT',
      };
    }

    if (error.response) {
      return {
        success: false,
        error: `n8n webhook error: ${error.response.status} - ${JSON.stringify(error.response.data)}`,
        status: error.response.status,
        code: 'HTTP_ERROR',
      };
    }

    return {
      success: false,
      error: `Failed to send request to n8n webhook: ${error.message}`,
      code: error.code || 'UNKNOWN_ERROR',
    };
  }
}

/**
 * Send chat message to n8n webhook for AI response (with retry)
 * @param {string} chatId - Chat ID
 * @param {string} message - User message
 * @param {Array} messageHistory - Previous messages in the chat
 * @param {number} maxRetries - Maximum retry attempts (default: 3)
 * @returns {Promise<Object>} n8n response with AI answer
 */
async function sendChatMessageToWebhook(chatId, message, messageHistory = [], maxRetries = 3) {
  return retryWebhook(async () => {
    return await sendChatMessageToWebhookInternal(chatId, message, messageHistory);
  }, maxRetries);
}

/**
 * Internal function to send chat message to n8n webhook (without retry)
 * @param {string} chatId - Chat ID
 * @param {string} message - User message
 * @param {Array} messageHistory - Previous messages in the chat
 * @returns {Promise<Object>} n8n response with AI answer
 */
async function sendChatMessageToWebhookInternal(chatId, message, messageHistory = []) {
  const webhookUrl = process.env.N8N_WEBHOOK_URL_CHAT;
  
  if (!webhookUrl || webhookUrl.trim() === '') {
    logger.error('N8N_WEBHOOK_URL_CHAT is not configured or is empty');
    return {
      success: false,
      error: 'N8N_WEBHOOK_URL_CHAT is not configured',
      code: 'CONFIG_ERROR',
    };
  }

  try {
    const payload = {
      chatId,
      message,
      messageHistory,
      timestamp: new Date().toISOString(),
    };

    logger.info(`Sending chat message to n8n webhook: ${webhookUrl}`);
    logger.info(`Payload:`, { 
      chatId, 
      message: message.substring(0, 100), // Log first 100 chars
      messageHistoryLength: messageHistory.length 
    });

    const response = await axios.post(webhookUrl, payload, {
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        'Accept': 'application/json; charset=utf-8',
        'Accept-Charset': 'utf-8',
      },
      timeout: 120000, // 2 minutes timeout for AI chat responses
      responseType: 'json',
      responseEncoding: 'utf8',
      validateStatus: function (status) {
        return status >= 200 && status < 500;
      },
    });

    logger.info(`n8n chat webhook response status: ${response.status}`);
    logger.info(`n8n chat webhook response data:`, JSON.stringify(response.data).substring(0, 500));

    if (response.status >= 200 && response.status < 300) {
      // Ensure UTF-8 encoding for all response data
      const utf8Data = ensureUTF8(response.data);
      
      logger.info('n8n chat webhook response processed:', {
        hasData: !!utf8Data,
        dataType: typeof utf8Data,
      });
      
      return {
        success: true,
        data: utf8Data,
        status: response.status,
      };
    } else {
      logger.warn(`n8n webhook returned non-success status: ${response.status}`);
      return {
        success: false,
        error: response.data || 'Unknown error',
        status: response.status,
      };
    }
  } catch (error) {
    logger.error('n8n chat webhook error:', {
      message: error.message,
      code: error.code,
      webhookUrl: webhookUrl,
      chatId: chatId,
      response: error.response ? {
        status: error.response.status,
        statusText: error.response.statusText,
        data: error.response.data,
      } : null,
      stack: error.stack,
    });

    // Don't throw error, return error object instead (for retry mechanism)
    if (error.code === 'ECONNABORTED') {
      return {
        success: false,
        error: 'n8n webhook timeout - request took too long',
        code: 'TIMEOUT',
      };
    }

    if (error.code === 'ECONNREFUSED') {
      return {
        success: false,
        error: 'n8n webhook connection refused - server may be down',
        code: 'CONNECTION_REFUSED',
      };
    }

    if (error.code === 'ENOTFOUND') {
      return {
        success: false,
        error: `n8n webhook host not found: ${webhookUrl}`,
        code: 'HOST_NOT_FOUND',
      };
    }

    if (error.response) {
      return {
        success: false,
        error: `n8n webhook error: ${error.response.status} - ${JSON.stringify(error.response.data)}`,
        status: error.response.status,
        code: 'HTTP_ERROR',
      };
    }

    return {
      success: false,
      error: `Failed to send request to n8n webhook: ${error.message}`,
      code: error.code || 'UNKNOWN_ERROR',
    };
  }
}

module.exports = {
  sendHomeworkImageToWebhook,
  sendChatMessageToWebhook,
};
