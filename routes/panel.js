const router = require('express').Router();
const panelController = require('../controllers/panelController');
const { panelAuth } = require('../middleware/panelAuth');

router.use(panelAuth);

router.get('/health', panelController.health);
router.get('/analyse', panelController.analyse);

router.get('/users/premium-ids', panelController.listPremiumUserIds);
router.get('/users', panelController.listUsers);
router.get('/users/:id', panelController.getUser);
router.patch('/users/:id', panelController.patchUser);

router.get('/homework-images', panelController.listHomeworkImages);
router.get('/homework-images/:id', panelController.getHomeworkImage);

router.get('/chats', panelController.listChats);
router.get('/chats/:id', panelController.getChat);

router.use((err, req, res, next) => {
  const status = err.statusCode || 500;
  res.status(status).json({
    contractVersion: '2',
    error: err.code || 'INTERNAL_ERROR',
    message: err.message || 'Internal server error',
  });
});

module.exports = router;
