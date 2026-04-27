# AI-роутер — `services/ai-router.js`

## Описание
Единая точка вызова AI-провайдеров для бэкенда. Читает активных агентов из таблицы `ai_agents` (через `ai-agents.listActiveByRole`) и идёт по ним в порядке `priority ASC`. Если первый агент упал retryable-ошибкой (квота, таймаут, 5xx) — переходит к следующему. Это позволяет переключаться с Gemini на OpenAI и обратно без редеплоя — достаточно поправить `priority` или `active` в БД.

Появился чтобы решить проблему с дневной квотой Gemini: когда у Google заканчивается лимит (HTTP 429), анализ INCI ломался полностью. Теперь fallback на OpenAI работает автоматически.

## Расположение файлов
- `backend/services/ai-router.js` — сам роутер.
- `backend/services/ai-agents.js` — источник конфигов агентов (CRUD таблицы `ai_agents`).
- `backend/services/analyze.js` — потребитель: вызывает `aiRouter.generate(input, 'analyst')` для анализа INCI.

## Как работает
1. Получает `input = { prompt, image? }` и `role` (`'analyst'` / `'ocr'` / `'both'`).
2. Запрашивает у `ai-agents` список активных агентов для роли — уже отсортированный по `priority ASC, id ASC`.
3. Если список пуст — бросает `no_active_agents`.
4. По очереди вызывает каждого агента:
   - **Успех** → возвращает текст ответа.
   - **Retryable-ошибка** → логирует `console.warn` и пробует следующего.
   - **Non-retryable-ошибка** → бросает наружу как есть (это конфиг-проблема агента, маскировать её fallback'ом нельзя).
5. Если все агенты упали retryable-ошибками — бросает `all_agents_failed` с массивом `detail = [{ agent, error }, ...]`.

### Retryable условия
- `network` — fetch не достучался (DNS, TCP reset, TLS handshake).
- `timeout` — нет ответа за 60 секунд (`AbortController`).
- HTTP `429` — превышена квота / rate limit.
- HTTP `500..599` — ошибка на стороне провайдера.

### Non-retryable условия
- HTTP `400..499` (кроме `429`) — плохой ключ, плохой запрос, плохой эндпоинт. Чинится в админке, не fallback'ом.
- `bad_response` — ответ 200, но без ожидаемых полей.
- `unsupported_provider` — в БД провайдер, которого роутер не знает.

## API

### `generate(input, role)`
**Аргументы:**
- `input.prompt` — строка, обязательно.
- `input.image` — опционально, объект `{ mime: string, base64: string }`. Если есть — добавляется к запросу как картинка.
- `role` — строка из `'analyst' | 'ocr' | 'both' | 'image_search'`. Передаётся в `ai-agents.listActiveByRole(role)` как есть. Роль `image_search` обычно вызывается через `findProductImage()` (см. ниже), а не напрямую через `generate()`.

**Возврат:** `Promise<string>` — текстовый ответ модели. JSON-парсинг — на стороне вызывающего.

**Бросает Error с полем `code`:**

| `err.code` | Когда | Retryable |
|---|---|---|
| `bad_input` | пустой `prompt` или не объект | — |
| `no_active_agents` | в БД нет активных агентов для этой роли | — |
| `network` | сетевая ошибка fetch | да |
| `timeout` | агент не ответил за 60 секунд | да |
| `http_429` | агент вернул HTTP 429 (квота) | да |
| `http_5xx` | агент вернул HTTP 500..599 | да |
| `http_4xx` (кроме 429) | конфиг-ошибка агента (плохой ключ, плохой запрос) | нет |
| `bad_response` | HTTP 200, но тело не парсится / нет ожидаемых полей | нет |
| `unsupported_provider` | провайдер агента не реализован (deepseek/anthropic) | нет |
| `all_agents_failed` | все агенты упали retryable-ошибками | — |

Дополнительные поля: `err.status` (для HTTP-ошибок), `err.detail` (тело ответа до 500 символов; для `all_agents_failed` — массив `{agent, error}`).

### `findProductImage({ brand, productName })`
Поиск фото товара через Gemini + встроенный tool `googleSearch`. Используется фоновой подсистемой `services/product-image-finder.js` после успешного распознавания бренда+названия.

**Аргументы:** объект с полями `brand` и `productName` — оба строки.

**Возврат:** `Promise<{ url: string|null, status, reason? }>`, где `status ∈ 'found' | 'not_found' | 'failed'`. **Не бросает наружу** — все ошибки сворачиваются в `status: 'failed'` с диагностикой в `reason`.

**Поведение:**
- Если активного агента роли `image_search` нет → `{ url:null, status:'not_found' }`.
- Если активный агент не на провайдере `gemini` → `{ url:null, status:'failed', reason:'unsupported_provider' }`. Fallback на других провайдеров в этой итерации не делается.
- Промпт просит у Gemini прямую ссылку на изображение с маркетплейсов (wildberries, ozon, goldapple, letu, sephora) или с белым фоном; если ничего не нашлось — Gemini должен вернуть строку `NOT_FOUND`.
- Тело запроса: `{ contents:[{parts:[{text:prompt}]}], tools:[{ googleSearch:{} }] }`. Если у агента есть `params` — кладутся в `generationConfig`.
- Парсинг ответа: склеиваются все `parts[].text` первого кандидата. Если в тексте `NOT_FOUND` — `status:'not_found'`. Иначе ищется первый `https://...\.(jpg|jpeg|png|webp)` через regex. Найден — `status:'found'`, нет — `status:'not_found'`.
- Сетевые ошибки, таймауты и не-2xx HTTP сворачиваются в `status:'failed'` с `reason = err.code` (`http_429`, `http_5xx`, `network`, `timeout`, …).

## Поддерживаемые провайдеры

### Gemini (Google generateContent)
- **Авторизация:** `?key=<api_key>` в URL.
- **Тело:** `{ contents: [{ parts: [<text>, <inline_data>?] }], generationConfig: <agent.params || {}> }`.
- **Картинка:** добавляется как `{ inline_data: { mime_type, data } }` во второй part.
- **Парсинг ответа:** `data.candidates[0].content.parts[0].text`.

### OpenAI (Chat Completions)
- **Авторизация:** заголовок `Authorization: Bearer <api_key>`.
- **Тело:** `{ model: <agent.model>, messages: [{ role: 'user', content }], ...<agent.params> }`.
- **Картинка:** `content` становится массивом `[{type:'text',text}, {type:'image_url',image_url:{url:'data:<mime>;base64,<b64>'}}]`. Без картинки — обычная строка.
- **Парсинг ответа:** `data.choices[0].message.content`.

### Параметры (`agent.params`)
Хранятся в БД в родном формате провайдера и применяются как есть:
- Для Gemini — целиком в `generationConfig` (например `{ temperature: 0.2, maxOutputTokens: 2048, responseMimeType: 'application/json' }`).
- Для OpenAI — мерджатся в корень тела рядом с `model`/`messages` (например `{ temperature: 0.2, max_tokens: 2048, response_format: {type:'json_object'} }`).
- Если `params === null` — посылается минимальное тело без `generationConfig` / без доп. полей. Никаких дефолтов в коде роутера нет, конфиг — только из БД.

## Настройки
В `.env` ничего не нужно. Все параметры агентов (endpoint, api_key, model, priority, active, params) лежат в таблице `ai_agents`. Управление — через админ-API `/api/admin/agents` (см. `docs/technical/ai-agents.md`).

## Что не делает
- Нет retry того же агента — только переход к следующему.
- Нет circuit breaker / cooldown упавшего агента.
- Нет метрик и мониторинга.
- Нет поддержки streaming-ответов.
- Нет провайдеров `deepseek` / `anthropic` — они есть в схеме БД, но в роутере вернут `unsupported_provider`.

## История изменений
- 2026-04-26: Создан файл. Роутер с двумя провайдерами (Gemini, OpenAI), fallback по retryable-ошибкам.
- 2026-04-27: Добавлены роль `image_search` и метод `findProductImage({brand, productName})` для поиска фото товара через Gemini+googleSearch. Метод не бросает наружу — отдаёт `{url, status, reason?}`.
