const CONTRACT_VERSION = '2';

function toIso(value) {
  if (!value) return null;
  const d = value instanceof Date ? value : new Date(value);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function mapPanelUser(row) {
  return {
    id: String(row.id),
    email: row.email || null,
    displayName: row.username || row.email || `Kullanıcı #${row.id}`,
    phone: null,
    status: row.is_active ? 'active' : 'inactive',
    createdAt: toIso(row.account_created_date),
    lastLoginAt: toIso(row.last_active),
    extras: {
      uid: row.uid || null,
      authProvider: row.auth_provider || null,
      profilePhotoUrl: row.profile_photo_url ?? null,
      homeworkImageCount: Number(row.homework_image_count || 0),
      chatCount: Number(row.chat_count || 0),
      messageCount: Number(row.message_count || 0),
      isPremium: false,
    },
  };
}

function mapPanelHomeworkImage(row) {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    userLabel: row.username || row.email || `Kullanıcı #${row.user_id}`,
    imageUrl: row.image_url || null,
    chatId: row.chat_id ? String(row.chat_id) : null,
    n8nStatus: row.n8n_status || null,
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapPanelChat(row) {
  return {
    id: String(row.id),
    userId: String(row.user_id),
    userLabel: row.username || row.email || `Kullanıcı #${row.user_id}`,
    title: row.title || null,
    status: row.status || null,
    homeworkImageId: row.homework_image_id ? String(row.homework_image_id) : null,
    homeworkImageUrl: row.homework_image_url || null,
    messageCount: Number(row.message_count || 0),
    createdAt: toIso(row.created_at),
    updatedAt: toIso(row.updated_at),
  };
}

function mapPanelChatMessage(row) {
  return {
    id: String(row.id),
    role: row.role || null,
    content: row.content || null,
    imageUrl: row.image_url || null,
    createdAt: toIso(row.created_at),
  };
}

function paginationMeta(page, limit, total) {
  const totalPages = Math.max(1, Math.ceil(total / limit));
  return {
    page,
    limit,
    total,
    totalPages,
    hasNext: page < totalPages,
    hasPrev: page > 1,
  };
}

module.exports = {
  CONTRACT_VERSION,
  mapPanelUser,
  mapPanelHomeworkImage,
  mapPanelChat,
  mapPanelChatMessage,
  paginationMeta,
};
