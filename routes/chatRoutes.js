/**
 * Chat Routes
 */

const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const { authenticate } = require('../middleware/auth');
const { chatLimiter } = require('../middleware/rateLimiter');

// All routes require authentication
// Apply chat-specific rate limiter to message sending endpoint
router.get('/', authenticate, chatController.getChats);
router.get('/:id', authenticate, chatController.getChatById);
router.post('/:id/messages', authenticate, chatLimiter, chatController.sendMessage);
router.patch('/:id', authenticate, chatController.updateChat);
router.patch('/:id/archive', authenticate, chatController.archiveChat);
router.delete('/:id', authenticate, chatController.deleteChat);

module.exports = router;
