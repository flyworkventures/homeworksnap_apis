/**
 * Homework Controller
 * Handles homework image upload and processing
 */

const db = require('../config/database');
const logger = require('../utils/logger');
const { uploadFile, deleteFile } = require('../utils/bunnyCDN');
const { sendHomeworkImageToWebhook } = require('../utils/n8nWebhook');
const { resolveUserLang } = require('../utils/userLang');

/**
 * Upload homework image
 * POST /api/homework/images
 * Content-Type: multipart/form-data
 * Body: image (file), language (optional, e.g. 'tr' | 'en' | 'de' ...)
 */
const uploadHomeworkImage = async (req, res, next) => {
  try {
    const { uid } = req.user;
    const userLang = resolveUserLang(req);

    if (!req.file) {
      return res.status(400).json({
        success: false,
        error: 'No file uploaded. Please send a file with field name "image"',
        code: 'NO_FILE',
      });
    }

    logger.info(`Upload homework image request for user: ${uid}, file size: ${req.file.size}, lang: ${userLang}`);

    // Get user ID from database
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

    // Upload image to Bunny CDN
    const fileName = req.file.originalname || 'homework-image.jpg';
    let cdnUrl;
    let cdnPath;
    
    try {
      cdnUrl = await uploadFile(req.file.buffer, fileName, uid, { folder: 'homework' });
      // Extract path from URL for reference
      const urlObj = new URL(cdnUrl);
      cdnPath = urlObj.pathname;
    } catch (uploadError) {
      logger.error('Bunny CDN upload failed:', uploadError);
      return res.status(400).json({
        success: false,
        error: uploadError.message || 'Failed to upload file to Bunny CDN',
        code: 'UPLOAD_FAILED',
      });
    }

    // Save homework image record
    const webhookUrl = process.env.N8N_WEBHOOK_URL_HOMEWORK_IMAGE || null;
    const result = await db.query(
      `INSERT INTO homework_images (user_id, image_url, cdn_path, n8n_webhook_url, n8n_status)
       VALUES (?, ?, ?, ?, 'pending')`,
      [userId, cdnUrl, cdnPath, webhookUrl]
    );

    const homeworkImageId = result.insertId;

    // Create chat immediately (before n8n webhook)
    const chatTitle = 'Yeni Ödev Sorusu';
    const chatResult = await db.query(
      `INSERT INTO chats (user_id, homework_image_id, title, status)
       VALUES (?, ?, ?, 'active')`,
      [userId, homeworkImageId, chatTitle]
    );
    
    const chatId = chatResult.insertId;

    // Update homework_image with chat_id
    await db.query(
      'UPDATE homework_images SET chat_id = ? WHERE id = ?',
      [chatId, homeworkImageId]
    );

    // Add first message: User's image
    await db.query(
      `INSERT INTO chat_messages (chat_id, role, content, image_url)
       VALUES (?, 'user', ?, ?)`,
      [chatId, 'Ödev fotoğrafı yüklendi', cdnUrl]
    );

    // Send to n8n webhook asynchronously (don't wait for response)
    sendHomeworkImageToWebhook(cdnUrl, uid, chatId, userLang)
      .then(async (webhookResult) => {
        try {
          logger.info(`n8n webhook result for homework image ${homeworkImageId}:`, {
            success: webhookResult.success,
            status: webhookResult.status,
            hasData: !!webhookResult.data,
            error: webhookResult.error,
          });

          const n8nResponse = JSON.stringify(webhookResult);
          
          // Update homework image with n8n response
          await db.query(
            `UPDATE homework_images 
             SET n8n_response = ?, n8n_status = ? 
             WHERE id = ?`,
            [
              n8nResponse,
              webhookResult.success ? 'completed' : 'failed',
              homeworkImageId
            ]
          );

          // Only add bot message if webhook returned valid data
          if (webhookResult.success && webhookResult.data) {
            const webhookData = webhookResult.data;
            
            logger.info(`Processing webhook data for chat ${chatId}:`, {
              hasQuestion: !!webhookData.question,
              hasSolutionSteps: !!webhookData.solution_steps,
              hasFinalAnswer: !!webhookData.final_answer,
              hasExplanation: !!webhookData.explanation,
              hasLesson: !!webhookData.lesson,
              hasResponse: !!webhookData.response,
              hasAnswer: !!webhookData.answer,
              hasMessage: !!webhookData.message,
              hasContent: !!webhookData.content,
              hasQuestions: !!webhookData.questions,
              dataKeys: Object.keys(webhookData),
            });
            
            // Handle questions array format (n8n returns questions as array)
            if (webhookData.questions && Array.isArray(webhookData.questions) && webhookData.questions.length > 0) {
              // Process first question (or all questions)
              const firstQuestion = webhookData.questions[0];
              
              if (firstQuestion.question || firstQuestion.solution_steps || firstQuestion.final_answer || 
                  firstQuestion.explanation || firstQuestion.lesson) {
                // Update chat title if question exists
                if (firstQuestion.question) {
                  const chatTitle = firstQuestion.question.substring(0, 100);
                  await db.query(
                    'UPDATE chats SET title = ?, n8n_workflow_id = ? WHERE id = ?',
                    [chatTitle, webhookData.workflowId || null, chatId]
                  );
                }

                // Prepare message data object for AI response
                const messageData = {
                  question: firstQuestion.question || null,
                  solution_steps: firstQuestion.solution_steps || null,
                  final_answer: firstQuestion.final_answer || null,
                  explanation: firstQuestion.explanation || null,
                  lesson: firstQuestion.lesson || null,
                };

                // Format content for display
                let formattedContent = '';
                if (firstQuestion.question) {
                  formattedContent += `**Soru:**\n${firstQuestion.question}\n\n`;
                }
                if (firstQuestion.solution_steps) {
                  formattedContent += `**Çözüm Adımları:**\n${firstQuestion.solution_steps}\n\n`;
                }
                if (firstQuestion.final_answer) {
                  formattedContent += `**Cevap:** ${firstQuestion.final_answer}\n\n`;
                }
                if (firstQuestion.explanation) {
                  formattedContent += `**Açıklama:**\n${firstQuestion.explanation}\n\n`;
                }
                if (firstQuestion.lesson) {
                  formattedContent += `**Ders:** ${firstQuestion.lesson}`;
                }

                // Add bot message to chat
                if (formattedContent.trim()) {
                  logger.info(`Adding structured bot message from questions array to chat ${chatId}`);
                  await db.query(
                    `INSERT INTO chat_messages (chat_id, role, content, message_data)
                     VALUES (?, 'assistant', ?, ?)`,
                    [chatId, formattedContent.trim(), JSON.stringify(messageData)]
                  );
                  logger.info(`Bot message added successfully to chat ${chatId}`);
                } else {
                  logger.warn(`Formatted content is empty for chat ${chatId}, skipping message insertion`);
                }
              }
            }
            // Check if response has the expected format (structured response - single object)
            else if (webhookData.question || webhookData.solution_steps || webhookData.final_answer || 
                webhookData.explanation || webhookData.lesson) {
              // Update chat title if question exists
              if (webhookData.question) {
                const chatTitle = webhookData.question.substring(0, 100);
                await db.query(
                  'UPDATE chats SET title = ?, n8n_workflow_id = ? WHERE id = ?',
                  [chatTitle, webhookData.workflowId || null, chatId]
                );
              }

              // Prepare message data object for AI response
              const messageData = {
                question: webhookData.question || null,
                solution_steps: webhookData.solution_steps || null,
                final_answer: webhookData.final_answer || null,
                explanation: webhookData.explanation || null,
                lesson: webhookData.lesson || null,
              };

              // Format content for display (only if we have actual content)
              let formattedContent = '';
              if (webhookData.question) {
                formattedContent += `**Soru:**\n${webhookData.question}\n\n`;
              }
              if (webhookData.solution_steps) {
                formattedContent += `**Çözüm Adımları:**\n${webhookData.solution_steps}\n\n`;
              }
              if (webhookData.final_answer) {
                formattedContent += `**Cevap:** ${webhookData.final_answer}\n\n`;
              }
              if (webhookData.explanation) {
                formattedContent += `**Açıklama:**\n${webhookData.explanation}\n\n`;
              }
              if (webhookData.lesson) {
                formattedContent += `**Ders:** ${webhookData.lesson}`;
              }

              // Only add message if we have actual content
              if (formattedContent.trim()) {
                logger.info(`Adding structured bot message to chat ${chatId}`);
                await db.query(
                  `INSERT INTO chat_messages (chat_id, role, content, message_data)
                   VALUES (?, 'assistant', ?, ?)`,
                  [chatId, formattedContent.trim(), JSON.stringify(messageData)]
                );
                logger.info(`Bot message added successfully to chat ${chatId}`);
              } else {
                logger.warn(`Formatted content is empty for chat ${chatId}, skipping message insertion`);
              }
            } else if (webhookData.response || webhookData.answer || webhookData.message || webhookData.content) {
              // Simple text response (only if we have actual text)
              const aiResponse = webhookData.response || webhookData.answer || webhookData.message || webhookData.content;
              if (aiResponse && aiResponse.trim()) {
                logger.info(`Adding simple text bot message to chat ${chatId}`);
                await db.query(
                  `INSERT INTO chat_messages (chat_id, role, content)
                   VALUES (?, 'assistant', ?)`,
                  [chatId, aiResponse.trim()]
                );
                logger.info(`Bot message added successfully to chat ${chatId}`);
              } else {
                logger.warn(`AI response is empty for chat ${chatId}, skipping message insertion`);
              }
            } else {
              // Log what we received but couldn't process
              logger.warn(`No recognized response format for chat ${chatId}. Webhook data:`, {
                keys: Object.keys(webhookData),
                sample: JSON.stringify(webhookData).substring(0, 500),
              });
              
              // Fallback: If webhookData is a string or has any text content, add it as message
              if (typeof webhookData === 'string' && webhookData.trim()) {
                logger.info(`Adding fallback string response to chat ${chatId}`);
                await db.query(
                  `INSERT INTO chat_messages (chat_id, role, content)
                   VALUES (?, 'assistant', ?)`,
                  [chatId, webhookData.trim()]
                );
              } else if (webhookData && typeof webhookData === 'object') {
                // Try to find any text field in the response
                const textFields = ['text', 'result', 'output', 'data', 'body'];
                for (const field of textFields) {
                  if (webhookData[field] && typeof webhookData[field] === 'string' && webhookData[field].trim()) {
                    logger.info(`Adding fallback response from field '${field}' to chat ${chatId}`);
                    await db.query(
                      `INSERT INTO chat_messages (chat_id, role, content)
                       VALUES (?, 'assistant', ?)`,
                      [chatId, webhookData[field].trim()]
                    );
                    break;
                  }
                }
              }
            }
          } else {
            logger.warn(`Webhook result indicates failure or no data for chat ${chatId}:`, {
              success: webhookResult.success,
              hasData: !!webhookResult.data,
              error: webhookResult.error,
            });
          }
          // If webhook failed, don't add error message - let user see only their image
        } catch (error) {
          logger.error('Error processing webhook response:', error);
        }
      })
      .catch(async (webhookError) => {
        logger.error('n8n webhook error for homework image:', {
          homeworkImageId,
          chatId,
          error: webhookError.message,
          stack: webhookError.stack,
          code: webhookError.code,
          response: webhookError.response ? {
            status: webhookError.response.status,
            data: webhookError.response.data,
          } : null,
        });
        
        // Update status to failed
        const errorResponse = {
          error: webhookError.message,
          code: webhookError.code,
          response: webhookError.response ? {
            status: webhookError.response.status,
            data: webhookError.response.data,
          } : null,
        };
        
        await db.query(
          `UPDATE homework_images SET n8n_status = 'failed', n8n_response = ? WHERE id = ?`,
          [JSON.stringify(errorResponse), homeworkImageId]
        );
        
        // Don't add error message to chat - let user see only their image
        // Error message can be shown in UI based on n8nStatus
      });

    logger.info(`Homework image uploaded: ${homeworkImageId} for user: ${uid}, chat created: ${chatId}`);

    // Always return chatId (chat is created immediately)
    res.status(201).json({
      success: true,
      message: 'Homework image uploaded and chat created successfully',
      data: {
        chatId: chatId,
      },
    });
  } catch (error) {
    logger.error('Upload homework image error:', error);
    next(error);
  }
};

