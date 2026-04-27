-- Миграция 006: добавление полей brand и product_name в scans
-- Применяется один раз: sqlite3 data/kudri.db < 006-add-brand-and-name.sql

ALTER TABLE scans ADD COLUMN brand TEXT;
ALTER TABLE scans ADD COLUMN product_name TEXT;

-- Регистрируем в schema_migrations (если такая таблица есть)
INSERT OR IGNORE INTO schema_migrations(version) VALUES ('006');
