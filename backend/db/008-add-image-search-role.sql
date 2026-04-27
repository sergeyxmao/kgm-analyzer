-- Миграция 008: добавляем роль 'image_search' в CHECK-ограничение ai_agents.role
-- Применяется один раз: sqlite3 data/kudri.db < 008-add-image-search-role.sql
--
-- SQLite не умеет ALTER TABLE ... DROP CHECK, поэтому пересоздаём таблицу.
-- Данные переносятся через временную таблицу. Индекс idx_ai_agents_role_priority
-- восстанавливаем после.

BEGIN TRANSACTION;

CREATE TABLE ai_agents_new (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL UNIQUE,
  provider     TEXT    NOT NULL CHECK (provider IN ('gemini', 'openai', 'deepseek', 'anthropic')),
  role         TEXT    NOT NULL CHECK (role IN ('analyst', 'ocr', 'both', 'image_search')),
  endpoint     TEXT    NOT NULL,
  api_key      TEXT    NOT NULL,
  model        TEXT    NOT NULL,
  priority     INTEGER NOT NULL DEFAULT 100,
  active       INTEGER NOT NULL DEFAULT 1,
  params       TEXT,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT INTO ai_agents_new
  (id, name, provider, role, endpoint, api_key, model, priority, active, params, created_at, updated_at)
SELECT id, name, provider, role, endpoint, api_key, model, priority, active, params, created_at, updated_at
FROM ai_agents;

DROP TABLE ai_agents;
ALTER TABLE ai_agents_new RENAME TO ai_agents;

CREATE INDEX IF NOT EXISTS idx_ai_agents_role_priority ON ai_agents(role, active, priority);

INSERT OR IGNORE INTO schema_migrations(version) VALUES ('008');

COMMIT;
