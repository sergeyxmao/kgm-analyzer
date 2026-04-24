-- КУДРИ · миграция 001 · начальная схема
-- Дата: 2026-04-24

PRAGMA foreign_keys = ON;

-- ─── Пользователи ──────────────────────────────────────────
-- Единая таблица для TG/VK/guest. platform_id — строка вида 'tg_845707896' или 'guest_abc123'.
CREATE TABLE users (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  platform        TEXT    NOT NULL CHECK (platform IN ('tg', 'vk', 'guest')),
  platform_id     TEXT    NOT NULL,
  username        TEXT,
  first_name      TEXT,
  last_name       TEXT,
  photo_url       TEXT,
  is_admin        INTEGER NOT NULL DEFAULT 0,
  created_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  last_seen_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  UNIQUE (platform, platform_id)
);

CREATE INDEX idx_users_platform_id ON users(platform, platform_id);

-- ─── Профиль волос ─────────────────────────────────────────
-- 1-к-1 с users. Хранит ответы из онбординга.
CREATE TABLE profiles (
  user_id         INTEGER PRIMARY KEY,
  curl_type       TEXT,    -- '2A' | '2B' | '2C' | '3A' | '3B' | '3C' | '4'
  porosity        TEXT,    -- 'low' | 'medium' | 'high' | 'unknown'
  thickness       TEXT,    -- 'thin' | 'medium' | 'thick'
  scalp           TEXT,    -- 'oily' | 'normal' | 'dry' | 'sensitive' | 'mixed'
  color_state     TEXT,    -- произвольный текст про окрашивание
  goals           TEXT,    -- JSON-массив: ["hydration","frizz",...]
  updated_at      TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- ─── История сканов ────────────────────────────────────────
CREATE TABLE scans (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id         INTEGER NOT NULL,
  product_type    TEXT,                         -- 'шампунь' | 'кондиционер' | ...
  verdict         TEXT CHECK (verdict IN ('good','warn','bad')) NOT NULL,
  verdict_title   TEXT,                         -- 'Подходит' | 'С оговорками' | 'Не подходит'
  summary         TEXT,                         -- краткое резюме вердикта
  ingredients     TEXT,                         -- JSON: [{name, status, note}, ...]
  photo_path      TEXT,                         -- путь к файлу в uploads/ (опционально)
  raw_inci        TEXT,                         -- распознанный/введённый текст INCI
  shelf           TEXT NOT NULL DEFAULT 'history'
                  CHECK (shelf IN ('history','mine','wishlist','rejected')),
  created_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE INDEX idx_scans_user_created ON scans(user_id, created_at DESC);
CREATE INDEX idx_scans_user_shelf   ON scans(user_id, shelf);

-- ─── Глобальные настройки ──────────────────────────────────
-- Ключ-значение для админ-настроек (AI-агенты, лимиты, флаги).
-- Используется позже в админ-панели.
CREATE TABLE settings (
  key             TEXT PRIMARY KEY,
  value           TEXT NOT NULL,
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- Версионирование миграций
CREATE TABLE schema_migrations (
  version         INTEGER PRIMARY KEY,
  applied_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

INSERT INTO schema_migrations (version) VALUES (1);
