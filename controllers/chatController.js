/**
 * Chat Controller
 * Handles AI chat functionality
 */

const db = require('../config/database');
const logger = require('../utils/logger');
const { sendChatMessageToWebhook } = require('../utils/n8nWebhook');
const { resolveUserLang } = require('../utils/userLang');

/**
 * Get user's chats
 * GET /api/chats
 */
const getChats = async (req, res, next) => {
  try {
    const { uid } = req.user;

    const users = await db.query(
      'SELECT id FROM users WHERE uid = ? AND is_active = TRUE',
      [uid]
    );

    if (!users || users.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    const userId = users[0].id;

    const chats = await db.query(
      `SELECT 
        c.id,
        c.title,
        c.homework_image_id,
        c.status,
        c.created_at,
        c.updated_at,
        hi.image_url as homework_image_url
       FROM chats c
       LEFT JOIN homework_images hi ON c.homework_image_id = hi.id
       WHERE c.user_id = ? AND c.status != 'deleted'
       ORDER BY c.updated_at DESC`,
      [userId]
    );

    res.json({
      success: true,
      data: {
        chats: chats.map(chat => ({
          id: chat.id,
          title: chat.title,
          homeworkImageId: chat.homework_image_id,
          homeworkImageUrl: chat.homework_image_url || null,
          status: chat.status,
          createdAt: chat.created_at,
          updatedAt: chat.updated_at,
        })),
        count: chats.length,
      },
    });
  } catch (error) {
    logger.error('Get chats error:', error);
    next(error);
  }
};

/**
 * Get chat by ID with messages
 * GET /api/chats/:id
 */
const getChatById = async (req, res, next) => {
  try {
    const { uid } = req.user;
    const { id } = req.params;

    const users = await db.query(
      'SELECT id FROM users WHERE uid = ? AND is_active = TRUE',
      [uid]
    );

    if (!users || users.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    const userId = users[0].id;

    const chats = await db.query(
      `SELECT * FROM chats WHERE id = ? AND user_id = ? AND status != 'deleted'`,
      [id, userId]
    );

    if (!chats || chats.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Chat not found',
        code: 'NOT_FOUND',
      });
    }

    const chat = chats[0];

    // Get messages
    const messages = await db.query(
      `SELECT 
        id,
        role,
        content,
        image_url,
        message_data,
        created_at
       FROM chat_messages
       WHERE chat_id = ?
       ORDER BY created_at ASC`,
      [id]
    );

    // Format messages with sender and structured message data
    const formattedMessages = messages.map(msg => {
      const baseMessage = {
        id: msg.id || 0,
        sender: (msg.role === 'user' ? 'user' : 'bot'),
        timestamp: msg.created_at || new Date().toISOString(),
        imageUrl: msg.image_url || null,
      };

      if (msg.role === 'user') {
        // User message: simple string
        return {
          ...baseMessage,
          message: msg.content || '',
        };
      } else {
        // Bot message: structured object if message_data exists, otherwise string
        if (msg.message_data) {
          try {
            const messageData = JSON.parse(msg.message_data);
            // Only return structured object if it has at least one field
            if (messageData.question || messageData.solution_steps || messageData.final_answer || 
                messageData.explanation || messageData.lesson) {
              return {
                ...baseMessage,
                message: {
                  question: messageData.question || null,
                  solution_steps: messageData.solution_steps || null,
                  final_answer: messageData.final_answer || null,
                  explanation: messageData.explanation || null,
                  lesson: messageData.lesson || null,
                },
              };
            } else {
              // Empty structured object, fallback to content
              return {
                ...baseMessage,
                message: msg.content || '',
              };
            }
          } catch (e) {
            // Fallback to content if JSON parse fails
            return {
              ...baseMessage,
              message: msg.content || '',
            };
          }
        } else {
          // Fallback to content if no message_data
          return {
            ...baseMessage,
            message: msg.content || '',
          };
        }
      }
    });

    res.json({
      success: true,
      data: {
        chat: {
          id: chat.id,
          title: chat.title,
          homeworkImageId: chat.homework_image_id,
          homeworkImageUrl: chat.homework_image_url || null,
          status: chat.status,
          messages: formattedMessages,
          createdAt: chat.created_at,
          updatedAt: chat.updated_at,
        },
      },
    });
  } catch (error) {
    logger.error('Get chat by ID error:', error);
    next(error);
  }
};

