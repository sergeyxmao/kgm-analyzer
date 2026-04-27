# `/api/scans` — управление сканами

## Описание
CRUD для сохранения и управления результатами анализа INCI-составов. Все операции привязаны к пользователю — каждый видит и меняет только свои сканы (фильтр по `user_id` на уровне prepared statements, это безопасность, не feature).

## Расположение файлов
- `backend/services/scans.js` — CRUD-операции, генерация `photoUrl` через `s3.getPresignedUrl`.
- `backend/services/s3.js` — клиент Beget S3 (см. `photo-analysis.md`).
- `backend/server.js` — эндпоинты `/api/scans*`.
- БД: таблица `scans` (`backend/db/001-init.sql` + `002-add-profile-snapshot.sql` + `004-rename-photo-path.sql`).

## API

### `POST /api/scans`
Создать запись после успешного `/api/analyze`. Защищён `requireTelegramAuth`. `Content-Type: application/json`.

**Тело:**
```json
{
  "rawInci": "Aqua, Sodium Laureth Sulfate, ...",
  "verdict": "good" | "warn" | "bad",
  "verdictTitle": "Подходит" | "С оговорками" | "Не подходит",
  "productType": "шампунь",
  "summary": "...",
  "ingredients": [{"name":"Aqua","status":"good","note":"..."}],
  "profileSnapshot": {"curlType":"3A","porosity":"medium","thickness":"medium","scalp":"normal","goals":["hydration"]}
}
```

Новая запись создаётся с `shelf='history'`. `verdict` обязателен.

**Ответ `201 Created`:**
```json
{ "scan": { "id": 1, "userId": 1, "productType":"шампунь", "verdict":"good", ..., "createdAt":"..." } }
```

**Ошибки:**
| HTTP | `error` | Описание |
|---|---|---|
| 400 | `verdict_required` | Нет поля `verdict` в теле |
| 400 | `bad_verdict` | `verdict` не в `good`/`warn`/`bad` |
| 401 | `unauthorized` | Нет/невалидный `X-Telegram-Init-Data` |
| 500 | `create_failed` | Неожиданная серверная ошибка |

### `GET /api/scans?shelf=<>&limit=<>`
Список сканов текущего пользователя.

**Параметры:**
- `shelf` (по умолчанию `all`): `all` | `history` | `mine` | `wishlist` | `rejected`.
  **`all` возвращает все сканы**, включая те, что лежат в `history`. Остальные значения — строгий фильтр по полке.
- `limit` (по умолчанию `50`, максимум `100`).

**Ответ `200 OK`:**
```json
{ "scans": [{...}, {...}] }
```
Отсортировано по `createdAt` DESC.

**Ошибки:**
| HTTP | `error` | Описание |
|---|---|---|
| 400 | `bad_shelf` | `shelf` не из списка допустимых |
| 401 | `unauthorized` | Нет/невалидный заголовок |
| 500 | `list_failed` | Неожиданная серверная ошибка |

### `PUT /api/scans/:id/shelf`
Переместить скан на полку. Защищён `requireTelegramAuth`.

**Тело:**
```json
{ "shelf": "mine" | "wishlist" | "rejected" | "history" }
```

**Ответ `200 OK`:**
```json
{ "scan": {...} }
```

**Ошибки:**
| HTTP | `error` | Описание |
|---|---|---|
| 400 | `bad_id` | `:id` не число |
| 400 | `shelf_required` | Нет поля `shelf` в теле |
| 400 | `bad_shelf` | `shelf` не из списка допустимых |
| 404 | `not_found` | Скан не существует или не принадлежит пользователю |
| 401 | `unauthorized` | Нет/невалидный заголовок |
| 500 | `update_failed` | Неожиданная серверная ошибка |

### `POST /api/scans/full-photo`
Vision-режим: фото → S3 → AI → запись в БД одним вызовом. Защищён `requireTelegramAuth`. `Content-Type: multipart/form-data`.

**Параметры формы:**
- `photo` (file, обязательно): JPEG или PNG, ≤ 2 МБ.

**Ответ `201 Created`:**
```json
{
  "scan": { "id": 12, ..., "brand": "Innersense", "productName": "Quiet Calm Curl Control", "photoKey": "kudri-photos/scans/<uuid>.jpg", "photoUrl": "https://...?X-Amz-Signature=..." },
  "brandConfidence": "high" | "medium" | "low" | null
}
```

`brandConfidence` — отдельное поле верхнего уровня (не входит в объект `scan`). Используется фронтом, чтобы решить, показывать ли блок подтверждения «🤔 Угадал?». В текстовом режиме (`POST /api/scans` после `POST /api/analyze`) это поле не передаётся.

**Ошибки:**
| HTTP | `error` | Описание |
|---|---|---|
| 400 | `no_photo` | Поле `photo` отсутствует |
| 400 | `bad_mime` | MIME ≠ `image/jpeg` / `image/png` |
| 401 | `unauthorized` | Нет/невалидный заголовок |
| 413 | (multer) | Файл > 2 МБ |
| 502 | `bad_ai_response` | AI вернул не-JSON или JSON без `verdict` |
| 502 | `<router code>` | Ошибка AI-провайдера (фото удаляется из S3) |
| 500 | `photo_scan_failed` | Неожиданная серверная ошибка |

Подробности — см. `photo-analysis.md`.

### `PATCH /api/scans/:id/brand`
Обновить бренд и название товара (только свой скан). Защищён `requireTelegramAuth`.

