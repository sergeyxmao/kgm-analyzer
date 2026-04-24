# Анализ INCI — `/api/analyze`

## Описание
Серверный прокси к Google Gemini для анализа косметических составов. Ключ Gemini хранится в `backend/.env` и не попадает на фронт. Сервер подставляет профиль пользователя в промпт — анализ персонализированный.

Основной провайдер — Gemini 2.5 Flash. Fallback — OpenAI-совместимый API (OpenAI/DeepSeek/OpenRouter), включается при квоте/rate-limit/сетевом сбое Gemini. Если `OPENAI_API_KEY` не задан, fallback отключён.

## Расположение файлов
- `backend/services/gemini.js` — клиент Gemini API (HTTP-обёртка).
- `backend/services/openai.js` — клиент OpenAI-совместимого Chat Completions API (fallback).
- `backend/services/analyze.js` — логика: сборка промпта, роутинг Gemini→OpenAI, парсинг ответа.
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

**Ответ 200 OK** (формат от Gemini):
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
| 502 | `gemini_key_missing` | на сервере не задан `GEMINI_API_KEY` |
| 502 | `gemini_timeout` | Gemini не ответил за 60 сек |
| 502 | `gemini_network: <msg>` | сетевая ошибка к Gemini (DNS, reset, TLS…) |
| 502 | `gemini_http_XXX` | Gemini вернул не 200, XXX — HTTP-код (часто 400 при невалидном ключе, 429 при лимите, 403) |
| 502 | `gemini_empty_response` | Gemini вернул пустой `candidates` |
| 502 | `openai_timeout` \| `openai_network:*` \| `openai_http_XXX` \| `openai_empty_response` | fallback к OpenAI тоже не сработал (Gemini лёг и OpenAI лёг/не настроен) |
| 502 | `bad_ai_json` | ответ AI не распарсился как JSON |
| 502 | `bad_ai_response` | JSON есть, но без `verdict`/`verdictTitle` |
| 500 | `analyze_failed` | непредвиденная серверная ошибка (например, упал модуль профилей) |

Поле `detail` (опциональное в теле 502) содержит до 500 символов из тела ответа провайдера — полезно для диагностики. Фронт на продакшене его не показывает. Если fallback на OpenAI тоже упал — в теле ответа присутствует `primaryError` с кодом исходной ошибки Gemini.

## AI-провайдеры и fallback

Основной провайдер — Gemini. OpenAI-совместимый клиент включается автоматически, если:
1. Задан `OPENAI_API_KEY`.
2. Gemini вернул одну из ошибок: `gemini_key_missing`, `gemini_timeout`, `gemini_network:*`, `gemini_empty_response`, `gemini_http_429`, `gemini_http_403`, `gemini_http_5xx`.

На 400 Gemini (невалидный запрос с нашей стороны) fallback НЕ срабатывает — проблема не в провайдере.

Факт переключения на OpenAI логируется:
```
[analyze] gemini failed (gemini_http_429), falling back to openai
[/api/analyze] user=123 provider=openai
```

## Настройки
- `GEMINI_API_KEY` — ключ Google AI Studio (обязательно для основного провайдера).
- `GEMINI_MODEL` — опционально, по умолчанию `gemini-2.5-flash`.
- `GEMINI_BASE_URL` — опционально, по умолчанию `https://generativelanguage.googleapis.com`. На проде используется URL Cloudflare Worker'а для обхода регионального блока Google в РФ. Подменяет только базовый домен — путь `/v1beta/models/...` остаётся прежним.
- `OPENAI_API_KEY` — ключ OpenAI / DeepSeek / OpenRouter / совместимого провайдера. Если пусто — fallback выключен.
- `OPENAI_MODEL` — опционально, по умолчанию `gpt-4o-mini`. Для DeepSeek — `deepseek-chat`.
- `OPENAI_BASE_URL` — опционально, по умолчанию `https://api.openai.com/v1`. Для DeepSeek — `https://api.deepseek.com/v1`. Для обхода регионального блока из РФ можно направить на Cloudflare Worker-прокси.

## Таймаут
60 секунд на запрос к Gemini. При истечении — `502 gemini_timeout`. Реализовано через `AbortController`.

## Промпт
Промпт формируется в `services/analyze.js → buildPrompt()` на основе профиля пользователя (`curlType`, `porosity`, `thickness`, `scalp`, `goals`). Если профиль пустой — в промпт уходят прочерки, и модель анализирует без персонализации.

Формат ответа модели строго JSON, принудительно через `responseMimeType: 'application/json'` + описание схемы в тексте.

## Что не делает это ТЗ
- Не сохраняет сканы в БД — это задача `/api/scans`.
- Не ротирует между провайдерами по RR/хешу — OpenAI используется ТОЛЬКО как fallback.
- Не кэширует результаты — каждый запрос идёт в AI.
- Не считает токены / лимиты пользователя.
- Не сохраняет метрику fallback-ов в БД — только в stdout-логи.

## История изменений
- 2026-04-24: Создан файл. Первая реализация анализа через Gemini 2.5 Flash.
- 2026-04-24: Добавлен OpenAI-совместимый fallback (`backend/services/openai.js`). Включается при квоте/сбое Gemini, если задан `OPENAI_API_KEY`.
