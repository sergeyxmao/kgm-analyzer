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

### `GET /api/me`
Возвращает текущего пользователя (по Telegram initData). Защищён middleware requireTelegramAuth.

Требует заголовок `X-Telegram-Init-Data`. Подробнее — `docs/technical/auth-telegram.md`.

**Ответ 200 OK** (см. auth-telegram.md).
**Ответ 401** при невалидной подписи или отсутствии заголовка.

Потребитель: `frontend/index.html` (`Auth.loginTelegram()`), см. `docs/technical/frontend-auth-integration.md`.

### `GET /api/profile`
Профиль текущего пользователя. Защищён `requireTelegramAuth`. Подробнее — `docs/technical/profile.md`.

Возвращает `{ "profile": {...} }` если профиль создан, `{ "profile": null }` если нет.

Потребитель: `frontend/index.html` (`Auth.afterLogin()`), см. `docs/technical/frontend-auth-integration.md`.

### `PUT /api/profile`
Создаёт/обновляет профиль (PATCH-семантика: отсутствующие в теле поля не меняются). Защищён `requireTelegramAuth`. Body — JSON с полями профиля (см. `docs/technical/profile.md`). На входе принимаются оба формата ключей — snake_case и camelCase. Валидация значений по enum-спискам. При успехе — `{ "profile": {...} }`. При невалидном значении — `400` с указанием поля.

Потребитель: `frontend/index.html` (`Onboarding.finish()`), см. `docs/technical/frontend-auth-integration.md`.

### `POST /api/analyze`
Анализ INCI через Gemini. Защищён `requireTelegramAuth`. Принимает `{ content: { type: 'text'|'image', data: string } }`. Возвращает JSON-вердикт (`verdict`, `verdictTitle`, `productType`, `summary`, `ingredients`). При ошибке валидации — `400` с полем `error`; при проблемах с внешним AI — `502` с подробным кодом (`gemini_*`, `bad_ai_*`). Подробнее — `docs/technical/ai-analyze.md`.

Тело запроса может быть крупным (base64-фото) — для этого на уровне Express поднят лимит JSON до `10mb`.

Потребитель: `frontend/index.html` (`Scanner.analyze`), см. `docs/technical/scanner-flow.md`.

### `POST /api/scans`, `GET /api/scans`, `PUT /api/scans/:id/shelf`, `DELETE /api/scans/:id`
CRUD для сканов. Всё защищено `requireTelegramAuth`. `POST` создаёт запись после успешного `/api/analyze` (фильтр через `user_id` — пользователь видит только свои сканы). `GET` принимает `?shelf=all|history|mine|wishlist|rejected` и `?limit=` (1..100, default 50), `all` отдаёт всё включая `history`. `PUT /api/scans/:id/shelf` перемещает на полку, `DELETE` удаляет. Подробнее — `docs/technical/scans-api.md`.

Потребители: `frontend/index.html` (`Scanner.saveTo`, `Catalog.load`, `App.refreshRecent`), см. `docs/technical/scanner-flow.md`.

### `POST /api/scans/full-photo`
Vision-режим: фото → S3 (Beget) → AI → запись в БД одним вызовом. Защищён `requireTelegramAuth`. `multipart/form-data`, поле `photo` (JPEG/PNG, ≤ 2 МБ). Возвращает `{scan}` с `photoKey` и `photoUrl` (presigned GET, 1 час). Подробнее — `docs/technical/photo-analysis.md`.

Потребитель: `frontend/index.html` (`Scanner.analyzePhoto`).

### `POST /telegram/webhook/<secret>`
Endpoint для Telegram webhook. Принимает обновления от Telegram API. Подробнее — `docs/technical/telegram-bot.md`.

Не вызывается фронтендом. Не имеет защиты `requireTelegramAuth` — secret в URL играет роль пароля.

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
| `TG_BOT_TOKEN` | Токен Telegram-бота (для будущих ТЗ) | — |
| `TG_WEBHOOK_SECRET` | 32-байт hex для пути webhook Telegram-бота | — |
| `ADMIN_TG_ID` | Telegram ID администратора | `845707896` |
| `DB_PATH` | Путь к SQLite-БД (для будущих ТЗ) | `./data/kudri.db` |
| `S3_ENDPOINT` | URL S3-совместимого хранилища (Beget Cloud Storage) | — |
| `S3_BUCKET` | Имя bucket для фото сканов | — |
| `S3_ACCESS_KEY` | Access key Beget S3 | — |
| `S3_SECRET_KEY` | Secret key Beget S3 | — |
| `S3_PHOTO_PREFIX` | Префикс ключей для фото в bucket | `kudri-photos/` |

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
- 2026-04-26: Удалена переменная `GEMINI_API_KEY` — настройки AI переехали в таблицу `ai_agents`.
- 2026-04-26: Подключён Telegram-бот через webhook. Добавлена переменная `TG_WEBHOOK_SECRET`.
- 2026-04-26: Добавлены S3-переменные (Beget Cloud Storage), эндпоинт `/api/scans/full-photo` для vision-анализа.
