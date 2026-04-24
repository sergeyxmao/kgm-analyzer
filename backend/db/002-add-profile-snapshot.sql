-- КУДРИ · миграция 002 · profile_snapshot в scans
-- Дата: 2026-04-24
--
-- Зачем: сохраняем снимок профиля пользователя на момент скана (curlType, porosity, ...),
-- чтобы при пересмотре старой истории было видно, в какой форме был профиль во время анализа.
-- Поле опциональное (NULL если фронт не прислал snapshot).

PRAGMA foreign_keys = ON;

ALTER TABLE scans ADD COLUMN profile_snapshot TEXT;

INSERT INTO schema_migrations (version) VALUES (2);