/**
 * Send message to chat
 * POST /api/chats/:id/messages
 * Body: { message: string, language?: string }
 */
const sendMessage = async (req, res, next) => {
  try {
    const { uid } = req.user;
    const { id } = req.params;
    const { message } = req.body;
    const userLang = resolveUserLang(req);

    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return res.status(400).json({
        success: false,
        error: 'Message is required and must be a non-empty string',
        code: 'VALIDATION_ERROR',
      });
    }

    const users = await db.query(
      'SELECT id FROM users WHERE uid = ? AND is_active = TRUE',
      [uid]
    );

    if (!users || users.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    const userId = users[0].id;

    // Verify chat exists and belongs to user
    const chats = await db.query(
      `SELECT * FROM chats WHERE id = ? AND user_id = ? AND status != 'deleted'`,
      [id, userId]
    );

    if (!chats || chats.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Chat not found',
        code: 'NOT_FOUND',
      });
    }

    const chat = chats[0];

    // Get message history (for n8n webhook)
    const messageHistory = await db.query(
      `SELECT role, content, image_url, message_data FROM chat_messages 
       WHERE chat_id = ? 
       ORDER BY created_at ASC 
       LIMIT 50`,
      [id]
    );

    // Save user message
    const userMessageResult = await db.query(
      `INSERT INTO chat_messages (chat_id, role, content)
       VALUES (?, 'user', ?)`,
      [id, message.trim()]
    );

    // Update chat updated_at
    await db.query(
      'UPDATE chats SET updated_at = NOW() WHERE id = ?',
      [id]
    );

    // Send to n8n webhook for AI response
    let aiResponse = null;
    let aiMessageId = null;
    
    try {
      // Format message history for n8n webhook
      const history = messageHistory.map(msg => ({
        role: msg.role,
        content: msg.content,
        imageUrl: msg.image_url || null,
      }));

      const webhookResult = await sendChatMessageToWebhook(id, message.trim(), history, userLang);
      
      if (webhookResult.success && webhookResult.data) {
        let responseData = webhookResult.data;
        
        // Handle array response format (n8n chat webhook returns array)
        if (Array.isArray(responseData) && responseData.length > 0) {
          // Use first item in array
          responseData = responseData[0];
        }
        
        logger.info(`Processing chat webhook response for chat ${id}:`, {
          isArray: Array.isArray(webhookResult.data),
          hasMessage: !!responseData.message,
          hasQuestion: !!responseData.question,
          keys: Object.keys(responseData),
        });
        
        // Check if response has structured format (like homework image response)
        if (responseData.question || responseData.solution_steps || responseData.final_answer) {
          // Structured response (homework-like format)
          const messageData = {
            question: responseData.question || null,
            solution_steps: responseData.solution_steps || null,
            final_answer: responseData.final_answer || null,
            explanation: responseData.explanation || null,
            lesson: responseData.lesson || null,
          };

          // Format content for display
          let formattedContent = '';
          if (responseData.question) {
            formattedContent += `**Soru:**\n${responseData.question}\n\n`;
          }
          if (responseData.solution_steps) {
            formattedContent += `**Çözüm Adımları:**\n${responseData.solution_steps}\n\n`;
          }
          if (responseData.final_answer) {
            formattedContent += `**Cevap:** ${responseData.final_answer}\n\n`;
          }
          if (responseData.explanation) {
            formattedContent += `**Açıklama:**\n${responseData.explanation}\n\n`;
          }
          if (responseData.lesson) {
            formattedContent += `**Ders:** ${responseData.lesson}`;
          }

          // Save AI response with structured data
          const aiMessageResult = await db.query(
            `INSERT INTO chat_messages (chat_id, role, content, message_data)
             VALUES (?, 'assistant', ?, ?)`,
            [id, formattedContent.trim() || 'Cevap hazırlanıyor...', JSON.stringify(messageData)]
          );
          
          aiMessageId = aiMessageResult.insertId;
        } else {
          // Simple text response - check message field first (for chat webhook format)
          aiResponse = responseData.message || responseData.response || responseData.answer || responseData.content || 'Yanıt alınamadı.';
          
          if (!aiResponse || aiResponse.trim() === '') {
            logger.warn(`Empty AI response for chat ${id}, responseData:`, responseData);
            aiResponse = 'Yanıt alınamadı.';
          }
          
          // Save AI response
          const aiMessageResult = await db.query(
            `INSERT INTO chat_messages (chat_id, role, content)
             VALUES (?, 'assistant', ?)`,
            [id, aiResponse.trim()]
          );
          
          aiMessageId = aiMessageResult.insertId;
          logger.info(`Chat message added successfully to chat ${id}, messageId: ${aiMessageId}`);
        }

        // Update chat updated_at again
        await db.query(
          'UPDATE chats SET updated_at = NOW() WHERE id = ?',
          [id]
        );
      } else {
        aiResponse = 'Üzgünüm, şu anda yanıt veremiyorum. Lütfen daha sonra tekrar deneyin.';
        
        // Save error message
        const aiMessageResult = await db.query(
          `INSERT INTO chat_messages (chat_id, role, content)
           VALUES (?, 'assistant', ?)`,
          [id, aiResponse]
        );
        
        aiMessageId = aiMessageResult.insertId;
      }
    } catch (webhookError) {
      logger.error('n8n webhook error:', webhookError);
      aiResponse = 'Üzgünüm, bir hata oluştu. Lütfen daha sonra tekrar deneyin.';
      
      // Save error message
      const aiMessageResult = await db.query(
        `INSERT INTO chat_messages (chat_id, role, content)
         VALUES (?, 'assistant', ?)`,
        [id, aiResponse]
      );
      
      aiMessageId = aiMessageResult.insertId;
    }

    // Get saved messages to return formatted response
    const savedMessages = await db.query(
      `SELECT id, role, content, image_url, message_data, created_at 
       FROM chat_messages 
       WHERE id IN (?, ?) 
       ORDER BY created_at ASC`,
      [userMessageResult.insertId, aiMessageId]
    );

    // Format response messages
    const formattedResponseMessages = savedMessages.map(msg => {
      const baseMessage = {
        id: msg.id || 0,
        sender: (msg.role === 'user' ? 'user' : 'bot'),
        timestamp: msg.created_at || new Date().toISOString(),
        imageUrl: msg.image_url || null,
      };

      if (msg.role === 'user') {
        return {
          ...baseMessage,
          message: msg.content || '',
        };
      } else {
        if (msg.message_data) {
          try {
            const messageData = JSON.parse(msg.message_data);
            // Only return structured object if it has at least one field
            if (messageData.question || messageData.solution_steps || messageData.final_answer || 
                messageData.explanation || messageData.lesson) {
              return {
                ...baseMessage,
                message: {
                  question: messageData.question || null,
                  solution_steps: messageData.solution_steps || null,
                  final_answer: messageData.final_answer || null,
                  explanation: messageData.explanation || null,
                  lesson: messageData.lesson || null,
                },
              };
            } else {
              return {
                ...baseMessage,
                message: msg.content || '',
              };
            }
          } catch (e) {
            return {
              ...baseMessage,
              message: msg.content || '',
            };
          }
        } else {
          return {
            ...baseMessage,
            message: msg.content || '',
          };
        }
      }
    });

    const userMsg = formattedResponseMessages.find(m => m.sender === 'user');
    const botMsg = formattedResponseMessages.find(m => m.sender === 'bot');

    res.status(201).json({
      success: true,
      message: 'Message sent successfully',
      data: {
        userMessage: userMsg || null,
        aiMessage: botMsg || null,
      },
    });
  } catch (error) {
    logger.error('Send message error:', error);
    next(error);
  }
};

