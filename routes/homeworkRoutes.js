/**
 * Homework Routes
 */

const express = require('express');
const router = express.Router();
const homeworkController = require('../controllers/homeworkController');
const { authenticate } = require('../middleware/auth');
const { handleHomeworkImageUpload } = require('../middleware/upload');

// All routes require authentication
router.post('/', authenticate, handleHomeworkImageUpload, homeworkController.uploadHomeworkImage);
router.get('/', authenticate, homeworkController.getHomeworkImages);
router.get('/:id', authenticate, homeworkController.getHomeworkImageById);
router.delete('/:id', authenticate, homeworkController.deleteHomeworkImage);

module.exports = router;
