# Анализ INCI — `/api/analyze`

## Описание
Серверный прокси к AI-провайдерам для анализа косметических составов. Запросы идут через AI-роутер с fallback (см. `docs/technical/ai-router.md`). Сейчас в БД настроены агенты Gemini и OpenAI: при достижении квоты Gemini роутер автоматически переключается на OpenAI. Ключи провайдеров хранятся в таблице `ai_agents` и не попадают на фронт. Сервер подставляет профиль пользователя в промпт — анализ персонализированный.

## Расположение файлов
- `backend/services/ai-router.js` — роутер AI-провайдеров (см. `docs/technical/ai-router.md`).
- `backend/services/analyze.js` — логика: сборка промпта, валидация входа, парсинг ответа.
- `backend/server.js` — эндпоинт `POST /api/analyze`.

## API

### `POST /api/analyze`
Защищён `requireTelegramAuth`. `Content-Type: application/json`.

**Тело запроса:**
```json
{
  "content": {
    "type": "image" | "text",
    "data": "<base64 или dataURL для image, произвольный текст для text>"
  }
}
```

- `image`: `data` может быть либо полным dataURL (`data:image/jpeg;base64,...`), либо чистым base64. MIME определяется автоматически, по умолчанию `image/jpeg`.
- `text`: `data` — текст INCI, до 8000 символов.

**Ответ 200 OK** (формат от AI):
```json
{
  "verdict": "good" | "warn" | "bad",
  "verdictTitle": "Подходит" | "С оговорками" | "Не подходит",
  "productType": "шампунь",
  "summary": "Короткое объяснение",
  "ingredients": [
    {"name": "Aqua", "status": "good", "note": "вода — основа, нейтральна"},
    {"name": "Sodium Laureth Sulfate", "status": "bad", "note": "для сухой кожи головы слишком агрессивен"}
  ]
}
```

**Ответы с ошибкой:**

| HTTP | `error` | Описание |
|---|---|---|
| 400 | `bad_input` | тело не объект или `content` не объект |
| 400 | `bad_type` | `content.type` не `'text'` и не `'image'` |
| 400 | `empty_data` | `content.data` пустой или не строка |
| 400 | `text_too_long` | текст длиннее 8000 символов |
| 400 | `image_too_large` | base64 длиннее 8 МБ (примерно 6 МБ фото) |
| 401 | `unauthorized` | нет/невалидный `X-Telegram-Init-Data` |
| 502 | `no_active_agents` | в таблице `ai_agents` нет активных агентов с ролью `analyst`/`both` |
| 502 | `network` | сетевая ошибка к провайдеру (DNS, reset, TLS…) |
| 502 | `timeout` | провайдер не ответил за 60 сек |
| 502 | `http_4xx` | провайдер вернул HTTP 4xx (плохой ключ/запрос, кроме 429). Конфиг-ошибка агента, fallback не сработал |
| 502 | `http_429` | у всех агентов исчерпана квота (rate limit) |
| 502 | `http_5xx` | провайдер вернул серверную ошибку |
| 502 | `bad_response` | HTTP 200, но в ответе нет ожидаемых полей |
| 502 | `unsupported_provider` | в БД провайдер, которого роутер не знает (deepseek/anthropic) |
| 502 | `all_agents_failed` | все активные агенты упали retryable-ошибками. `detail` — массив `[{agent, error}, ...]` |
| 502 | `bad_ai_json` | ответ AI не распарсился как JSON |
| 502 | `bad_ai_response` | JSON есть, но без `verdict`/`verdictTitle` |
| 500 | `analyze_failed` | непредвиденная серверная ошибка (например, упал модуль профилей) |

Поле `detail` (опциональное в теле 502) содержит до 500 символов из тела ответа провайдера — полезно для диагностики. Фронт на продакшене его не показывает.

## Настройки
Настройки агентов (endpoint, api_key, model, priority, active, params) хранятся в таблице `ai_agents` БД и управляются через `/api/admin/agents` (см. `docs/technical/ai-agents.md`). В `.env` для AI ничего не требуется.

## Таймаут
60 секунд на запрос к каждому агенту (`AbortController` в роутере). При истечении — переход к следующему агенту; если все упали — `502 all_agents_failed`.

## Промпт
Промпт формируется в `services/analyze.js → buildPrompt()` на основе профиля пользователя (`curlType`, `porosity`, `thickness`, `scalp`, `goals`). Если профиль пустой — в промпт уходят прочерки, и модель анализирует без персонализации.

Формат ответа модели строго JSON, принудительно через `responseMimeType: 'application/json'` + описание схемы в тексте.

## Что не делает это ТЗ
- Не сохраняет сканы в БД — это задача `/api/scans` (отдельный модуль).
- Не кэширует результаты — каждый запрос идёт в AI.
- Не считает токены / лимиты пользователя.

## История изменений
- 2026-04-24: Создан файл. Первая реализация анализа через Gemini 2.5 Flash.
- 2026-04-26: Переход с прямого вызова Gemini на AI-роутер с fallback (Gemini → OpenAI).
