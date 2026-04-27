# Поиск фото товара — `services/product-image-finder.js`

## Описание
Фоновая подсистема: после успешного vision-анализа (`POST /api/scans/full-photo`) AI-роутер уже извлёк бренд и название товара. Фото пользователя часто плохого качества — тёмное, размытое, кривой ракурс. Эта подсистема ищет красивое фото товара через Gemini + встроенный tool `googleSearch` и сохраняет URL в `scans.product_image_url`. Фронт показывает «двойное фото»: миниатюру фото пользователя + большое фото товара.

Запускается «огнём-и-забыть» из `server.js` через `setImmediate` сразу после `createScan`. Не блокирует ответ пользователю — пользователь увидит фото товара при следующем открытии каталога.

## Расположение файлов
- `backend/services/product-image-finder.js` — сама подсистема (одна функция `findAndSaveProductImage`).
- `backend/services/ai-router.js` — метод `findProductImage({brand, productName})`, выполняет HTTP-запрос к Gemini и парсит ответ.
- `backend/services/scans.js` — метод `updateScanProductImage(scanId, {url, status})` пишет результат в БД.
- `backend/server.js` — вызов `setImmediate(() => productImageFinder.findAndSaveProductImage(...))` после `createScan` в `POST /api/scans/full-photo`.
- БД: колонки `scans.product_image_url` и `scans.product_image_status` (миграция 007).
- БД: расширение CHECK-ограничения `ai_agents.role` (миграция 008).

## Как работает
1. После успешного `createScan(...)` сервер проверяет, что AI распознал и `brand`, и `productName` (оба не null/пустые). При создании в этом случае выставляется `productImageStatus = 'pending'`.
2. Через `setImmediate` запускается `findAndSaveProductImage(scanId, brand, productName)`.
3. `aiRouter.findProductImage({brand, productName})` берёт первого активного агента роли `image_search` (через `ai-agents.listActiveByRole('image_search')`).
4. Если активного агента нет → `{url:null, status:'not_found'}`.
5. Если провайдер агента не `gemini` → `{url:null, status:'failed', reason:'unsupported_provider'}`. Fallback на других провайдеров в этой итерации не делается.
6. Шлётся POST в `<endpoint>?key=<apiKey>` с телом `{ contents:[{parts:[{text:prompt}]}], tools:[{googleSearch:{}}] }`. Если у агента есть `params` — кладутся в `generationConfig`.
7. Промпт просит Gemini вернуть прямую ссылку на изображение (jpg/png/webp) с маркетплейса (wildberries, ozon, goldapple, letu, sephora) или с белым фоном. Если ничего подходящего — Gemini должен вернуть `NOT_FOUND`.
8. Парсинг: склеиваются все `parts[].text` первого кандидата. `NOT_FOUND` → `status:'not_found'`. Иначе ищется первый `https://...\.(jpg|jpeg|png|webp)` через regex. Найден → `status:'found'`, нет → `status:'not_found'`.
9. Любая сетевая/HTTP-ошибка ловится в `findProductImage` и сворачивается в `{status:'failed', reason:err.code}`. `findAndSaveProductImage` дополнительно ловит уже неожиданные исключения и пишет `failed` в БД, чтобы статус не залип в `pending`.
10. Результат пишется в БД через `scansService.updateScanProductImage(scanId, {url, status})`. Логируется одной строкой `INFO [product-image-finder] scanId=<id> status=<status>`.

## Поля БД (`scans`)
| Колонка | Тип | Назначение |
|---|---|---|
| `product_image_url` | TEXT \| NULL | Прямой URL найденного фото товара. |
| `product_image_status` | TEXT \| NULL | `pending` / `found` / `not_found` / `failed`. `NULL` — поиск не запускался (нет brand/productName). |

В API наружу — `productImageUrl` и `productImageStatus` в каждом scan-объекте (см. `scans-api.md`).

## Frontend
В `Catalog.load` (`frontend/index.html`) карточка скана теперь рендерится в трёх вариантах:
- `productImageStatus === 'found'` и `productImageUrl` непустой → блок «двойное фото»: миниатюра фото пользователя слева (~44px), тонкий разделитель, большое фото товара справа (~130px).
- `productImageStatus === 'pending'` → миниатюра пользователя + скелетон (shimmer) на месте фото товара.
- Иначе (`not_found`, `failed`, `null`) → только фото пользователя как раньше.

Поллинг с фронта не делается — пользователь увидит фото при следующем открытии каталога.

## Как добавить агента `image_search`
1. Открыть админ-панель в Mini App → AI-агенты → «+ Добавить».
2. Имя — произвольное (например `Gemini Image Search`).
3. Провайдер — `gemini` (другие в этой итерации не поддерживаются).
4. Роль — `image_search`.
5. Endpoint — полный URL Gemini generateContent с моделью, поддерживающей tool `googleSearch` (например `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent`).
6. API Key — Google API key с доступом к Gemini API.
7. Модель — `gemini-2.5-flash` (или другая, поддерживающая `googleSearch`).
8. Priority — `100` (значение пока не важно, берётся первый активный).
9. Active — да.
10. Params — обычно пусто. Можно положить `{"temperature":0.2}`.

## Что не делает
- Нет retry при `failed` — следующий вызов будет только при создании нового скана. Status остаётся `failed`/`not_found`.
- Нет fallback на других провайдеров (OpenAI / Bing / CSE) — только Gemini.
- Нет валидации, что найденный URL действительно отдаёт картинку (HEAD-запрос не делается). Если URL мёртвый, фронт покажет «битую» картинку — это допустимо для MVP.
- Нет WebSocket-уведомлений о завершении поиска — пользователь увидит результат при следующем `GET /api/scans`.
- Не запускается для текстового анализа (`POST /api/scans` после `POST /api/analyze`) — там brand/productName всегда null.

## История изменений
- 2026-04-27: Создан файл. Подсистема фонового поиска фото товара через Gemini+googleSearch. Колонки `scans.product_image_url`, `scans.product_image_status` (миграция 007). Роль `image_search` в `ai_agents.role` (миграция 008).
