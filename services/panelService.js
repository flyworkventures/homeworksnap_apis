const db = require('../config/database');
const {
  mapPanelUser,
  mapPanelHomeworkImage,
  mapPanelChat,
  mapPanelChatMessage,
  paginationMeta,
} = require('../utils/panelMappers');

const TZ_OFFSETS = {
  'Europe/Istanbul': '+03:00',
  UTC: '+00:00',
};

function getTimezone() {
  return process.env.PANEL_TIMEZONE || 'Europe/Istanbul';
}

function getDailyDays() {
  return Number(process.env.PANEL_DAILY_DAYS || 14);
}

async function safeQuery(sql, params = [], fallback = []) {
  try {
    return await db.query(sql, params);
  } catch (error) {
    if (error?.code === 'ER_NO_SUCH_TABLE') return fallback;
    throw error;
  }
}

function userSelectSql() {
  return `
    SELECT
      u.*,
      (SELECT COUNT(*) FROM homework_images hi WHERE hi.user_id = u.id) AS homework_image_count,
      (SELECT COUNT(*) FROM chats c WHERE c.user_id = u.id AND c.status != 'deleted') AS chat_count,
      (SELECT COUNT(*) FROM chat_messages cm
        INNER JOIN chats c2 ON c2.id = cm.chat_id
        WHERE c2.user_id = u.id AND c2.status != 'deleted') AS message_count
    FROM users u
  `;
}