/**
 * Update chat title
 * PATCH /api/chats/:id
 * Body: { title: string }
 */
const updateChat = async (req, res, next) => {
  try {
    const { uid } = req.user;
    const { id } = req.params;
    const { title } = req.body;

    if (title !== undefined && (typeof title !== 'string' || title.trim().length === 0)) {
      return res.status(400).json({
        success: false,
        error: 'Title must be a non-empty string',
        code: 'VALIDATION_ERROR',
      });
    }

    const users = await db.query(
      'SELECT id FROM users WHERE uid = ? AND is_active = TRUE',
      [uid]
    );

    if (!users || users.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    const userId = users[0].id;

    // Verify chat exists and belongs to user
    const chats = await db.query(
      `SELECT * FROM chats WHERE id = ? AND user_id = ? AND status != 'deleted'`,
      [id, userId]
    );

    if (!chats || chats.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Chat not found',
        code: 'NOT_FOUND',
      });
    }

    // Update title if provided
    if (title !== undefined) {
      await db.query(
        'UPDATE chats SET title = ? WHERE id = ?',
        [title.trim(), id]
      );
    }

    // Get updated chat
    const updatedChats = await db.query(
      `SELECT * FROM chats WHERE id = ?`,
      [id]
    );

    const updatedChat = updatedChats[0];

    res.json({
      success: true,
      message: 'Chat updated successfully',
      data: {
        chat: {
          id: updatedChat.id,
          title: updatedChat.title,
          homeworkImageId: updatedChat.homework_image_id,
          status: updatedChat.status,
          createdAt: updatedChat.created_at,
          updatedAt: updatedChat.updated_at,
        },
      },
    });
  } catch (error) {
    logger.error('Update chat error:', error);
    next(error);
  }
};

