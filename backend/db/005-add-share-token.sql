-- КУДРИ · миграция 005 · поддержка публичного шеринга сканов
-- Дата: 2026-04-27
--
-- Добавляет в scans колонку share_token (UUID).
-- NULL = скан приватный (не расшарен).
-- Не-NULL = скан имеет публичный URL вида /share/<token>.
--
-- UNIQUE INDEX partial — гарантирует уникальность только среди заполненных токенов.

PRAGMA foreign_keys = ON;

ALTER TABLE scans ADD COLUMN share_token TEXT;

CREATE UNIQUE INDEX idx_scans_share_token
  ON scans(share_token)
  WHERE share_token IS NOT NULL;

INSERT INTO schema_migrations (version) VALUES (5);
