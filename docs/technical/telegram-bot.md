# Telegram-бот

## Описание
Telegram-бот `@kudri_lena_bot`. Реализована одна команда `/start` — отдаёт приветствие и кнопку открытия Mini App. Все прочие сообщения игнорируются.

## Расположение файлов
- `backend/bot/index.js` — точка входа модуля бота.
- `backend/server.js` — монтирование handler в Express.
- `backend/.env` — `TG_BOT_TOKEN`, `TG_WEBHOOK_SECRET`.

## Архитектура
Webhook (НЕ long polling). Telegram POST-ит обновления на `https://api.elenadortman.store/telegram/webhook/<secret>`. Express проксируется через nginx, без отдельных портов или процессов. Бот живёт в том же процессе что и API — один systemd-юнит, один порт.

## Команды
- `/start` — приветствие + inline-кнопка `[ Открыть КУДРИ ]` (тип `web_app`, URL `https://elenadortman.store`).
- Любое другое сообщение — игнорируется.

## Регистрация webhook (выполняется один раз вручную)
```bash
TOKEN=$(grep -E '^TG_BOT_TOKEN=' /var/www/kudri/backend/.env | cut -d= -f2)
SECRET=$(grep -E '^TG_WEBHOOK_SECRET=' /var/www/kudri/backend/.env | cut -d= -f2)
curl -s "https://api.telegram.org/bot$TOKEN/setWebhook?url=https://api.elenadortman.store/telegram/webhook/$SECRET"
curl -s "https://api.telegram.org/bot$TOKEN/getWebhookInfo"
```
Первая команда регистрирует URL у Telegram. Вторая — проверяет что регистрация прошла (поле `url` должно быть непустым, `pending_update_count` — низкое число).

## Сброс webhook (если понадобится)
```bash
curl -s "https://api.telegram.org/bot$TOKEN/deleteWebhook"
```

## Безопасность
Путь webhook содержит 32-байтный секрет. Без знания секрета внешний адресат не может слать поддельные обновления — отвечать им будет 404 (потому что telegraf не распознает путь). Секрет хранится только в `.env` на сервере, в коде/доках/git его нет.

Webhook-секрет в URL маскируется в логах: пишется `/telegram/webhook/[secret]` вместо реального значения. См. `docs/technical/logging.md`.

## Настройки
- `TG_BOT_TOKEN` (`backend/.env`) — токен от BotFather.
- `TG_WEBHOOK_SECRET` (`backend/.env`) — 32-байтный hex для пути webhook.
- `MINI_APP_URL` — захардкожен в `backend/bot/index.js` как `https://elenadortman.store`. При смене домена — править здесь.

## Что НЕ делает
- Нет команд `/help`, `/profile`, `/settings`. Будут добавлены отдельными ТЗ.
- Нет автоматической регистрации webhook при старте сервиса. Регистрация — ручная, через curl.
- Нет логирования всех апдейтов (только ошибки `/start`).
- Нет ответов на не-команды.
- Нет inline-режима, нет обработки изображений / контактов / геолокации.

## История изменений
- 2026-04-26: Создан файл. Минимальный бот с командой `/start` через webhook (telegraf 4.x).
