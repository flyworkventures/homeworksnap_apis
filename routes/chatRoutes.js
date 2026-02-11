/**
 * Chat Routes
 */

const express = require('express');
const router = express.Router();
const chatController = require('../controllers/chatController');
const { authenticate } = require('../middleware/auth');

// All routes require authentication
router.get('/', authenticate, chatController.getChats);
router.get('/:id', authenticate, chatController.getChatById);
router.post('/:id/messages', authenticate, chatController.sendMessage);
router.patch('/:id', authenticate, chatController.updateChat);
router.patch('/:id/archive', authenticate, chatController.archiveChat);
router.delete('/:id', authenticate, chatController.deleteChat);

module.exports = router;
