# Логирование backend

## Описание
Структурированное логирование backend. Один файл `/var/log/kudri-api.log`, единый формат строк, request_id для трассировки. Каждый HTTP-запрос порождает access-строку плюс (опционально) уровневые строки (info/warn/error), связанные с ним общим request_id.

## Расположение файлов
- `backend/services/logger.js` — модуль логгера. Экспортирует объект `log` с методами `info`, `warn`, `error` и Express-middleware `log.requestId`, `log.access`.
- `backend/server.js` — подключение middleware и использование `log.*` во всех handler'ах.
- `deploy/logrotate-kudri-api` — конфиг logrotate (применяется на сервер вручную, см. ниже).

## Формат строк

### Access-лог
Одна строка на завершившийся HTTP-запрос, кроме `/health` и `/db-status`:
```
2026-04-27T08:15:23.456Z [a3f1] 91.108.5.4 GET /api/me 200 134b 12ms
```
Поля: ISO-timestamp, request_id (4 hex-символа в скобках), client IP (из `X-Real-IP`, fallback на `req.ip`), HTTP-метод, путь без query string, статус ответа, размер тела ответа в байтах, время обработки в миллисекундах.

### Уровневый лог (info / warn / error)
```
2026-04-27T08:15:23.456Z [a3f1] ERROR [GET /api/profile] SqliteError: no such table
    at Database.prepare (/var/www/kudri/...)
    at ...
```
Поля: ISO-timestamp, request_id (или `----` если запрос недоступен), уровень (`INFO`/`WARN`/`ERROR`), контекст в скобках (роут или модуль), сообщение. Для `Error`-объектов автоматически разворачивается `name: message` + stack-trace с отступом 4 пробела.

## Request ID
Каждому запросу присваивается 4 hex-символа из UUID. ID попадает:
- в access-строку,
- в строки ошибок относящихся к запросу (через `log.error(req, ...)`),
- в HTTP-заголовок ответа `X-Request-Id`.

Если ошибку сообщает пользователь — попроси у него заголовок `X-Request-Id` из DevTools, можно найти все строки одной грепкой:
```
grep '\[a3f1\]' /var/log/kudri-api.log
```

## Маскировка секретов
Путь `/telegram/webhook/<32-байтный hex>` пишется в логах как `/telegram/webhook/[secret]`. Сам секрет в файл не попадает ни в access-логе, ни в error-логе.

## Скип эндпоинтов
`/health` и `/db-status` не логируются в access-логе — это шум от мониторинга.

## Использование (для разработчиков)
```js
const { log } = require('./services/logger');

log.info(null, '[startup]', 'something happened');
log.warn(req, '[auth]', 'bad token');
log.error(req, '[POST /api/scans]', err);
```
- Первый аргумент: Express `req` (если есть) или `null`.
- Второй: контекст в квадратных скобках (роут или модуль).
- Третий: текст или объект `Error` (Error развернётся в name+message+stack автоматически).

В сервисных модулях, у которых нет доступа к `req` (старт, фоновая задача), передавай `null` — в строке появится `[----]`.

## Logrotate
Файл конфига: `deploy/logrotate-kudri-api`. Применение (вручную после деплоя):
```bash
sudo cp /var/www/kudri/deploy/logrotate-kudri-api /etc/logrotate.d/kudri-api
sudo logrotate -d /etc/logrotate.d/kudri-api    # dry-run для проверки
```
Параметры:
- ежедневная ротация,
- хранение 14 дней,
- gzip старых файлов (`compress`, `delaycompress` — последний файл не сжимается, чтобы поиск был быстрым),
- `copytruncate` — чтобы systemd-append не потерял дескриптор и не пришлось рестартить сервис при ротации.

## Просмотр логов
- В реальном времени: `tail -f /var/log/kudri-api.log`
- Поиск ошибок за сегодня: `grep ERROR /var/log/kudri-api.log`
- Поиск всех строк по request_id: `grep '\[a3f1\]' /var/log/kudri-api.log`
- Поиск активности пользователя по IP: `grep '91.108.5.4' /var/log/kudri-api.log`

## Что НЕ логируется
- Тела запросов и ответов (могут содержать base64-фото, API-ключи, личные данные).
- `/health`, `/db-status` (мониторинг).
- Webhook-секрет в URL (маскируется на `[secret]`).

## Что не делает
- Нет ротации по размеру (только по дню).
- Нет отправки логов во внешние системы (нет ELK/Grafana/etc.).
- Нет JSON-формата (для grep/awk текст удобнее).
- Нет цветов в терминале (`tail -f` всегда нейтральный).
- Нет уровней через env (DEBUG/INFO/WARN — все включены всегда).

## История изменений
- 2026-04-27: Создан файл. Production-grade logger с access-логом, request_id, маскировкой секретов, logrotate.
