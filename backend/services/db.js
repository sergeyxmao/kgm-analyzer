/**
 * КУДРИ · модуль работы с SQLite.
 * Открывает БД один раз при импорте, возвращает подключение.
 * Схема БД создаётся владельцем вручную через backend/db/*.sql (см. docs/technical/database.md).
 */

const path = require('path');
const Database = require('better-sqlite3');

const DB_PATH = process.env.DB_PATH || './data/kudri.db';

// Резолвим путь относительно корня проекта (на два уровня вверх от services/)
const ABS_DB_PATH = path.isAbsolute(DB_PATH)
  ? DB_PATH
  : path.resolve(__dirname, '..', '..', DB_PATH);

const db = new Database(ABS_DB_PATH, {
  // readonly: false — подразумевается по умолчанию
  fileMustExist: true  // не создаём БД автоматически — она должна быть подготовлена миграцией
});

// Включаем foreign keys (по умолчанию SQLite их игнорирует)
db.pragma('foreign_keys = ON');
// WAL-режим — безопаснее при одновременных чтениях/записях
db.pragma('journal_mode = WAL');

// Закрываем соединение корректно при завершении процесса
const closeOnExit = () => {
  try { db.close(); } catch {}
};
process.on('exit', closeOnExit);
process.on('SIGINT', () => { closeOnExit(); process.exit(0); });
process.on('SIGTERM', () => { closeOnExit(); process.exit(0); });

/**
 * Возвращает текущую версию схемы (максимальное значение из schema_migrations).
 */
function getSchemaVersion() {
  const row = db.prepare('SELECT MAX(version) AS version FROM schema_migrations').get();
  return row?.version ?? 0;
}

/**
 * Возвращает список пользовательских таблиц БД.
 */
function listTables() {
  return db.prepare(
    "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  ).all().map(r => r.name);
}

/**
 * Возвращает объект { имя_таблицы: количество_строк } для всех таблиц.
 */
function countRows() {
  const tables = listTables();
  const result = {};
  for (const t of tables) {
    // Имя таблицы экранировать нельзя через параметр — собираем вручную.
    // Проверено: listTables возвращает только имена из sqlite_master, безопасно.
    const row = db.prepare(`SELECT COUNT(*) AS c FROM "${t}"`).get();
    result[t] = row.c;
  }
  return result;
}

module.exports = {
  db,
  getSchemaVersion,
  listTables,
  countRows,
  dbPath: ABS_DB_PATH
};
