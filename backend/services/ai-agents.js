/**
 * КУДРИ · CRUD для таблицы ai_agents (пул AI-провайдеров с приоритетами).
 *
 * Назначение: администратор через /api/admin/agents управляет списком агентов
 * (провайдер, модель, ключ, роль, приоритет). Функция listActiveByRole()
 * используется бэкендом для выбора активного агента конкретной роли по приоритету.
 *
 * В MVP api_key хранится в plain text (так решено — см. docs/technical/ai-agents.md).
 * Структура таблицы создаётся владельцем вручную на сервере.
 */

const { db } = require('./db');

const PROVIDERS = ['gemini', 'openai', 'anthropic', 'deepseek', 'openrouter'];
const ROLES     = ['analyze', 'ocr', 'chat', 'embedding'];

const NAME_MAX   = 100;
const MODEL_MAX  = 100;
const APIKEY_MAX = 500;
const URL_MAX    = 500;
const NOTES_MAX  = 2000;

const selectAllStmt = db.prepare(
  `SELECT * FROM ai_agents ORDER BY role, priority DESC, id`
);
const selectByIdStmt = db.prepare(
  `SELECT * FROM ai_agents WHERE id = ?`
);
const selectActiveByRoleStmt = db.prepare(
  `SELECT * FROM ai_agents WHERE role = ? AND is_active = 1 ORDER BY priority DESC, id`
);
const insertStmt = db.prepare(`
  INSERT INTO ai_agents
    (name, provider, model, role, api_key, base_url, temperature, max_tokens, priority, is_active, notes)
  VALUES
    (@name, @provider, @model, @role, @api_key, @base_url, @temperature, @max_tokens, @priority, @is_active, @notes)
`);
const deleteStmt = db.prepare(
  `DELETE FROM ai_agents WHERE id = ?`
);

function listAgents() {
  return selectAllStmt.all().map(rowToAgent);
}

function getAgentById(id) {
  const row = selectByIdStmt.get(id);
  return row ? rowToAgent(row) : null;
}

/**
 * Возвращает активных агентов указанной роли, отсортированных по приоритету
 * (от высокого к низкому). Заготовка для services/analyze.js (ТЗ B2).
 */
function listActiveByRole(role) {
  if (!ROLES.includes(role)) return [];
  return selectActiveByRoleStmt.all(role).map(rowToAgent);
}

/**
 * Создаёт нового агента. Возвращает { agent } или { error, field? }.
 */
function createAgent(input) {
  const v = validate(input, { requireAll: true });
  if (v.error) return v;

  const info = insertStmt.run({
    name:        v.data.name,
    provider:    v.data.provider,
    model:       v.data.model,
    role:        v.data.role,
    api_key:     v.data.api_key ?? null,
    base_url:    v.data.base_url ?? null,
    temperature: v.data.temperature ?? null,
    max_tokens:  v.data.max_tokens ?? null,
    priority:    v.data.priority ?? 0,
    is_active:   v.data.is_active ?? 1,
    notes:       v.data.notes ?? null
  });

  return { agent: getAgentById(info.lastInsertRowid) };
}

/**
 * PATCH-обновление. Поля, отсутствующие в body, не затрагиваются.
 * Возвращает { agent } при успехе, { error, field? } при валидации,
 * null если запись не найдена.
 */
function updateAgent(id, input) {
  const existing = selectByIdStmt.get(id);
  if (!existing) return null;

  const v = validate(input, { requireAll: false });
  if (v.error) return v;

  // Собираем SET-выражение только из присутствующих в input полей
  const keys = Object.keys(v.data);
  if (keys.length === 0) return { error: 'bad_body' };

  const setSql = keys.map(k => `${k} = @${k}`).join(', ');
  const sql = `UPDATE ai_agents SET ${setSql}, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ','now') WHERE id = @id`;
  const params = { ...v.data, id };
  db.prepare(sql).run(params);

  return { agent: getAgentById(id) };
}

function deleteAgent(id) {
  const result = deleteStmt.run(id);
  return result.changes > 0;
}

/**
 * Валидация и нормализация (camelCase → snake_case).
 * При requireAll — проверяем обязательные поля (для POST).
 * При !requireAll — валидируем только то, что пришло (PATCH).
 */
