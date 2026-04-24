# Структура проекта КУДРИ

## Описание
Раскладка файлов и папок репозитория kgm-analyzer. Задаёт где что лежит и куда класть новое.

## Расположение файлов
- `frontend/index.html` — единый файл фронта (vanilla JS, HTML, CSS).
- `backend/` — серверная часть на Node.js + Express (в разработке).
  - `routes/` — Express-роуты, по одному файлу на группу эндпоинтов.
  - `services/` — бизнес-логика: AI-роутер, auth, работа с БД.
  - `bot/` — Telegram-бот @kudri_lena_bot.
  - `db/` — SQL-миграции (выполняются владельцем вручную через sqlite3 CLI).
- `data/` — файл SQLite-БД `kudri.db`. В git не попадает.
- `docs/technical/` — документация по функциям, Markdown, один файл на функцию.
- `logs/` — логи Node-приложения. В git не попадает.
- `uploads/` — фото сканов пользователей. В git не попадает.
- `index.html` (в корне) — тонкая заглушка с редиректом на `/frontend/index.html`, оставлена для совместимости пока nginx не переключат на `frontend/` как root.

## Как работает
1. Все изменения идут в ветку `main`.
2. Git push в main → GitHub webhook → сервер `elenadortman.store` → автодеплой за ~3 секунды.
3. Nginx отдаёт статику из `/var/www/kudri/` напрямую (фронт).
4. Nginx проксирует `api.elenadortman.store` на Node API (порт 3001, локально).
5. Nginx проксирует `api.elenadortman.store/webhook-deploy` на webhook-слушатель (порт 9000, локально).

## API (если применимо)
Не применимо (этот файл описывает структуру, не API).

## Настройки
Переменные окружения — в `backend/.env` (создаётся вручную на сервере, не в git).
Шаблон — `backend/.env.example`.

## История изменений
- 2026-04-24: Создан файл. Первоначальная структура проекта: frontend/, backend/, docs/, data/, logs/, uploads/.