/**
 * Get user's homework images
 * GET /api/homework/images
 */
const getHomeworkImages = async (req, res, next) => {
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

    const homeworkImages = await db.query(
      `SELECT 
        id,
        image_url,
        n8n_status,
        chat_id,
        created_at,
        updated_at
       FROM homework_images
       WHERE user_id = ?
       ORDER BY created_at DESC`,
      [userId]
    );

    res.json({
      success: true,
      data: {
        homeworkImages: homeworkImages.map(img => ({
          id: img.id,
          imageUrl: img.image_url,
          n8nStatus: img.n8n_status,
          chatId: img.chat_id, // null olabilir (henüz chat oluşturulmadıysa)
          createdAt: img.created_at,
          updatedAt: img.updated_at,
        })),
        count: homeworkImages.length,
      },
    });
  } catch (error) {
    logger.error('Get homework images error:', error);
    next(error);
  }
};

/**
 * Get homework image by ID
 * GET /api/homework/images/:id
 */
const getHomeworkImageById = async (req, res, next) => {
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

    const homeworkImages = await db.query(
      `SELECT * FROM homework_images WHERE id = ? AND user_id = ?`,
      [id, userId]
    );

    if (!homeworkImages || homeworkImages.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Homework image not found',
        code: 'NOT_FOUND',
      });
    }

    const homeworkImage = homeworkImages[0];

    res.json({
      success: true,
      data: {
        homeworkImage: {
          id: homeworkImage.id,
          imageUrl: homeworkImage.image_url,
          n8nStatus: homeworkImage.n8n_status,
          chatId: homeworkImage.chat_id, // null olabilir
          createdAt: homeworkImage.created_at,
          updatedAt: homeworkImage.updated_at,
        },
      },
    });
  } catch (error) {
    logger.error('Get homework image by ID error:', error);
    next(error);
  }
};

