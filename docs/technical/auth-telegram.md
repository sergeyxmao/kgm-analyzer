# Telegram Mini App — авторизация

## Описание
Stateless-проверка пользователя по Telegram initData. Фронт в каждом защищённом запросе шлёт заголовок `X-Telegram-Init-Data` с содержимым `window.Telegram.WebApp.initData`. Сервер валидирует подпись секретом бота, находит или создаёт пользователя в таблице users, кладёт запись в req.user.

## Расположение файлов
- `backend/services/auth.js` — функция `verifyTelegramInitData()`
- `backend/services/users.js` — `upsertTelegramUser()`
- `backend/middleware/requireTelegramAuth.js` — Express-middleware

## Как работает
1. Клиент шлёт запрос с заголовком `X-Telegram-Init-Data: <raw initData string>`.
2. Middleware извлекает initData, парсит URL-encoded пары.
3. Сравнивает HMAC-подпись с ожидаемой (ключ = HMAC-SHA256(BOT_TOKEN, "WebAppData")).
4. Проверяет свежесть auth_date (не старше 24 часов).
5. Парсит JSON из поля `user`, извлекает Telegram user.id.
6. Апсертит пользователя: находит по (`tg`, `tg_<id>`), обновляет поля, либо создаёт новую запись. Выставляет is_admin=1 если tg_id совпадает с ADMIN_TG_ID из .env.
7. Кладёт запись БД в req.user и передаёт управление следующему хендлеру.

## API

### GET /api/me
Требует заголовок `X-Telegram-Init-Data`.

**Ответ 200 OK:**
```json
{
  "id": 1,
  "platform": "tg",
  "platformId": "tg_845707896",
  "username": "sergeyxmao",
  "firstName": "Сергей",
  "lastName": null,
  "photoUrl": "https://...",
  "isAdmin": true,
  "createdAt": "2026-04-24T10:00:00.000Z",
  "lastSeenAt": "2026-04-24T10:05:00.000Z"
}
```

**Ответ 401 при провале проверки:**
```json
{ "error": "unauthorized", "reason": "<string>" }
```

Возможные значения `reason`:
- `bot_token_not_configured` — на сервере не задан TG_BOT_TOKEN
- `empty_init_data` — нет заголовка X-Telegram-Init-Data
- `no_hash` — в initData отсутствует поле hash
- `hash_format` — hash некорректного формата
- `bad_hash` — подпись не совпадает (поддельный initData или неправильный BOT_TOKEN)
- `no_auth_date` / `future_date` / `expired` — проблемы с timestamp
- `no_user` / `bad_user_json` / `no_user_id` — нет данных пользователя

**Ответ 500:**
```json
{ "error": "auth_upsert_failed" }
```

## Настройки
- `TG_BOT_TOKEN` (backend/.env) — токен бота @kudri_lena_bot. Используется для HMAC-подписи.
- `ADMIN_TG_ID` (backend/.env) — Telegram user.id администратора. При совпадении — is_admin=1.

## Безопасность
- Проверка HMAC — через `crypto.timingSafeEqual` (защита от timing-атак).
- auth_date старше 24 часов — отклоняется (защита от replay старых initData).
- При смене BOT_TOKEN все существующие initData становятся невалидными — это ожидаемое поведение.

## История изменений
- 2026-04-24: Создан файл. Реализация initData-проверки + upsert + middleware + /api/me.
