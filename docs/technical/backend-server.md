# Backend сервер

## Описание
Минимальный Express-сервер КУДРИ. Точка входа Node.js API. Сейчас реализует только health-check; бизнес-логика (анализ, auth, история) добавляется следующими ТЗ.

## Расположение файлов
- `backend/server.js` — точка входа.
- `backend/package.json` — зависимости и npm-скрипты.
- `backend/.env.example` — шаблон переменных окружения.
- `backend/.env` — реальные значения (на сервере, вне git).

## Как работает
1. `server.js` стартует через `node server.js` или `npm start`.
2. Читает `backend/.env` через dotenv.
3. Запускает Express на `127.0.0.1:PORT` (по умолчанию `3001`).
4. Слушает ТОЛЬКО localhost — наружу сервер проксируется nginx (на продакшене через `api.elenadortman.store`).

## API

### `GET /health`
Проверка что сервис жив. Используется мониторингом, автодеплоем, отладкой.

**Ответ 200 OK:**
```json
{
  "status": "ok",
  "service": "kudri-api",
  "version": "0.1.0",
  "uptime": 42,
  "timestamp": "2026-04-24T12:34:56.000Z"
}
```

### `GET /db-status`
Диагностика БД. Возвращает: путь к файлу, версию схемы, список таблиц, количество строк в каждой. Используется для верификации что Node видит БД и схема применена.

**Ответ 200 OK:**
```json
{
  "status": "ok",
  "dbPath": "/var/www/kudri/data/kudri.db",
  "schemaVersion": 1,
  "tables": ["profiles", "scans", "schema_migrations", "settings", "users"],
  "counts": { "users": 0, "profiles": 0, "scans": 0, "settings": 0, "schema_migrations": 1 }
}
```

**Ответ 500 при ошибке БД:**
```json
{ "status": "error", "error": "SQLITE_CANTOPEN: unable to open database file" }
```

### Любой другой путь
Ответ `404 Not Found`:
```json
{ "error": "Not found", "path": "/some/path" }
```

## Настройки
Все значения берутся из `backend/.env`. Шаблон — `backend/.env.example`.

| Переменная | Назначение | Дефолт |
|---|---|---|
| `PORT` | Порт Express-сервера | `3001` |
| `GEMINI_API_KEY` | Ключ Google Gemini (для будущих ТЗ) | — |
| `TG_BOT_TOKEN` | Токен Telegram-бота (для будущих ТЗ) | — |
| `ADMIN_TG_ID` | Telegram ID администратора | `845707896` |
| `DB_PATH` | Путь к SQLite-БД (для будущих ТЗ) | `./data/kudri.db` |

## Запуск локально
```bash
cd backend
cp .env.example .env   # и заполнить значения
npm install
npm start
```

Потом:
```bash
curl http://127.0.0.1:3001/health
```

## История изменений
- 2026-04-24: Создан файл. Минимальный сервер с `/health` + 404/500 хендлерами.
