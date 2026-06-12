const panelService = require('../services/panelService');
const { CONTRACT_VERSION } = require('../utils/panelMappers');

function parsePagination(query) {
  const page = Math.max(1, parseInt(query.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 20));
  return { page, limit };
}

const health = (req, res) => {
  res.json({
    ok: true,
    service: 'homeworksnap-api',
    contractVersion: CONTRACT_VERSION,
  });
};

const analyse = async (req, res, next) => {
  try {
    const payload = await panelService.getAnalyse();
    res.json({
      contractVersion: CONTRACT_VERSION,
      generatedAt: new Date().toISOString(),
      timezone: panelService.getTimezone(),
      summary: payload.summary,
      daily: payload.daily,
      audienceInsights: payload.audienceInsights,
    });
  } catch (error) {
    next(error);
  }
};

const listUsers = async (req, res, next) => {
  try {
    const { page, limit } = parsePagination(req.query);
    const result = await panelService.listUsers({
      page,
      limit,
      search: req.query.search?.trim() || '',
    });
    res.json({
      contractVersion: CONTRACT_VERSION,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

const getUser = async (req, res, next) => {
  try {
    const user = await panelService.getUserById(req.params.id);
    if (!user) {
      return res.status(404).json({ contractVersion: CONTRACT_VERSION, error: 'NOT_FOUND', message: 'User not found' });
    }
    res.json({ contractVersion: CONTRACT_VERSION, data: user });
  } catch (error) {
    next(error);
  }
};

const patchUser = async (req, res, next) => {
  try {
    const user = await panelService.patchUser(req.params.id, req.body);
    if (!user) {
      return res.status(404).json({ contractVersion: CONTRACT_VERSION, error: 'NOT_FOUND', message: 'User not found' });
    }
    res.json({ contractVersion: CONTRACT_VERSION, data: user });
  } catch (error) {
    next(error);
  }
};

const listPremiumUserIds = async (req, res, next) => {
  try {
    const ids = await panelService.listPremiumUserIds();
    res.json({ contractVersion: CONTRACT_VERSION, data: ids, total: ids.length });
  } catch (error) {
    next(error);
  }
};

const listHomeworkImages = async (req, res, next) => {
  try {
    const { page, limit } = parsePagination(req.query);
    const result = await panelService.listHomeworkImages({
      page,
      limit,
      search: req.query.search?.trim() || '',
      status: req.query.status?.trim() || '',
    });
    res.json({
      contractVersion: CONTRACT_VERSION,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

const getHomeworkImage = async (req, res, next) => {
  try {
    const item = await panelService.getHomeworkImageById(req.params.id);
    if (!item) {
      return res.status(404).json({ contractVersion: CONTRACT_VERSION, error: 'NOT_FOUND', message: 'Homework image not found' });
    }
    res.json({ contractVersion: CONTRACT_VERSION, data: item });
  } catch (error) {
    next(error);
  }
};

const listChats = async (req, res, next) => {
  try {
    const { page, limit } = parsePagination(req.query);
    const result = await panelService.listChats({
      page,
      limit,
      search: req.query.search?.trim() || '',
      status: req.query.status?.trim() || '',
    });
    res.json({
      contractVersion: CONTRACT_VERSION,
      data: result.data,
      pagination: result.pagination,
    });
  } catch (error) {
    next(error);
  }
};

const getChat = async (req, res, next) => {
  try {
    const chat = await panelService.getChatById(req.params.id);
    if (!chat) {
      return res.status(404).json({ contractVersion: CONTRACT_VERSION, error: 'NOT_FOUND', message: 'Chat not found' });
    }
    res.json({ contractVersion: CONTRACT_VERSION, data: chat });
  } catch (error) {
    next(error);
  }
};

module.exports = {
  health,
  analyse,
  listUsers,
  getUser,
  patchUser,
  listPremiumUserIds,
  listHomeworkImages,
  getHomeworkImage,
  listChats,
  getChat,
};