**Тело:**
```json
{ "brand": "Innersense", "productName": "Quiet Calm Curl Control" }
```

Оба поля могут быть `null` или пустой строкой (трактуется как `null`). Триминг автоматический. Длина каждого поля ≤ 200 символов.

**Ответ `200 OK`:**
```json
{ "ok": true, "brand": "Innersense", "productName": "Quiet Calm Curl Control" }
```

**Ошибки:**
| HTTP | `error` | Описание |
|---|---|---|
| 400 | `bad_id` | `:id` не число |
| 400 | `bad_field` | Поле передано не строкой и не `null` |
| 400 | `field_too_long` | Длина `brand` или `productName` > 200 |
| 404 | `not_found` | Скан не существует или не принадлежит пользователю |
| 401 | `unauthorized` | Нет/невалидный заголовок |
| 500 | `update_failed` | Неожиданная серверная ошибка |

### `POST /api/scans/:id/share`
Создать или вернуть существующий публичный токен для шеринга. Идемпотентно. Защищён `requireTelegramAuth`. Подробнее — `share.md`.

**Ответ `200 OK`:**
```json
{ "token": "550e8400-e29b-41d4-a716-446655440000", "url": "https://elenadortman.store/share/550e8400-..." }
```

**Ошибки:**
| HTTP | `error` | Описание |
|---|---|---|
| 400 | `bad_id` | `:id` не число |
| 404 | `not_found` | Скан не существует или не принадлежит пользователю |
| 401 | `unauthorized` | Нет/невалидный заголовок |
| 500 | `share_failed` | Неожиданная серверная ошибка |

### `DELETE /api/scans/:id/share`
Отозвать публичный токен. После этого старый URL даёт 404. Защищён `requireTelegramAuth`. Подробнее — `share.md`.

**Ответ `200 OK`:**
```json
{ "ok": true }
```

**Ошибки:**
| HTTP | `error` | Описание |
|---|---|---|
| 400 | `bad_id` | `:id` не число |
| 404 | `not_found` | Скан не существует, не принадлежит пользователю или уже не имеет токена |
| 401 | `unauthorized` | Нет/невалидный заголовок |
| 500 | `revoke_failed` | Неожиданная серверная ошибка |

### `DELETE /api/scans/:id`
Удалить скан. Защищён `requireTelegramAuth`.

**Ответ `200 OK`:**
```json
{ "ok": true }
```

**Ошибки:**
| HTTP | `error` | Описание |
|---|---|---|
| 400 | `bad_id` | `:id` не число |
| 404 | `not_found` | Скан не существует или не принадлежит пользователю |
| 401 | `unauthorized` | Нет/невалидный заголовок |
| 500 | `delete_failed` | Неожиданная серверная ошибка |

## Поля scan-объекта в ответе

| Поле | Тип | Примечание |
|---|---|---|
| `id` | number | PK из БД |
| `userId` | number | FK на `users.id` |
| `productType` | string \| null | «шампунь», «кондиционер», … |
| `brand` | string \| null | Название бренда — извлекается AI из фото или редактируется вручную |
| `productName` | string \| null | Точное название товара — извлекается AI из фото или редактируется вручную |
| `verdict` | `'good'\|'warn'\|'bad'` | |
| `verdictTitle` | string \| null | Читаемый лейбл вердикта |
| `summary` | string \| null | 1–2 предложения |
| `ingredients` | array \| null | Массив объектов `{name,status,note}` (уже распарсен из JSON) |
| `rawInci` | string \| null | Исходный текст INCI, если анализ был по тексту |
| `photoKey` | string \| null | S3-ключ фото в Beget Cloud Storage |
| `photoUrl` | string \| null | Presigned GET URL на 1 час (генерируется при каждом запросе) |
| `shareToken` | string \| null | UUID v4 публичной ссылки или `null` если скан приватный (см. `share.md`) |
| `shelf` | `'history'\|'mine'\|'wishlist'\|'rejected'` | |
| `profileSnapshot` | object \| null | Снимок профиля на момент анализа |
| `createdAt` | string (ISO-8601) | |

## Безопасность
Каждый SQL-запрос содержит `WHERE user_id = ?` (для SELECT/UPDATE/DELETE) или `VALUES(user_id = ?)` (для INSERT). В теле API нельзя передать чужой `user_id` — он всегда берётся из `req.user.id`, который установлен `requireTelegramAuth` из валидного initData.

## Что не делает
- Не индексирует ингредиенты для поиска — это для будущей базы знаний.
- Не пересчитывает вердикт при изменении профиля — каждый скан хранит `profileSnapshot` для воспроизводимости.

## История изменений
- 2026-04-24: Создан файл. CRUD endpoints, 4 полки, `profile_snapshot` прилетает миграцией 002.
- 2026-04-26: Колонка `photo_path` → `photo_key` (миграция 004). Добавлен `POST /api/scans/full-photo`. В ответы добавлено поле `photoUrl` (presigned GET, 1 час).
- 2026-04-27: Добавлены эндпоинты `POST /api/scans/:id/share` и `DELETE /api/scans/:id/share`. Поле `shareToken` в ответе. Подробности — `share.md`.
- 2026-04-27: Добавлены поля `brand`, `productName` в scan-объект. Эндпоинт `PATCH /api/scans/:id/brand`. В ответе `POST /api/scans/full-photo` появилось поле `brandConfidence`.