async function getAnalyse() {
  const tz = getTimezone();
  const offset = TZ_OFFSETS[tz] || '+00:00';
  const days = getDailyDays();

  const userTotals = (
    await db.query(
      `SELECT
        COUNT(*) AS totalUsers,
        SUM(CASE WHEN u.is_active = 1 THEN 1 ELSE 0 END) AS activeUsers,
        SUM(CASE WHEN DATE(CONVERT_TZ(u.account_created_date, '+00:00', ?)) = DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', ?)) THEN 1 ELSE 0 END) AS newUsersToday,
        SUM(CASE WHEN DATE(CONVERT_TZ(u.last_active, '+00:00', ?)) = DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', ?)) THEN 1 ELSE 0 END) AS loginsToday
      FROM users u`,
      [offset, offset, offset, offset]
    )
  )[0];

  const homeworkTotals = (
    await safeQuery(
      `SELECT
        COUNT(*) AS totalHomeworkImages,
        SUM(CASE WHEN DATE(CONVERT_TZ(created_at, '+00:00', ?)) = DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', ?)) THEN 1 ELSE 0 END) AS homeworkToday
      FROM homework_images`,
      [offset, offset],
      [{ totalHomeworkImages: 0, homeworkToday: 0 }]
    )
  )[0];

  const chatTotals = (
    await safeQuery(
      `SELECT
        COUNT(*) AS totalChats,
        SUM(CASE WHEN DATE(CONVERT_TZ(created_at, '+00:00', ?)) = DATE(CONVERT_TZ(UTC_TIMESTAMP(), '+00:00', ?)) THEN 1 ELSE 0 END) AS chatsToday
      FROM chats
      WHERE status != 'deleted'`,
      [offset, offset],
      [{ totalChats: 0, chatsToday: 0 }]
    )
  )[0];

  const messageTotals = (
    await safeQuery(`SELECT COUNT(*) AS totalMessages FROM chat_messages`, [], [{ totalMessages: 0 }])
  )[0];

  const dailyRows = await safeQuery(
    `SELECT
      DATE_FORMAT(d.day, '%Y-%m-%d') AS day,
      COALESCE(l.logins, 0) AS logins,
      COALESCE(n.newUsers, 0) AS newUsers,
      COALESCE(h.homeworkUploads, 0) AS homeworkUploads,
      COALESCE(c.chats, 0) AS chats
    FROM (
      SELECT DATE(CONVERT_TZ(DATE_SUB(UTC_TIMESTAMP(), INTERVAL seq DAY), '+00:00', ?)) AS day
      FROM (
        SELECT 0 AS seq UNION SELECT 1 UNION SELECT 2 UNION SELECT 3 UNION SELECT 4
        UNION SELECT 5 UNION SELECT 6 UNION SELECT 7 UNION SELECT 8 UNION SELECT 9
        UNION SELECT 10 UNION SELECT 11 UNION SELECT 12 UNION SELECT 13
      ) AS seqs
      WHERE seq < ?
    ) d
    LEFT JOIN (
      SELECT DATE(CONVERT_TZ(last_active, '+00:00', ?)) AS day, COUNT(*) AS logins
      FROM users
      WHERE last_active IS NOT NULL
      GROUP BY day
    ) l ON l.day = d.day
    LEFT JOIN (
      SELECT DATE(CONVERT_TZ(account_created_date, '+00:00', ?)) AS day, COUNT(*) AS newUsers
      FROM users
      GROUP BY day
    ) n ON n.day = d.day
    LEFT JOIN (
      SELECT DATE(CONVERT_TZ(created_at, '+00:00', ?)) AS day, COUNT(*) AS homeworkUploads
      FROM homework_images
      GROUP BY day
    ) h ON h.day = d.day
    LEFT JOIN (
      SELECT DATE(CONVERT_TZ(created_at, '+00:00', ?)) AS day, COUNT(*) AS chats
      FROM chats
      WHERE status != 'deleted'
      GROUP BY day
    ) c ON c.day = d.day
    ORDER BY d.day DESC`,
    [offset, days, offset, offset, offset, offset],
    []
  );

  const daily = dailyRows.map((row) => ({
    date: row.day,
    logins: Number(row.logins || 0),
    newUsers: Number(row.newUsers || 0),
    homeworkUploads: Number(row.homeworkUploads || 0),
    chats: Number(row.chats || 0),
  }));

  const authRows = await db.query(
    `SELECT auth_provider AS code, COUNT(*) AS count
     FROM users
     GROUP BY auth_provider
     ORDER BY count DESC`
  );

  const n8nRows = await safeQuery(
    `SELECT n8n_status AS code, COUNT(*) AS count
     FROM homework_images
     GROUP BY n8n_status
     ORDER BY count DESC`,
    [],
    []
  );

  const chatStatusRows = await safeQuery(
    `SELECT status AS code, COUNT(*) AS count
     FROM chats
     GROUP BY status
     ORDER BY count DESC`,
    [],
    []
  );

  const totalAuth = authRows.reduce((s, r) => s + Number(r.count || 0), 0);
  const totalN8n = n8nRows.reduce((s, r) => s + Number(r.count || 0), 0);
  const totalChatStatus = chatStatusRows.reduce((s, r) => s + Number(r.count || 0), 0);

  const mapDist = (rows, total) =>
    rows.map((r) => ({
      code: r.code || 'unknown',
      label: r.code || 'unknown',
      count: Number(r.count || 0),
      percent: total ? Math.round((Number(r.count || 0) / total) * 1000) / 10 : 0,
    }));

  const authLabel = (code) => {
    const c = String(code || '').toLowerCase();
    if (c === 'google') return 'Google';
    if (c === 'apple') return 'Apple';
    if (c === 'facebook') return 'Facebook';
    if (c === 'guest') return 'Misafir';
    return code || '—';
  };

  return {
    summary: {
      totalUsers: Number(userTotals?.totalUsers || 0),
      activeUsers: Number(userTotals?.activeUsers || 0),
      loginsToday: Number(userTotals?.loginsToday || 0),
      newUsersToday: Number(userTotals?.newUsersToday || 0),
      totalHomeworkImages: Number(homeworkTotals?.totalHomeworkImages || 0),
      homeworkToday: Number(homeworkTotals?.homeworkToday || 0),
      totalChats: Number(chatTotals?.totalChats || 0),
      chatsToday: Number(chatTotals?.chatsToday || 0),
      totalMessages: Number(messageTotals?.totalMessages || 0),
      premiumUsers: 0,
    },
    daily,
    audienceInsights: {
      totals: {
        activeUsers: Number(userTotals?.activeUsers || 0),
        totalHomeworkImages: Number(homeworkTotals?.totalHomeworkImages || 0),
        totalChats: Number(chatTotals?.totalChats || 0),
        totalMessages: Number(messageTotals?.totalMessages || 0),
      },
      authProviders: mapDist(authRows, totalAuth).map((r) => ({
        ...r,
        label: authLabel(r.code),
      })),
      n8nStatuses: mapDist(n8nRows, totalN8n).map((r) => ({
        ...r,
        label:
          r.code === 'pending'
            ? 'Bekliyor'
            : r.code === 'completed'
              ? 'Tamamlandı'
              : r.code === 'failed'
                ? 'Başarısız'
                : r.code,
      })),
      chatStatuses: mapDist(chatStatusRows, totalChatStatus).map((r) => ({
        ...r,
        label:
          r.code === 'active'
            ? 'Aktif'
            : r.code === 'archived'
              ? 'Arşiv'
              : r.code === 'deleted'
                ? 'Silindi'
                : r.code,
      })),
    },
  };
}