/**
 * Archive chat
 * PATCH /api/chats/:id/archive
 */
const archiveChat = async (req, res, next) => {
  try {
    const { uid } = req.user;
    const { id } = req.params;

    const users = await db.query(
      'SELECT id FROM users WHERE uid = ? AND is_active = TRUE',
      [uid]
    );

    if (!users || users.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    const userId = users[0].id;

    // Verify chat exists and belongs to user
    const chats = await db.query(
      `SELECT * FROM chats WHERE id = ? AND user_id = ? AND status != 'deleted'`,
      [id, userId]
    );

    if (!chats || chats.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Chat not found',
        code: 'NOT_FOUND',
      });
    }

    await db.query(
      'UPDATE chats SET status = ? WHERE id = ?',
      ['archived', id]
    );

    res.json({
      success: true,
      message: 'Chat archived successfully',
    });
  } catch (error) {
    logger.error('Archive chat error:', error);
    next(error);
  }
};

/**
 * Delete chat
 * DELETE /api/chats/:id
 */
const deleteChat = async (req, res, next) => {
  try {
    const { uid } = req.user;
    const { id } = req.params;

    const users = await db.query(
      'SELECT id FROM users WHERE uid = ? AND is_active = TRUE',
      [uid]
    );

    if (!users || users.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'User not found',
        code: 'USER_NOT_FOUND',
      });
    }

    const userId = users[0].id;

    // Verify chat exists and belongs to user
    const chats = await db.query(
      `SELECT * FROM chats WHERE id = ? AND user_id = ? AND status != 'deleted'`,
      [id, userId]
    );

    if (!chats || chats.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Chat not found',
        code: 'NOT_FOUND',
      });
    }

    // Soft delete
    await db.query(
      'UPDATE chats SET status = ? WHERE id = ?',
      ['deleted', id]
    );

    res.json({
      success: true,
      message: 'Chat deleted successfully',
    });
  } catch (error) {
    logger.error('Delete chat error:', error);
    next(error);
  }
};

module.exports = {
  getChats,
  getChatById,
  sendMessage,
  updateChat,
  archiveChat,
  deleteChat,
};
