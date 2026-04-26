# База данных

## Описание
SQLite. Файл `data/kudri.db`. Работает через `better-sqlite3` (синхронный API, без callback-ов, без промисов — но это безопасно, т.к. сам движок под капотом использует native C-библиотеку).

## Расположение файлов
- `data/kudri.db` — файл БД (вне git).
- `backend/db/*.sql` — SQL-миграции (выполняются вручную владельцем, не Claude Code).
- `backend/services/db.js` — модуль подключения и вспомогательные функции.

## Как работает
- При импорте `services/db.js` открывает соединение с БД (путь из `DB_PATH` в `.env`).
- Соединение глобальное, одно на процесс. `better-sqlite3` поддерживает высокий параллелизм через WAL-режим.
- PRAGMA `foreign_keys = ON` — иначе SQLite не будет соблюдать FK-ограничения.
- PRAGMA `journal_mode = WAL` — Write-Ahead Log, позволяет читать во время записи.

## Схема
Актуальная версия: **1** (из `schema_migrations`).

### Таблицы
- **users** — платформа (`tg`/`vk`/`guest`), platform_id, имена, флаг админа. Уникальность по паре `(platform, platform_id)`.
- **profiles** — 1-к-1 с users. Параметры волос из онбординга: тип кудрей, пористость, толщина, кожа головы, цели (JSON).
- **scans** — история сканов. FK → users. Индекс по `(user_id, created_at DESC)` для быстрой выдачи "последние 10 сканов".
- **settings** — ключ-значение. Для админских настроек (лимиты, флаги, AI-агенты).
- **schema_migrations** — версионирование. При добавлении колонки/таблицы создаётся миграция `002-*.sql`, в конце `INSERT INTO schema_migrations VALUES (2)`.

## API
- **GET /db-status** — диагностика. Возвращает версию схемы, список таблиц, количество строк:
```json
  {
    "status": "ok",
    "dbPath": "/var/www/kudri/data/kudri.db",
    "schemaVersion": 1,
    "tables": ["profiles", "scans", "schema_migrations", "settings", "users"],
    "counts": { "users": 0, "profiles": 0, ... }
  }
```

## Как добавить миграцию
1. Создать `backend/db/002-название.sql` с нужными `ALTER TABLE` / `CREATE TABLE`.
2. В конце миграции: `INSERT INTO schema_migrations (version) VALUES (2);`
3. Владелец выполняет вручную: `sqlite3 /var/www/kudri/data/kudri.db < backend/db/002-название.sql`
4. Claude Code не трогает БД.

## История изменений
- 2026-04-24: Миграция 001. Начальная схема (users, profiles, scans, settings, schema_migrations).
- 2026-04-26: Миграция 004. Переименована `scans.photo_path` → `scans.photo_key` (теперь хранит S3-ключ, а не путь).
