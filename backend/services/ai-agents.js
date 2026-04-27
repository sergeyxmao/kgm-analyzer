/**
 * КУДРИ · CRUD для AI-агентов (таблица ai_agents, миграция 003).
 * Схема жёсткая — любые отклонения ловим в validate*() и бросаем типизированные ошибки
 * с полем code, чтобы route-слой мог однозначно отдать правильный HTTP-статус.
 *
 * Названия колонок в БД — snake_case. Наружу (в JSON) — camelCase:
 *   api_key → apiKey, created_at → createdAt, updated_at → updatedAt.
 * Поле active хранится как INTEGER (0/1), отдаётся наружу как boolean.
 * Поле params хранится как JSON-строка (или NULL), отдаётся как объект (или null).
 */

const { db } = require('./db');

const PROVIDERS = ['gemini', 'openai', 'deepseek', 'anthropic'];
const ROLES     = ['analyst', 'ocr', 'both', 'image_search'];
const UPDATABLE_FIELDS = ['name', 'provider', 'role', 'endpoint', 'apiKey', 'model', 'priority', 'active', 'params'];

const selectAllStmt = db.prepare(
  `SELECT id, name, provider, role, endpoint, api_key, model, priority, active, params, created_at, updated_at
   FROM ai_agents
   ORDER BY priority ASC, id ASC`
);

const selectByIdStmt = db.prepare(
  `SELECT id, name, provider, role, endpoint, api_key, model, priority, active, params, created_at, updated_at
   FROM ai_agents
   WHERE id = ?`
);

const selectActiveByRoleStmt = db.prepare(
  `SELECT id, name, provider, role, endpoint, api_key, model, priority, active, params, created_at, updated_at
   FROM ai_agents
   WHERE active = 1 AND (role = ? OR role = 'both')
   ORDER BY priority ASC, id ASC`
);

const insertStmt = db.prepare(`
  INSERT INTO ai_agents (name, provider, role, endpoint, api_key, model, priority, active, params)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
`);

const deleteStmt = db.prepare(`DELETE FROM ai_agents WHERE id = ?`);

/**
 * Возвращает все агенты отсортированные по priority ASC.
 */
function listAgents() {
  return selectAllStmt.all().map(rowToAgent);
}

/**
 * Возвращает агента по id или null.
 */
function getAgentById(id) {
  const row = selectByIdStmt.get(id);
  return row ? rowToAgent(row) : null;
}

/**
 * Создаёт агента. Все обязательные поля должны быть в input.
 * Бросает { code: 'validation', field, reason? } или { code: 'conflict', field }.
 */
function createAgent(input) {
  const data = validateCreate(input);

  try {
    const info = insertStmt.run(
      data.name,
      data.provider,
      data.role,
      data.endpoint,
      data.apiKey,
      data.model,
      data.priority,
      data.active,
      data.params
    );
    return getAgentById(info.lastInsertRowid);
  } catch (err) {
    throw translateSqliteError(err);
  }
}

/**
 * PATCH-обновление. Меняются только переданные поля. Возвращает обновлённого агента или null.
 * Бросает { code: 'validation' | 'conflict', field, reason? }.
 */
function updateAgent(id, input) {
  const existing = selectByIdStmt.get(id);
  if (!existing) return null;

  const patch = validatePatch(input);
  if (Object.keys(patch).length === 0) {
    // Пустой PATCH — ничего не делаем, возвращаем текущее состояние
    return rowToAgent(existing);
  }

  // Собираем UPDATE динамически — только по полям, которые реально пришли
  const fragments = [];
  const values = [];
  for (const key of Object.keys(patch)) {
    fragments.push(`${key} = ?`);
    values.push(patch[key]);
  }
  fragments.push(`updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now')`);
  values.push(id);

  const sql = `UPDATE ai_agents SET ${fragments.join(', ')} WHERE id = ?`;
  try {
    db.prepare(sql).run(...values);
  } catch (err) {
    throw translateSqliteError(err);
  }
  return getAgentById(id);
}

/**
 * Удаляет агента по id. Возвращает true если реально удалили.
 */
function deleteAgent(id) {
  const result = deleteStmt.run(id);
  return result.changes > 0;
}

/**
 * Активные агенты для заданной роли. Роль 'both' включается автоматически.
 * Используется будущим ai-router — сейчас экспортируется как stub для других модулей.
 */
function listActiveByRole(role) {
  if (!ROLES.includes(role)) {
    throw validationError('role');
  }
  return selectActiveByRoleStmt.all(role).map(rowToAgent);
}

// ───────────────────────── внутреннее ─────────────────────────

/**
 * DB-row (snake_case, int для active/booleanов) → API-формат (camelCase, boolean, объект params).
 */