function validate(input, { requireAll }) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'bad_body' };
  }

  const n = {};
  if ('name'        in input) n.name        = input.name;
  if ('provider'    in input) n.provider    = input.provider;
  if ('model'       in input) n.model       = input.model;
  if ('role'        in input) n.role        = input.role;
  if      ('api_key'  in input) n.api_key  = input.api_key;
  else if ('apiKey'   in input) n.api_key  = input.apiKey;
  if      ('base_url' in input) n.base_url = input.base_url;
  else if ('baseUrl'  in input) n.base_url = input.baseUrl;
  if ('temperature' in input) n.temperature = input.temperature;
  if      ('max_tokens' in input) n.max_tokens = input.max_tokens;
  else if ('maxTokens'  in input) n.max_tokens = input.maxTokens;
  if ('priority'    in input) n.priority    = input.priority;
  if      ('is_active' in input) n.is_active = input.is_active;
  else if ('isActive'  in input) n.is_active = input.isActive;
  if ('notes'       in input) n.notes       = input.notes;

  if (requireAll) {
    for (const req of ['name', 'provider', 'model', 'role']) {
      if (!(req in n) || n[req] === null || n[req] === undefined || n[req] === '') {
        return { error: 'field_required', field: req };
      }
    }
  }

  const data = {};

  if ('name' in n) {
    if (typeof n.name !== 'string' || n.name.length === 0 || n.name.length > NAME_MAX) {
      return { error: 'bad_value', field: 'name' };
    }
    data.name = n.name;
  }
  if ('provider' in n) {
    if (!PROVIDERS.includes(n.provider)) {
      return { error: 'bad_value', field: 'provider' };
    }
    data.provider = n.provider;
  }
  if ('model' in n) {
    if (typeof n.model !== 'string' || n.model.length === 0 || n.model.length > MODEL_MAX) {
      return { error: 'bad_value', field: 'model' };
    }
    data.model = n.model;
  }
  if ('role' in n) {
    if (!ROLES.includes(n.role)) {
      return { error: 'bad_value', field: 'role' };
    }
    data.role = n.role;
  }
  if ('api_key' in n) {
    if (n.api_key !== null) {
      if (typeof n.api_key !== 'string' || n.api_key.length > APIKEY_MAX) {
        return { error: 'bad_value', field: 'api_key' };
      }
    }
    data.api_key = n.api_key;
  }
  if ('base_url' in n) {
    if (n.base_url !== null) {
      if (typeof n.base_url !== 'string' || n.base_url.length > URL_MAX) {
        return { error: 'bad_value', field: 'base_url' };
      }
    }
    data.base_url = n.base_url;
  }
  if ('temperature' in n) {
    if (n.temperature !== null) {
      if (typeof n.temperature !== 'number' || n.temperature < 0 || n.temperature > 2) {
        return { error: 'bad_value', field: 'temperature' };
      }
    }
    data.temperature = n.temperature;
  }
  if ('max_tokens' in n) {
    if (n.max_tokens !== null) {
      if (!Number.isInteger(n.max_tokens) || n.max_tokens < 1 || n.max_tokens > 200000) {
        return { error: 'bad_value', field: 'max_tokens' };
      }
    }
    data.max_tokens = n.max_tokens;
  }
  if ('priority' in n) {
    if (!Number.isInteger(n.priority) || n.priority < 0 || n.priority > 1000) {
      return { error: 'bad_value', field: 'priority' };
    }
    data.priority = n.priority;
  }
  if ('is_active' in n) {
    if (typeof n.is_active === 'boolean') {
      data.is_active = n.is_active ? 1 : 0;
    } else if (n.is_active === 0 || n.is_active === 1) {
      data.is_active = n.is_active;
    } else {
      return { error: 'bad_value', field: 'is_active' };
    }
  }
  if ('notes' in n) {
    if (n.notes !== null) {
      if (typeof n.notes !== 'string' || n.notes.length > NOTES_MAX) {
        return { error: 'bad_value', field: 'notes' };
      }
    }
    data.notes = n.notes;
  }

  return { data };
}

function rowToAgent(row) {
  return {
    id:          row.id,
    name:        row.name,
    provider:    row.provider,
    model:       row.model,
    role:        row.role,
    apiKey:      row.api_key,
    baseUrl:     row.base_url,
    temperature: row.temperature,
    maxTokens:   row.max_tokens,
    priority:    row.priority,
    isActive:    row.is_active === 1,
    notes:       row.notes,
    createdAt:   row.created_at,
    updatedAt:   row.updated_at
  };
}

module.exports = {
  listAgents,
  getAgentById,
  listActiveByRole,
  createAgent,
  updateAgent,
  deleteAgent,
  PROVIDERS,
  ROLES
};
