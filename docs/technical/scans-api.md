# `/api/scans` — управление сканами

## Описание
CRUD для сохранения и управления результатами анализа INCI-составов. Все операции привязаны к пользователю — каждый видит и меняет только свои сканы (фильтр по `user_id` на уровне prepared statements, это безопасность, не feature).

## Расположение файлов
- `backend/services/scans.js` — CRUD-операции.
- `backend/server.js` — эндпоинты `/api/scans*`.
- БД: таблица `scans` (`backend/db/001-init.sql` + `002-add-profile-snapshot.sql`).

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
| `verdict` | `'good'\|'warn'\|'bad'` | |
| `verdictTitle` | string \| null | Читаемый лейбл вердикта |
| `summary` | string \| null | 1–2 предложения |
| `ingredients` | array \| null | Массив объектов `{name,status,note}` (уже распарсен из JSON) |
| `rawInci` | string \| null | Исходный текст INCI, если анализ был по тексту |
| `photoPath` | string \| null | Путь к фото (пока всегда `null`) |
| `shelf` | `'history'\|'mine'\|'wishlist'\|'rejected'` | |
| `profileSnapshot` | object \| null | Снимок профиля на момент анализа |
| `createdAt` | string (ISO-8601) | |

## Безопасность
Каждый SQL-запрос содержит `WHERE user_id = ?` (для SELECT/UPDATE/DELETE) или `VALUES(user_id = ?)` (для INSERT). В теле API нельзя передать чужой `user_id` — он всегда берётся из `req.user.id`, который установлен `requireTelegramAuth` из валидного initData.

## Что не делает
- Не загружает фото — поле `photoPath` пока всегда `null`. Фото добавится отдельным ТЗ через S3.
- Не индексирует ингредиенты для поиска — это для будущей базы знаний.
- Не пересчитывает вердикт при изменении профиля — каждый скан хранит `profileSnapshot` для воспроизводимости.
- Нет публикации/шаринга сканов между пользователями.

## История изменений
- 2026-04-24: Создан файл. CRUD endpoints, 4 полки, `profile_snapshot` прилетает миграцией 002.
