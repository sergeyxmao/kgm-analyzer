# Профиль волос — API

## Описание
Профиль содержит параметры волос пользователя из онбординга. 1-к-1 с users (ключ — `user_id`).

Все поля опциональны. Можно сохранить частичный профиль (только `curlType`), потом дополнить PUT-ом. PUT работает в **PATCH-семантике**: поля, которых нет в теле, не затрагиваются (остаются прежними).

## Расположение файлов
- `backend/services/profiles.js` — `getProfileByUserId`, `upsertProfile`, валидация.
- `backend/server.js` — эндпоинты `GET/PUT /api/profile`.

## Модель

| Поле         | Тип                 | Допустимые значения                                                                                        |
|--------------|---------------------|------------------------------------------------------------------------------------------------------------|
| `curlType`   | string \| null      | `'2A' \| '2B' \| '2C' \| '3A' \| '3B' \| '3C' \| '4'`                                                      |
| `porosity`   | string \| null      | `'low' \| 'medium' \| 'high' \| 'unknown'`                                                                 |
| `thickness`  | string \| null      | `'thin' \| 'medium' \| 'thick'`                                                                            |
| `scalp`      | string \| null      | `'oily' \| 'normal' \| 'dry' \| 'sensitive' \| 'mixed'`                                                    |
| `colorState` | string \| null      | произвольный текст до 500 символов                                                                         |
| `goals`      | string[]            | подмножество `['hydration','nutrition','growth','volume','definition','frizz','shine','repair','color','scalp']` |
| `updatedAt`  | string (ISO-8601)   | заполняется автоматически                                                                                  |

### Формат ключей
- **На входе** (PUT) принимаются оба варианта: snake_case (`curl_type`, `color_state`) и camelCase (`curlType`, `colorState`). snake_case имеет приоритет, если переданы оба.
- **На выходе** (GET/PUT) всегда camelCase.

## API

### `GET /api/profile`
Защищён `requireTelegramAuth`.

**Ответ 200 OK (профиль существует):**
```json
{
  "profile": {
    "userId": 1,
    "curlType": "3A",
    "porosity": "medium",
    "thickness": "medium",
    "scalp": "normal",
    "colorState": null,
    "goals": ["hydration","frizz"],
    "updatedAt": "2026-04-24T08:00:00.000Z"
  }
}
```

**Ответ 200 OK (профиль ещё не создан):**
```json
{ "profile": null }
```

**Ответ 401** — невалидный или отсутствующий `X-Telegram-Init-Data`.

### `PUT /api/profile`
Защищён `requireTelegramAuth`. `Content-Type: application/json`.

Тело запроса (все поля опциональны). Поля, которые не переданы, не меняют значение в БД (PATCH-семантика). Явное значение `null` трактуется как очистка поля.

```json
{
  "curlType": "3A",
  "porosity": "medium",
  "thickness": "medium",
  "scalp": "normal",
  "colorState": null,
  "goals": ["hydration","frizz"]
}
```

**Ответ 200 OK:** тот же формат, что у GET.

**Ответ 400 (валидация не прошла):**
```json
{ "error": "bad_value", "field": "curl_type" }
```

Возможные `error`:
- `bad_body` — тело не JSON-объект (нет тела, массив, примитив).
- `bad_value` + `field` — значение поля не в списке допустимых или не того типа.
- `too_long` + `field: "color_state"` — текст длиннее 500 символов.

**Ответ 500:**
```json
{ "error": "profile_read_failed" }
```
или
```json
{ "error": "profile_write_failed" }
```

## История изменений
- 2026-04-24: Создан файл. Эндпоинты `GET/PUT /api/profile`, валидация, PATCH-семантика, поддержка snake_case/camelCase на входе.
