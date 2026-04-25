# КУДРИ

Анализ косметических составов (INCI) для кудрявых волос по принципам КГМ.

Фронт: https://elenadortman.store
API: https://api.elenadortman.store (в разработке)

## Стек

- **Frontend:** vanilla JS + HTML + CSS (единый файл `frontend/index.html`)
- **Backend:** Node.js + Express + better-sqlite3
- **БД:** SQLite (`data/kudri.db`)
- **AI:** Google Gemini 2.5 Flash (OCR + анализ INCI)
- **Платформы:** Telegram Mini App, VK Mini App, веб-браузер 

## Структура

```
kgm-analyzer/
├── frontend/          Статика фронта (index.html)
├── backend/           Node.js API
│   ├── routes/        API-эндпоинты
│   ├── services/      Бизнес-логика (ai-router, auth, db)
│   ├── bot/           Telegram-бот
│   └── db/            SQL-миграции
├── data/              БД SQLite (вне git)
├── docs/technical/    Документация по функциям
├── logs/              Логи Node (вне git)
└── uploads/           Фото сканов (вне git)
```

## Разработка

Ветка только `main`. Все изменения → push в main → автодеплой на VPS за ~3 секунды через webhook.

Документация по функциям — в `docs/technical/` (один файл = одна функция).

### Запуск backend локально

```bash
cd backend
cp .env.example .env        # заполнить реальными значениями
npm install
npm start
```

Сервер слушает `127.0.0.1:3001`. Проверка: `curl http://127.0.0.1:3001/health`.
Подробнее — `docs/technical/backend-server.md`.

## Окружение

`backend/.env` создаётся вручную на сервере по шаблону `backend/.env.example`.
Никогда не коммитится.