function rowToAgent(row) {
  if (!row) return null;
  let paramsObj = null;
  if (row.params) {
    try { paramsObj = JSON.parse(row.params); }
    catch { paramsObj = null; }
  }
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    role: row.role,
    endpoint: row.endpoint,
    apiKey: row.api_key,
    model: row.model,
    priority: row.priority,
    active: row.active === 1,
    params: paramsObj,
    createdAt: row.created_at,
    updatedAt: row.updated_at
  };
}

/**
 * Валидация для POST — все обязательные поля должны быть.
 * Возвращает нормализованный объект с полями для INSERT.
 */
function validateCreate(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('body', 'bad_body');
  }

  const required = ['name', 'provider', 'role', 'endpoint', 'apiKey', 'model'];
  for (const field of required) {
    if (input[field] === undefined || input[field] === null) {
      throw validationError(field, 'required');
    }
  }

  const out = {};
  out.name     = validateNonEmptyString(input.name, 'name');
  out.provider = validateEnum(input.provider, PROVIDERS, 'provider');
  out.role     = validateEnum(input.role, ROLES, 'role');
  out.endpoint = validateNonEmptyString(input.endpoint, 'endpoint');
  out.apiKey   = validateNonEmptyString(input.apiKey, 'apiKey');
  out.model    = validateNonEmptyString(input.model, 'model');
  out.priority = input.priority === undefined ? 100 : validateInteger(input.priority, 'priority');
  out.active   = input.active === undefined ? 1 : validateBooleanAsInt(input.active, 'active');
  out.params   = input.params === undefined || input.params === null
    ? null
    : validateParamsObject(input.params);

  return out;
}

/**
 * Валидация для PUT/PATCH — только переданные поля. Пустой объект → пустой patch.
 * Возвращает объект { column_name: sqlite_value } готовый к UPDATE.
 */
function validatePatch(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw validationError('body', 'bad_body');
  }

  const patch = {};

  for (const key of Object.keys(input)) {
    if (!UPDATABLE_FIELDS.includes(key)) continue; // неизвестные поля молча игнорируем

    const v = input[key];
    switch (key) {
      case 'name':
        patch.name = validateNonEmptyString(v, 'name');
        break;
      case 'provider':
        patch.provider = validateEnum(v, PROVIDERS, 'provider');
        break;
      case 'role':
        patch.role = validateEnum(v, ROLES, 'role');
        break;
      case 'endpoint':
        patch.endpoint = validateNonEmptyString(v, 'endpoint');
        break;
      case 'apiKey':
        patch.api_key = validateNonEmptyString(v, 'apiKey');
        break;
      case 'model':
        patch.model = validateNonEmptyString(v, 'model');
        break;
      case 'priority':
        patch.priority = validateInteger(v, 'priority');
        break;
      case 'active':
        patch.active = validateBooleanAsInt(v, 'active');
        break;
      case 'params':
        patch.params = (v === null) ? null : validateParamsObject(v);
        break;
    }
  }

  return patch;
}

function validateNonEmptyString(value, field) {
  if (typeof value !== 'string' || value.trim().length === 0) {
    throw validationError(field, 'non_empty_string');
  }
  return value;
}

function validateEnum(value, allowed, field) {
  if (!allowed.includes(value)) {
    throw validationError(field, `one_of:${allowed.join(',')}`);
  }
  return value;
}

function validateInteger(value, field) {
  if (typeof value !== 'number' || !Number.isInteger(value)) {
    throw validationError(field, 'integer');
  }
  return value;
}

function validateBooleanAsInt(value, field) {
  if (value === true || value === 1) return 1;
  if (value === false || value === 0) return 0;
  throw validationError(field, 'boolean');
}

function validateParamsObject(value) {
  if (typeof value !== 'object' || Array.isArray(value)) {
    throw validationError('params', 'object_or_null');
  }
  // Ключи произвольные (зависят от провайдера) — сериализуем как есть.
  return JSON.stringify(value);
}

function validationError(field, reason) {
  const err = new Error(`validation:${field}`);
  err.code = 'validation';
  err.field = field;
  if (reason) err.reason = reason;
  return err;
}

function translateSqliteError(err) {
  // UNIQUE constraint на колонке name → конфликт
  if (err && err.code === 'SQLITE_CONSTRAINT_UNIQUE' && /ai_agents\.name/.test(err.message)) {
    const out = new Error('conflict:name');
    out.code = 'conflict';
    out.field = 'name';
    return out;
  }
  // CHECK constraint (provider/role) — защитная сетка, обычно ловится валидацией выше
  if (err && err.code === 'SQLITE_CONSTRAINT_CHECK') {
    const out = new Error('validation:check');
    out.code = 'validation';
    out.field = /provider/.test(err.message) ? 'provider' : (/role/.test(err.message) ? 'role' : 'unknown');
    out.reason = 'check_failed';
    return out;
  }
  return err;
}

module.exports = {
  listAgents,
  getAgentById,
  createAgent,
  updateAgent,
  deleteAgent,
  listActiveByRole
};