/**
 * Delete homework image
 * DELETE /api/homework/images/:id
 */
const deleteHomeworkImage = async (req, res, next) => {
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

    const homeworkImages = await db.query(
      `SELECT image_url FROM homework_images WHERE id = ? AND user_id = ?`,
      [id, userId]
    );

    if (!homeworkImages || homeworkImages.length === 0) {
      return res.status(404).json({
        success: false,
        error: 'Homework image not found',
        code: 'NOT_FOUND',
      });
    }

    const homeworkImage = homeworkImages[0];

    // Delete image from CDN
    if (homeworkImage.image_url) {
      await deleteFile(homeworkImage.image_url).catch(err => {
        logger.warn(`Failed to delete homework image from CDN: ${err.message}`);
      });
    }

    // Delete homework image record (cascade will handle chat references)
    await db.query(
      'DELETE FROM homework_images WHERE id = ?',
      [id]
    );

    logger.info(`Homework image deleted: ${id} for user: ${uid}`);

    res.json({
      success: true,
      message: 'Homework image deleted successfully',
    });
  } catch (error) {
    logger.error('Delete homework image error:', error);
    next(error);
  }
};

module.exports = {
  uploadHomeworkImage,
  getHomeworkImages,
  getHomeworkImageById,
  deleteHomeworkImage,
};
