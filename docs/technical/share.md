# Шеринг сканов

## Описание
Публичный шеринг сканов. Любой пользователь может расшарить свой скан, получить URL вида `https://elenadortman.store/share/<uuid>` и поделиться им. Получатель открывает URL в браузере без установки Mini App — видит вердикт, ингредиенты и фото.

## Расположение файлов
- `backend/routes/share.js` — публичный роутер `GET /share/:token`.
- `backend/services/share-page.js` — server-side HTML-рендер (`renderSharePage`, `renderNotFoundPage`).
- `backend/services/scans.js` — `createShareToken`, `revokeShareToken`, `getScanByShareToken`.
- `backend/server.js` — эндпоинты `POST /api/scans/:id/share`, `DELETE /api/scans/:id/share` + монтирование роутера на `/share`.
- `frontend/index.html` — кнопки шеринга в каталоге (`Catalog.shareScan`, `Catalog.copyShare`, `Catalog.revokeShare`).

## Архитектура
- `share_token` — UUID v4 (через `crypto.randomUUID`), хранится в `scans.share_token` (миграция 005).
- Уникальность через partial UNIQUE индекс `idx_scans_share_token` на NOT NULL значениях.
- `NULL` = скан приватный. Любое NOT NULL значение делает скан публично доступным по URL.

## API

### `POST /api/scans/:id/share`
Создать или вернуть существующий публичный токен. Идемпотентно: повторный вызов возвращает тот же токен. Защищён `requireTelegramAuth`.

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
Обнулить токен. После этого старый URL даёт 404. Защищён `requireTelegramAuth`.

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

### `GET /share/:token`
Публичный, без auth. Рендерит HTML-страницу.

- `200 OK` + HTML (Content-Type: text/html) если токен найден.
- `404 Not Found` + HTML страница «Ссылка не найдена» если токен не существует или был отозван.

## HTML-страница
Server-side render через `share-page.js`. Без шаблонизатора — простой template literal с `escape()`. Стилистика — pastel premium, аналог `frontend/index.html`. Шрифты Fraunces + Inter с Google Fonts.

Содержимое:
- Логотип КУДРИ.
- Фото скана (если есть) — presigned URL S3.
- Карточка с вердиктом (good/warn/bad), названием, summary.
- Профиль на момент анализа в формате «анализ для типа 3A · средняя пористость · …». Преобразование делается через лейблы внутри `share-page.js`.
- Список ингредиентов с цветовой кодировкой (зелёный/жёлтый/красный).
- CTA «Открыть КУДРИ» → `https://t.me/kudri_lena_bot`.

Open Graph мета-теги (`og:title`, `og:description`, `og:image`) — для preview в мессенджерах.

## Развёртывание (nginx)
Публичный URL живёт на `elenadortman.store/share/...` (не на `api.elenadortman.store`). nginx-конфиг основного домена должен проксировать `/share/*` на Node:

```nginx
location /share/ {
    proxy_pass http://127.0.0.1:3001;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

Без этой настройки nginx будет искать `/share/<token>` как статический файл во `frontend/` и отдавать 404.

## Безопасность
- Перебор токенов невозможен — UUID v4 даёт 122 бита энтропии.
- Отзыв ссылки мгновенный (`UPDATE SET share_token = NULL`).
- На публичной странице **не** показывается имя/аватар/Telegram-ID владельца — только хайр-параметры из `profileSnapshot`.
- SQL: запросы `createShareToken`/`revokeShareToken` содержат `WHERE id = ? AND user_id = ?` — пользователь не может расшарить чужой скан.

## Что не делает
- Нет аналитики кликов (в будущем — через миграцию в отдельную таблицу).
- Нет TTL у ссылки — действует пока не отозвана.
- Нет батч-шеринга нескольких сканов одной ссылкой.
- Нет переключателя «public / unlisted» — ссылка либо есть, либо нет.
- Photo URL — presigned (живёт час). После часа фото на странице может перестать показываться. Это известное ограничение MVP, фикс — отдельной задачей (возможно, делать short-lived редирект через `/share/:token/photo`).

## История изменений
- 2026-04-27: Создан файл. Шеринг скана через UUID-токен в публичной HTML-странице.
