-- Миграция 007: добавление полей product_image_url и product_image_status в scans
-- Применяется один раз: sqlite3 data/kudri.db < 007-add-product-image.sql

ALTER TABLE scans ADD COLUMN product_image_url TEXT;
ALTER TABLE scans ADD COLUMN product_image_status TEXT;

INSERT OR IGNORE INTO schema_migrations(version) VALUES ('007');
