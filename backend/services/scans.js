/**
 * КУДРИ · CRUD для сканов.
 * Все операции привязаны к user_id — пользователь видит только свои сканы.
 */

const crypto = require('crypto');
const { db } = require('./db');
const s3 = require('./s3');

const VALID_SHELVES = ['history', 'mine', 'wishlist', 'rejected'];
const VALID_VERDICTS = ['good', 'warn', 'bad'];

const insertStmt = db.prepare(`
  INSERT INTO scans (user_id, raw_inci, verdict, verdict_title, product_type, summary, ingredients, profile_snapshot, photo_key, shelf)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'history')
`);

const selectByIdStmt = db.prepare(
  `SELECT * FROM scans WHERE id = ? AND user_id = ?`
);

const selectAllStmt = db.prepare(
  `SELECT * FROM scans WHERE user_id = ? ORDER BY created_at DESC LIMIT ?`
);

const selectByShelfStmt = db.prepare(
  `SELECT * FROM scans WHERE user_id = ? AND shelf = ? ORDER BY created_at DESC LIMIT ?`
);

const updateShelfStmt = db.prepare(
  `UPDATE scans SET shelf = ? WHERE id = ? AND user_id = ?`
);

const deleteStmt = db.prepare(
  `DELETE FROM scans WHERE id = ? AND user_id = ?`
);

const setShareTokenStmt = db.prepare(
  `UPDATE scans SET share_token = ? WHERE id = ? AND user_id = ?`
);

const selectByShareTokenStmt = db.prepare(
  `SELECT * FROM scans WHERE share_token = ?`
);

/**
 * Создаёт скан. Возвращает созданную запись.
 */
async function createScan(userId, data) {
  if (!VALID_VERDICTS.includes(data.verdict)) {
    const err = new Error('bad_verdict');
    err.code = 'bad_verdict';
    throw err;
  }

  const info = insertStmt.run(
    userId,
    data.rawInci ?? null,
    data.verdict,
    data.verdictTitle ?? null,
    data.productType ?? null,
    data.summary ?? null,
    data.ingredients ? JSON.stringify(data.ingredients) : null,
    data.profileSnapshot ? JSON.stringify(data.profileSnapshot) : null,
    data.photoKey ?? null
  );

  return getScanById(info.lastInsertRowid, userId);
}

/**
 * Возвращает список сканов пользователя с фильтром по полке.
 * shelf = 'all' — все сканы (включая history). Иначе конкретная полка.
 */
async function listScans(userId, shelf = 'all', limit = 50) {
  const lim = Math.min(Math.max(parseInt(limit, 10) || 50, 1), 100);

  let rows;
  if (shelf === 'all') {
    rows = selectAllStmt.all(userId, lim);
  } else {
    if (!VALID_SHELVES.includes(shelf)) {
      const err = new Error('bad_shelf');
      err.code = 'bad_shelf';
      throw err;
    }
    rows = selectByShelfStmt.all(userId, shelf, lim);
  }

  return enrichListWithPhotoUrls(rows.map(rowToScan));
}

async function getScanById(scanId, userId) {
  const row = selectByIdStmt.get(scanId, userId);
  if (!row) return null;
  return enrichWithPhotoUrl(rowToScan(row));
}

async function updateShelf(scanId, userId, shelf) {
  if (!VALID_SHELVES.includes(shelf)) {
    const err = new Error('bad_shelf');
    err.code = 'bad_shelf';
    throw err;
  }

  const result = updateShelfStmt.run(shelf, scanId, userId);
  if (result.changes === 0) return null;
  return getScanById(scanId, userId);
}

function deleteScan(scanId, userId) {
  const result = deleteStmt.run(scanId, userId);
  return result.changes > 0;
}

/**
 * DB-row → API-формат (snake_case → camelCase, JSON-парсинг).
 */
function rowToScan(row) {
  let ingredients = null;
  try { ingredients = row.ingredients ? JSON.parse(row.ingredients) : null; }
  catch { ingredients = null; }

  let profileSnapshot = null;
  try { profileSnapshot = row.profile_snapshot ? JSON.parse(row.profile_snapshot) : null; }
  catch { profileSnapshot = null; }

  return {
    id: row.id,
    userId: row.user_id,
    productType: row.product_type,
    verdict: row.verdict,
    verdictTitle: row.verdict_title,
    summary: row.summary,
    ingredients,
    rawInci: row.raw_inci,
    photoKey: row.photo_key,
    shareToken: row.share_token,
    shelf: row.shelf,
    profileSnapshot,
    createdAt: row.created_at
  };
}

/**
 * Добавляет presigned photoUrl к одному скану (если есть photoKey).
 */
async function enrichWithPhotoUrl(scan) {
  if (!scan) return scan;
  if (scan.photoKey) {
    scan.photoUrl = await s3.getPresignedUrl(scan.photoKey);
  } else {
    scan.photoUrl = null;
  }
  return scan;
}

/**
 * Добавляет presigned photoUrl к списку сканов.
 */
async function enrichListWithPhotoUrls(list) {
  return Promise.all(list.map(enrichWithPhotoUrl));
}

/**
 * Генерирует или возвращает существующий share_token для скана. Идемпотентно.
 * Возвращает { token } или null если скан не найден / не принадлежит юзеру.
 */
async function createShareToken(scanId, userId) {
  const scan = selectByIdStmt.get(scanId, userId);
  if (!scan) return null;
  if (scan.share_token) return { token: scan.share_token };
  const token = crypto.randomUUID();
  setShareTokenStmt.run(token, scanId, userId);
  return { token };
}

/**
 * Удаляет токен у скана (NULL). Возвращает true если что-то изменилось.
 */
async function revokeShareToken(scanId, userId) {
  const result = setShareTokenStmt.run(null, scanId, userId);
  return result.changes > 0;
}

/**
 * Получить скан по публичному токену. Возвращает скан с photoUrl или null.
 * НЕ требует userId — это публичный доступ.
 */
async function getScanByShareToken(token) {
  if (!token) return null;
  const row = selectByShareTokenStmt.get(token);
  if (!row) return null;
  const scan = rowToScan(row);
  return enrichWithPhotoUrl(scan);
}

module.exports = {
  createScan,
  listScans,
  getScanById,
  updateShelf,
  deleteScan,
  createShareToken,
  revokeShareToken,
  getScanByShareToken
};
