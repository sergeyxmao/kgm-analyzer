# AI-агенты — CRUD админ-API

## Описание
Управление пулом AI-провайдеров (Gemini, OpenAI, DeepSeek, Anthropic), через которые идёт анализ INCI и OCR. Позволяет админу добавлять/редактировать/удалять агентов без деплоя: URL эндпоинта, API-ключ, модель, приоритет, активность, произвольные параметры. Используется ai-router'ом для выбора провайдера по роли (`analyst` / `ocr` / `both` / `image_search`) и priority.

## Расположение файлов
- `backend/services/ai-agents.js` — CRUD + валидация + конвертация row↔agent.
- `backend/routes/admin.js` — Express-роутер, смонтирован на `/api/admin`.
- `backend/middleware/requireAdmin.js` — проверяет `is_admin=1` для всех `/api/admin/*`.
- `backend/services/users.js` — функция `getUserById` для проверки админства.
- БД: таблица `ai_agents` (миграция `backend/db/003-ai-agents.sql`).
- `frontend/index.html` — UI для управления агентами в админ-панели Mini App, объект `AdminAgents` (см. [admin-ui.md](./admin-ui.md)).

## Схема БД
```sql
CREATE TABLE ai_agents (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL UNIQUE,
  provider     TEXT    NOT NULL CHECK (provider IN ('gemini', 'openai', 'deepseek', 'anthropic')),
  role         TEXT    NOT NULL CHECK (role IN ('analyst', 'ocr', 'both', 'image_search')),
  endpoint     TEXT    NOT NULL,
  api_key      TEXT    NOT NULL,
  model        TEXT    NOT NULL,
  priority     INTEGER NOT NULL DEFAULT 100,
  active       INTEGER NOT NULL DEFAULT 1,
  params       TEXT,                          -- JSON-строка
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX idx_ai_agents_role_priority ON ai_agents(role, active, priority);
```

### Формат `Agent` в JSON-ответах
В БД — `snake_case` + `INTEGER` для булевых флагов. Наружу — `camelCase` + `boolean`:

```json
{
  "id": 1,
  "name": "Gemini Flash Lite",
  "provider": "gemini",
  "role": "analyst",
  "endpoint": "https://...",
  "apiKey": "...",
  "model": "gemini-2.5-flash-lite",
  "priority": 10,
  "active": true,
  "params": null,
  "createdAt": "2026-...",
  "updatedAt": "2026-..."
}
```

## Роли
- `analyst` — анализ INCI-составов.
- `ocr` — распознавание текста с фото этикеток.
- `both` — агент подходит для обеих задач (попадает в выборку `listActiveByRole('analyst')` и `listActiveByRole('ocr')`).
- `image_search` — поиск фото товара по `brand + productName` (см. `product-image-finder.md`). Поддерживается только провайдером `gemini` (нужен tool `googleSearch`). В выборки `analyst` / `ocr` не попадает.

## API
Все эндпоинты под `/api/admin/*` защищены связкой `requireTelegramAuth + requireAdmin`. Без валидного `X-Telegram-Init-Data` — `401 unauthorized`. С валидным, но не-админом — `403 not_admin`.

### `GET /api/admin/agents`
Список всех агентов, сортировка: `priority ASC, id ASC`.

```bash
curl -H "X-Telegram-Init-Data: $INIT_DATA" https://api.elenadortman.store/api/admin/agents
```

**Ответ `200`:**
```json
{ "agents": [ { "id": 1, "name": "Gemini Flash Lite", ... }, { ... } ] }
```

### `GET /api/admin/agents/:id`
```bash
curl -H "X-Telegram-Init-Data: $INIT_DATA" https://api.elenadortman.store/api/admin/agents/1
```

**Ответ `200`:** `{ "agent": { ... } }`. Если нет — `404 { "error": "not_found" }`. Некорректный id — `400 bad_id`.

### `POST /api/admin/agents`
Создать нового агента. Обязательные: `name`, `provider`, `role`, `endpoint`, `apiKey`, `model`. Необязательные: `priority` (дефолт `100`), `active` (дефолт `true`), `params` (дефолт `null`; объект, сериализуется в JSON).

```bash
curl -X POST \
  -H "X-Telegram-Init-Data: $INIT_DATA" \
  -H "Content-Type: application/json" \
  -d '{
    "name":"DeepSeek Chat",
    "provider":"deepseek",
    "role":"analyst",
    "endpoint":"https://api.deepseek.com/v1/chat/completions",
    "apiKey":"sk-...",
    "model":"deepseek-chat",
    "priority":30
  }' \
  https://api.elenadortman.store/api/admin/agents
```

**Ответ `201`:** `{ "agent": { ... } }`.

**Ошибки:**
| HTTP | `error`       | Описание                                                                 |
|------|---------------|--------------------------------------------------------------------------|
| 400  | `validation`  | Невалидное поле. Тело: `{ error, field, reason? }`                       |
| 409  | `conflict`    | Дубликат по `name`. Тело: `{ error, field: "name" }`                     |
| 401  | `unauthorized`| Нет/плохой `X-Telegram-Init-Data`                                        |
| 403  | `not_admin`   | Пользователь не админ                                                    |

### `PUT /api/admin/agents/:id`
PATCH-семантика: любое подмножество полей из POST. Меняются только переданные; остальные остаются прежними. `updated_at` обновляется автоматически.

```bash
curl -X PUT \
  -H "X-Telegram-Init-Data: $INIT_DATA" \
  -H "Content-Type: application/json" \
  -d '{"priority": 15, "active": false}' \
  https://api.elenadortman.store/api/admin/agents/1
```

**Ответ `200`:** `{ "agent": { ... } }` (свежее состояние). Нет агента — `404 not_found`. Валидация/конфликт — как в POST.

### `DELETE /api/admin/agents/:id`
```bash
curl -X DELETE -H "X-Telegram-Init-Data: $INIT_DATA" https://api.elenadortman.store/api/admin/agents/5
```

**Ответ `204 No Content`.** Если агента не было — `404 not_found`.

## Безопасность
- Все `/api/admin/*` требуют валидный `X-Telegram-Init-Data` + `is_admin=1` в БД (проверяется каждым запросом — снятое админство мгновенно закрывает доступ).
- `api_key` хранится в plain text — ответственность за доступ к БД лежит на хостинге (MVP).
- `params` сериализуется через `JSON.stringify` на стороне сервера — произвольный JSON-объект, ключи зависят от провайдера.
- В ответах `api_key` отдаётся как есть — эндпоинт доступен только админам, им ключ нужен для редактирования.

## История изменений
- 2026-04-24: Создано (вторая попытка после revert неудачной первой, см. PR #10 → коммит `d94d89c`). Первая попытка упала из-за расхождения выдуманной схемы с реальной; во второй схема сверена с prod до написания кода.
- 2026-04-26: Добавлен UI в Mini App (см. [admin-ui.md](./admin-ui.md)). Удалён мёртвый код Gemini-ключа из эпохи GitHub Pages.
- 2026-04-27: Добавлена роль `image_search` (миграция 008 расширяет CHECK-ограничение `ai_agents.role`). Используется фоновым поиском фото товара — см. `product-image-finder.md`.
