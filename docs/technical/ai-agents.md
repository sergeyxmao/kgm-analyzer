# AI-агенты (`/api/admin/agents`)

## Описание
Таблица `ai_agents` — пул AI-провайдеров/моделей с приоритетами и флагом активности. Админ управляет ими через `/api/admin/agents`. В `services/analyze.js` (ТЗ B2) появится выбор активного агента по роли через `listActiveByRole(role)`.

В MVP `api_key` хранится **в plain text** — это осознанное упрощение. Шифрование будет в отдельном ТЗ (см. «Безопасность» ниже).

## Расположение файлов
- `backend/services/ai-agents.js` — CRUD + `listActiveByRole`.
- `backend/middleware/requireAdmin.js` — проверка `is_admin` у `req.user`.
- `backend/server.js` — эндпоинты `/api/admin/agents*`.
- БД: таблица `ai_agents` (схема ниже, создаётся владельцем вручную).

## Схема БД

```sql
CREATE TABLE ai_agents (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,                       -- человекочитаемое имя, напр. 'Gemini Flash Lite'
  provider      TEXT    NOT NULL CHECK (provider IN ('gemini','openai','anthropic','deepseek','openrouter')),
  model         TEXT    NOT NULL,                       -- идентификатор модели, напр. 'gemini-2.0-flash-lite'
  role          TEXT    NOT NULL CHECK (role IN ('analyze','ocr','chat','embedding')),
  api_key       TEXT,                                   -- plain text (MVP)
  base_url      TEXT,                                   -- кастомный base URL (OpenRouter/DeepSeek и т.п.)
  temperature   REAL,                                   -- 0..2
  max_tokens    INTEGER,                                -- 1..200000
  priority      INTEGER NOT NULL DEFAULT 0,             -- 0..1000, выше = предпочтительней
  is_active     INTEGER NOT NULL DEFAULT 1,             -- 0/1
  notes         TEXT,                                   -- свободный комментарий админа
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

CREATE INDEX idx_ai_agents_role_active ON ai_agents(role, is_active, priority DESC);

-- Дефолтный агент:
INSERT INTO ai_agents (name, provider, model, role, priority, is_active)
  VALUES ('Gemini Flash Lite', 'gemini', 'gemini-2.0-flash-lite', 'analyze', 10, 1);
```

## Словари

| Поле       | Допустимые значения |
|------------|---------------------|
| `provider` | `gemini`, `openai`, `anthropic`, `deepseek`, `openrouter` |
| `role`     | `analyze`, `ocr`, `chat`, `embedding` |

## Авторизация
Все эндпоинты требуют:
1. Валидный `X-Telegram-Init-Data` (`requireTelegramAuth`) → `req.user`.
2. `req.user.is_admin === 1` (`requireAdmin`). Админом назначается пользователь с `tg.id === ADMIN_TG_ID` (см. `backend/services/users.js`).

| Отсутствует auth | 401 `unauthorized` |
| Не админ        | 403 `forbidden`    |

## API

### `GET /api/admin/agents`
Список всех агентов, отсортирован по `role`, затем `priority DESC`, `id`.

**Ответ `200 OK`:**
```json
{ "agents": [ { "id": 1, "name": "Gemini Flash Lite", "provider": "gemini", "model": "gemini-2.0-flash-lite", "role": "analyze", "apiKey": null, "baseUrl": null, "temperature": null, "maxTokens": null, "priority": 10, "isActive": true, "notes": null, "createdAt": "...", "updatedAt": "..." } ] }
```

### `GET /api/admin/agents/:id`
Один агент.

**Ответ `200 OK`:** `{ "agent": { ... } }`
**Ошибки:** `400 bad_id`, `404 not_found`.

### `POST /api/admin/agents`
Создать агента. `Content-Type: application/json`.

**Тело (обязательные поля `name`, `provider`, `model`, `role`):**
```json
{
  "name": "DeepSeek Chat",
  "provider": "deepseek",
  "model": "deepseek-chat",
  "role": "analyze",
  "apiKey": "sk-...",
  "baseUrl": "https://api.deepseek.com",
  "temperature": 0.2,
  "maxTokens": 2048,
  "priority": 20,
  "isActive": true,
  "notes": "бэкап на случай квоты Gemini"
}
```

Ключи принимаются и в `camelCase`, и в `snake_case`.

**Ответ `201 Created`:** `{ "agent": { ... } }`

**Ошибки:**
| HTTP | `error`           | Описание |
|------|-------------------|----------|
| 400  | `bad_body`        | Тело не объект |
| 400  | `field_required`  | Пропущено обязательное поле (`field`: имя) |
| 400  | `bad_value`       | Невалидное значение поля (`field`: имя) |
| 401  | `unauthorized`    | Нет/невалидный `X-Telegram-Init-Data` |
| 403  | `forbidden`       | Пользователь не админ |
| 500  | `create_failed`   | Неожиданная серверная ошибка |

### `PUT /api/admin/agents/:id`
PATCH-семантика: меняются только присутствующие в теле поля.

**Тело (пример — поднять приоритет):**
```json
{ "priority": 15 }
```

**Ответ `200 OK`:** `{ "agent": { ... } }`

**Ошибки:** `400 bad_id`/`bad_body`/`bad_value`, `404 not_found`, и те же что у POST.

### `DELETE /api/admin/agents/:id`
Удаляет запись.

**Ответ `204 No Content`.**

**Ошибки:** `400 bad_id`, `404 not_found`.

## Функция `listActiveByRole(role)`
Чистая функция уровня сервиса (не эндпоинт). Возвращает активных агентов указанной роли, отсортированных по `priority DESC`. Пустой массив, если роль не из словаря или нет подходящих записей.

Используется бэкендом (в будущем ТЗ B2 — `services/analyze.js`) для выбора основного и резервных агентов:
```js
const { listActiveByRole } = require('./services/ai-agents');
const [primary, ...fallbacks] = listActiveByRole('analyze');
```

**В текущем ТЗ функция только экспортируется — в `analyze.js` не подключается.**

## Безопасность
- `api_key` в MVP **не шифруется**. База расположена на сервере (не реплицируется), доступ по SSH. Риск — утечка `.db`-файла. Шифрование (AES-GCM с KEK из env) — следующее ТЗ.
- Выдача ключей наружу: в API-ответах (`apiKey`) ключ отдаётся **только админу** (`requireAdmin`). На фронте (ТЗ B3) показывать маскированно.
- Валидация провайдера/роли через CHECK-констрейнты БД + JS-словари (`PROVIDERS`, `ROLES`). Двойная защита.

## Ограничения / нерешённое
- Нет аудита (кто менял, когда). Если понадобится — отдельная таблица `ai_agents_audit`.
- `listActiveByRole` не кеширует результат. При нагрузке >100 RPS придётся добавить in-memory кеш с инвалидацией на write.
