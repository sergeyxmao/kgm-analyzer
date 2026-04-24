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

module.exports = { upsertTelegramUser };
