-- КУДРИ · миграция 004 · scans.photo_path → scans.photo_key
-- Дата: 2026-04-26
--
-- Зачем: фото теперь хранится в S3 (Beget Cloud Storage), а не на локальном диске.
-- Поле теперь хранит S3-ключ (например 'kudri-photos/scans/<uuid>.jpg'), а не файловый путь.
-- См. docs/technical/photo-analysis.md.

PRAGMA foreign_keys = ON;

ALTER TABLE scans RENAME COLUMN photo_path TO photo_key;

INSERT INTO schema_migrations (version) VALUES (4);