async function listUsers({ page, limit, search }) {
  const offset = (page - 1) * limit;
  const params = [];
  let where = 'WHERE 1=1';

  if (search) {
    where += ' AND (CAST(u.id AS CHAR) LIKE ? OR u.username LIKE ? OR u.email LIKE ? OR u.uid LIKE ?)';
    const q = `%${search}%`;
    params.push(q, q, q, q);
  }

  const countRows = await db.query(`SELECT COUNT(*) AS total FROM users u ${where}`, params);
  const total = countRows[0]?.total || 0;

  const rows = await db.query(
    `${userSelectSql()} ${where}
     ORDER BY u.account_created_date DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return {
    data: rows.map(mapPanelUser),
    pagination: paginationMeta(page, limit, Number(total)),
  };
}

async function getUserById(id) {
  const rows = await db.query(`${userSelectSql()} WHERE u.id = ?`, [id]);
  if (!rows.length) return null;
  return mapPanelUser(rows[0]);
}

async function patchUser(id, body) {
  const existing = await db.query('SELECT id FROM users WHERE id = ?', [id]);
  if (!existing.length) return null;

  const updates = [];
  const params = [];

  if (body.displayName != null || body.username != null) {
    updates.push('username = ?');
    params.push(String(body.displayName ?? body.username).trim());
  }
  if (body.email != null) {
    updates.push('email = ?');
    params.push(String(body.email).trim());
  }
  if (body.status != null) {
    const active = body.status === 'active';
    updates.push('is_active = ?');
    params.push(active ? 1 : 0);
  }

  if (updates.length) {
    params.push(id);
    await db.query(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`, params);
  }

  return getUserById(id);
}

async function listPremiumUserIds() {
  return [];
}

async function listHomeworkImages({ page, limit, search, status }) {
  const offset = (page - 1) * limit;
  const params = [];
  let where = 'WHERE 1=1';

  if (status) {
    where += ' AND hi.n8n_status = ?';
    params.push(status);
  }
  if (search) {
    where += ' AND (CAST(hi.id AS CHAR) LIKE ? OR u.username LIKE ? OR u.email LIKE ?)';
    const q = `%${search}%`;
    params.push(q, q, q);
  }

  const countRows = await db.query(
    `SELECT COUNT(*) AS total
     FROM homework_images hi
     JOIN users u ON u.id = hi.user_id
     ${where}`,
    params
  );
  const total = countRows[0]?.total || 0;

  const rows = await db.query(
    `SELECT hi.*, u.username, u.email, u.uid
     FROM homework_images hi
     JOIN users u ON u.id = hi.user_id
     ${where}
     ORDER BY hi.created_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return {
    data: rows.map(mapPanelHomeworkImage),
    pagination: paginationMeta(page, limit, Number(total)),
  };
}

async function getHomeworkImageById(id) {
  const rows = await db.query(
    `SELECT hi.*, u.username, u.email, u.uid
     FROM homework_images hi
     JOIN users u ON u.id = hi.user_id
     WHERE hi.id = ?`,
    [id]
  );
  if (!rows.length) return null;
  return mapPanelHomeworkImage(rows[0]);
}

async function listChats({ page, limit, search, status }) {
  const offset = (page - 1) * limit;
  const params = [];
  let where = `WHERE c.status != 'deleted'`;

  if (status) {
    where += ' AND c.status = ?';
    params.push(status);
  }
  if (search) {
    where += ' AND (CAST(c.id AS CHAR) LIKE ? OR c.title LIKE ? OR u.username LIKE ? OR u.email LIKE ?)';
    const q = `%${search}%`;
    params.push(q, q, q, q);
  }

  const countRows = await db.query(
    `SELECT COUNT(*) AS total
     FROM chats c
     JOIN users u ON u.id = c.user_id
     ${where}`,
    params
  );
  const total = countRows[0]?.total || 0;

  const rows = await db.query(
    `SELECT
      c.*,
      u.username,
      u.email,
      hi.image_url AS homework_image_url,
      (SELECT COUNT(*) FROM chat_messages cm WHERE cm.chat_id = c.id) AS message_count
     FROM chats c
     JOIN users u ON u.id = c.user_id
     LEFT JOIN homework_images hi ON hi.id = c.homework_image_id
     ${where}
     ORDER BY c.updated_at DESC
     LIMIT ? OFFSET ?`,
    [...params, limit, offset]
  );

  return {
    data: rows.map(mapPanelChat),
    pagination: paginationMeta(page, limit, Number(total)),
  };
}

async function getChatById(id) {
  const rows = await db.query(
    `SELECT
      c.*,
      u.username,
      u.email,
      hi.image_url AS homework_image_url,
      (SELECT COUNT(*) FROM chat_messages cm WHERE cm.chat_id = c.id) AS message_count
     FROM chats c
     JOIN users u ON u.id = c.user_id
     LEFT JOIN homework_images hi ON hi.id = c.homework_image_id
     WHERE c.id = ? AND c.status != 'deleted'`,
    [id]
  );
  if (!rows.length) return null;

  const messages = await db.query(
    `SELECT id, role, content, image_url, created_at
     FROM chat_messages
     WHERE chat_id = ?
     ORDER BY created_at ASC`,
    [id]
  );

  return {
    ...mapPanelChat(rows[0]),
    messages: messages.map(mapPanelChatMessage),
  };
}

module.exports = {
  getTimezone,
  getDailyDays,
  getAnalyse,
  listUsers,
  getUserById,
  patchUser,
  listPremiumUserIds,
  listHomeworkImages,
  getHomeworkImageById,
  listChats,
  getChatById,
};
