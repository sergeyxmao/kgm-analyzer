# Сканер — поток анализа

## Описание
Полный поток от ввода INCI до сохранения и отображения в каталоге.

## Текущая поддержка
- ✅ Текстовый ввод INCI (копипаст в поле).
- ⏳ Фото — запланировано (нужна интеграция с S3 + vision-режим Gemini). Сейчас `Scanner.handleFile()` показывает тост «Анализ по фото скоро» и не запускает анализ.
- ❌ Вне Telegram Mini App — сканер отключён (нет initData, нечем авторизоваться на бэке). Web/гость получают тост «Сканер доступен только в Telegram».

## Поток (текстовый режим)

1. Пользователь вставляет INCI в `#text-input` → жмёт «Проанализировать» → `Scanner.analyzeText()`.
2. `Scanner.analyze({type:'text', data:text})` показывает спиннер в `#scan-result`.
3. `Api.analyze(input)` → `POST /api/analyze` с заголовком `X-Telegram-Init-Data`.
4. Бэкенд (`services/analyze.js`):
   - Читает профиль пользователя из БД (`services/profiles.getProfileByUserId`).
   - Формирует персонализированный промпт с профилем.
   - Идёт в Gemini (`services/gemini.js`) через `https://generativelanguage.googleapis.com/.../gemini-2.5-flash:generateContent`.
   - Парсит JSON-ответ, валидирует форму (наличие `verdict` и `verdictTitle`).
   - Возвращает вердикт фронту.
5. `Api.createScan({...verdict, profileSnapshot:<local profile>})` → `POST /api/scans` сохраняет запись в `scans` с `shelf='history'`, `profile_snapshot` — снимок профиля.
6. Фронт запоминает `scan.id` в `Scanner.lastScanId`.
7. `Scanner.renderResult(verdict)` рисует карточку вердикта.
8. `App.refreshRecent()` перерисовывает главный экран (три последних скана).
9. Пользователь жмёт «В мои» / «Хочу купить» → `Scanner.saveTo('mine' | 'wishlist')` → `Api.updateScanShelf(lastScanId, shelf)` → `PUT /api/scans/:id/shelf`.

## Ошибки
- Любая ошибка в `/api/analyze` или `/api/scans` → карточка с текстом `err.payload.error` или `err.message`. Спиннер снимается в `finally`-ветке.
- Частые коды: `gemini_timeout`, `gemini_http_429` (квота), `bad_ai_json`. Подробнее — `docs/technical/ai-analyze.md`.

## Где что лежит
- Frontend: `frontend/index.html` → объекты `Api`, `Scanner`, `Catalog`, метод `App.refreshRecent`.
- Backend AI-прокси: `backend/services/{gemini,analyze}.js`.
- Backend CRUD сканов: `backend/services/scans.js`.
- БД: таблица `scans` (см. `backend/db/001-init.sql` + `002-add-profile-snapshot.sql`).

## Не реализовано в этом ТЗ
- Анализ по фото (требует загрузки на S3 + vision-режим Gemini).
- Кеширование результатов (один и тот же состав может анализироваться повторно).
- Шеринг скана с другим пользователем.
- Удаление скана из UI (эндпоинт `DELETE /api/scans/:id` есть, кнопки в UI нет).

## История изменений
- 2026-04-24: Создан файл. Текстовый режим работает end-to-end (TG only).
