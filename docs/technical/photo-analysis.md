# Vision-режим — анализ INCI с фото этикетки

## Описание
Vision-режим даёт пользователю возможность отсканировать упаковку средства камерой смартфона: фото распознаётся AI напрямую (без отдельного OCR-шага), вердикт формируется с учётом профиля волос. Сжатое фото хранится в Beget Cloud Storage (S3-совместимом), в каталоге сканов под него рисуется миниатюра.

Поток: **камера → сжатие на клиенте → multipart-загрузка → S3 + AI → запись в БД с `photo_key`**.

## Расположение файлов
- `backend/services/s3.js` — низкоуровневый клиент Beget S3 (uploadObject, getPresignedUrl, deleteObject).
- `backend/services/analyze.js` — общий промпт через `buildAnalystPrompt`. Реэкспортируется для нового эндпоинта.
- `backend/services/ai-router.js` — vision уже поддерживается на уровне роутера для Gemini и OpenAI.
- `backend/services/scans.js` — генерация `photoUrl` (presigned GET, 1 час) для каждого скана с `photoKey`.
- `backend/server.js` — эндпоинт `POST /api/scans/full-photo` (multer + S3 + ai-router + scans.createScan).
- `frontend/index.html` — `Scanner.handleFile`/`compressImage`/`analyzePhoto`, рендер `photoUrl` в `Catalog.load` и `App.refreshRecent`.

## Как работает
1. На экране «Сканер» в режиме «📸 Фото» пользователь нажимает upload-zone → открывается камера / галерея → выбирает фото.
2. Фронт **сжимает фото** на клиенте через canvas (max 1024px по длинной стороне, JPEG quality 0.8) и **показывает превью** в `#scan-result` с кнопкой «Проанализировать».
3. По нажатию кнопки фронт отправляет `POST /api/scans/full-photo` (multipart/form-data, поле `photo`) с заголовком `X-Telegram-Init-Data`.
4. Бэк принимает фото через multer (лимит 2 МБ), загружает оригинальный буфер в S3 по ключу `<S3_PHOTO_PREFIX>scans/<uuid>.jpg`, зовёт `aiRouter.generate({prompt, image:{mime,base64}}, 'analyst')`, парсит JSON и пишет скан в БД через `scans.createScan` (поле `photo_key` = S3-ключ).
5. Бэк возвращает `{scan: {...}}` с полным объектом скана, включая `photoKey` и `photoUrl` (presigned GET URL на 1 час).
6. На экране «Каталог» при загрузке списка сервер автоматически генерирует свежий `photoUrl` для каждого скана с `photoKey`. Фронт в карточке скана вместо иконки 🧴 рендерит `<img src="photoUrl">`.

## API

### `POST /api/scans/full-photo`
Защищён `requireTelegramAuth`. `Content-Type: multipart/form-data`.

**Параметры формы:**
- `photo` (file, обязательно): JPEG или PNG, ≤ 2 МБ.

**Заголовки:**
- `X-Telegram-Init-Data` (обязательно)

**Ответ `201 Created`:**
```json
{
  "scan": {
    "id": 12,
    "userId": 1,
    "productType": "шампунь",
    "verdict": "good",
    "verdictTitle": "Подходит",
    "summary": "...",
    "ingredients": [...],
    "rawInci": null,
    "photoKey": "kudri-photos/scans/<uuid>.jpg",
    "photoUrl": "https://s3.ru1.storage.beget.cloud/...?X-Amz-Signature=...",
    "shelf": "history",
    "profileSnapshot": {...},
    "createdAt": "2026-04-26T..."
  }
}
```

**Ошибки:**
| HTTP | `error` | Описание |
|---|---|---|
| 400 | `no_photo` | Поле `photo` отсутствует в multipart |
| 400 | `bad_mime` | MIME ≠ `image/jpeg` / `image/png` |
| 401 | `unauthorized` | Нет/невалидный `X-Telegram-Init-Data` |
| 413 | (multer) | Файл > 2 МБ (multer выкидывает `LIMIT_FILE_SIZE`) |
| 502 | `bad_ai_response` | AI вернул не-JSON или JSON без `verdict`/`verdictTitle` |
| 502 | `<router error code>` | Ошибка AI-провайдера (см. `ai-router`) — фото уже удалено из S3 |
| 500 | `photo_scan_failed` | Неожиданная серверная ошибка |

## Хранение в S3
- Ключ объекта: `<S3_PHOTO_PREFIX>scans/<uuid>.jpg` (или `.png`, если пришёл PNG).
- Bucket приватный — фото отдаётся через presigned GET URL на **1 час** (генерируется в `services/scans.js` при каждом запросе списка/детали скана).
- Конфиг — из `.env`: `S3_ENDPOINT`, `S3_BUCKET`, `S3_ACCESS_KEY`, `S3_SECRET_KEY`, `S3_PHOTO_PREFIX`. См. `backend/.env.example`.

## Ограничения
- Размер файла на бэке: **2 МБ** (`multer` limit).
- MIME: только `image/jpeg`, `image/png`.
- На фронте: сжатие до **1024px по длинной стороне**, JPEG quality **0.8**.
- TTL presigned URL: **1 час** (фиксировано).

## Что не делает
- Нет ресайза на бэке — клиент шлёт уже сжатое.
- Нет EXIF-стрипа (на JPEG из canvas EXIF и так нет).
- Нет CDN перед S3 — пресигнед URL отдаётся напрямую с Beget.
- Нет резервирования фото при ошибке AI: если AI падает, фото удаляется из S3 (мы не оставляем сирот). Если хочется retry без перезагрузки — перефотографировать и повторить.
- Не кэширует presigned URL в БД — каждый запрос списка/детали генерирует свежий URL.

## История изменений
- 2026-04-26: Создан файл. Vision-режим end-to-end (камера → S3 → AI → история с миниатюрой).
