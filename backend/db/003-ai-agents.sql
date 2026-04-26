-- Миграция 003: таблица AI-агентов + колонка provider в scans
-- Применяется вручную: sqlite3 data/kudri.db < backend/db/003-ai-agents.sql

CREATE TABLE IF NOT EXISTS ai_agents (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL UNIQUE,
  provider     TEXT    NOT NULL CHECK (provider IN ('gemini', 'openai', 'deepseek', 'anthropic')),
  role         TEXT    NOT NULL CHECK (role IN ('analyst', 'ocr', 'both')),
  endpoint     TEXT    NOT NULL,
  api_key      TEXT    NOT NULL,
  model        TEXT    NOT NULL,
  priority     INTEGER NOT NULL DEFAULT 100,
  active       INTEGER NOT NULL DEFAULT 1,
  params       TEXT,
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX IF NOT EXISTS idx_ai_agents_role_priority ON ai_agents(role, active, priority);

-- Добавляем колонку provider в scans для трекинга кто анализировал
-- ВАЖНО: SQLite не поддерживает ADD COLUMN IF NOT EXISTS — проверяем через PRAGMA
-- Если колонка уже есть (повторная миграция) — эта команда упадёт, игнорируем
ALTER TABLE scans ADD COLUMN provider TEXT;

-- Метка что миграция применена (version=3)
INSERT OR IGNORE INTO schema_migrations (version) VALUES (3);
