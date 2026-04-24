/**
 * КУДРИ · работа с таблицей users.
 */

const { db } = require('./db');

const ADMIN_TG_ID = parseInt(process.env.ADMIN_TG_ID, 10) || 0;

// Подготовленные выражения — переиспользуются, быстрее и безопаснее
const selectByTg = db.prepare(
  `SELECT * FROM users WHERE platform = 'tg' AND platform_id = ?`
);
const insertTgUser = db.prepare(`
  INSERT INTO users (platform, platform_id, username, first_name, last_name, photo_url, is_admin)
  VALUES ('tg', ?, ?, ?, ?, ?, ?)
`);
const updateTgUser = db.prepare(`
  UPDATE users SET
    username = ?,
    first_name = ?,
    last_name = ?,
    photo_url = ?,
    is_admin = ?,
    last_seen_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')
  WHERE id = ?
`);

const selectById = db.prepare(
  `SELECT id, platform, platform_id, username, first_name, last_name, photo_url, is_admin, created_at, last_seen_at
   FROM users WHERE id = ?`
);

/**
 * Находит пользователя по tg-id или создаёт нового. Обновляет last_seen_at и профильные поля.
 * @param {object} tgUser — user-объект из initData, как пришёл от Telegram
 * @returns {object} строка из таблицы users
 */
function upsertTelegramUser(tgUser) {
  const platformId = `tg_${tgUser.id}`;
  const isAdmin = tgUser.id === ADMIN_TG_ID ? 1 : 0;
  const existing = selectByTg.get(platformId);

  if (existing) {
    updateTgUser.run(
      tgUser.username || null,
      tgUser.first_name || null,
      tgUser.last_name || null,
      tgUser.photo_url || null,
      isAdmin,
      existing.id
    );
    return selectByTg.get(platformId);
  } else {
    insertTgUser.run(
      platformId,
      tgUser.username || null,
      tgUser.first_name || null,
      tgUser.last_name || null,
      tgUser.photo_url || null,
      isAdmin
    );
    return selectByTg.get(platformId);
  }
}

/**
 * Находит пользователя по внутреннему id. Возвращает объект в camelCase
 * с isAdmin как boolean, либо null если пользователя нет.
 */
function getUserById(id) {
  const row = selectById.get(id);
  if (!row) return null;
  return {
    id: row.id,
    platform: row.platform,
    platformId: row.platform_id,
    username: row.username,
    firstName: row.first_name,
    lastName: row.last_name,
    photoUrl: row.photo_url,
    isAdmin: row.is_admin === 1,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at
  };
}

module.exports = { upsertTelegramUser, getUserById };
