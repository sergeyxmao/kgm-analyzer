# Сканер — поток анализа

## Описание
Полный поток от ввода INCI до сохранения и отображения в каталоге.

## Текущая поддержка
- ✅ Текстовый ввод INCI (копипаст в поле).
- ✅ Фото — поддерживается (vision-режим, S3 + AI). Подробности — `photo-analysis.md`.
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

## Поток (фото-режим)
End-to-end: камера → сжатие на клиенте (canvas, max 1024px, JPEG q=0.8) → multipart `POST /api/scans/full-photo` → бэк грузит фото в S3, зовёт AI с image-payload, пишет скан в БД с `photo_key` → ответ содержит `photoUrl` (presigned GET, 1 час). В каталоге у скана с `photoKey` рендерится миниатюра вместо иконки 🧴. Полное описание — `photo-analysis.md`.

## Распознавание бренда и подтверждение пользователем
В фото-режиме AI дополнительно извлекает поля `brand`, `productName` и метку уверенности `brandConfidence` (`high`/`medium`/`low`). В текстовом режиме оба поля всегда `null`, `brandConfidence` в ответе не возвращается.

- При создании скана через `POST /api/scans/full-photo` ответ содержит `{ scan, brandConfidence }`. `brand` и `productName` уже сохранены в БД.
- На экране результата фронт показывает блок «🤔 Угадал?» если `brandConfidence ∈ {medium, low}` или `brand` пустой. Кнопки:
  - «✅ Да, всё верно» — сворачивает блок, ничего не пишет.
  - «✏️ Поправить» — открывает два input (brand, productName) с предзаполненными значениями. Кнопка «Сохранить» вызывает `PATCH /api/scans/:id/brand`.
  - «❌ Не определять» — обнуляет оба поля через `PATCH /api/scans/:id/brand` с `brand: null, productName: null`.
- В карточке каталога рядом с шеринг-кнопками есть ✏️ для inline-редактирования бренда и названия в любой момент.

Заголовок карточки скана в каталоге, на главной и на публичной странице шеринга формируется по правилу `formatScanTitle`:
- если есть `brand` и `productName` → `«{brand} · {productName}»`
- если только `brand` → `«{brand}»`
- если только `productName` → `«{productName}»`
- иначе → `«Бренд не определён»`

`productType` (тип средства) не пропадает — он остаётся в данных скана и показывается мелким подзаголовком под названием.

## Ошибки
- Любая ошибка в `/api/analyze` или `/api/scans` → карточка с текстом `err.payload.error` или `err.message`. Спиннер снимается в `finally`-ветке.
- Частые коды: `gemini_timeout`, `gemini_http_429` (квота), `bad_ai_json`. Подробнее — `docs/technical/ai-analyze.md`.

## Где что лежит
- Frontend: `frontend/index.html` → объекты `Api`, `Scanner`, `Catalog`, метод `App.refreshRecent`.
- Backend AI-прокси: `backend/services/{gemini,analyze}.js`.
- Backend CRUD сканов: `backend/services/scans.js`.
- БД: таблица `scans` (см. `backend/db/001-init.sql` + `002-add-profile-snapshot.sql`).

## Не реализовано в этом ТЗ
- Кеширование результатов (один и тот же состав может анализироваться повторно).
- Шеринг скана с другим пользователем.
- Удаление скана из UI (эндпоинт `DELETE /api/scans/:id` есть, кнопки в UI нет).

## История изменений
- 2026-04-24: Создан файл. Текстовый режим работает end-to-end (TG only).
- 2026-04-26: Реализован фото-режим end-to-end через S3 + vision AI.
- 2026-04-27: AI извлекает `brand`/`productName`/`brandConfidence` из фото. На экране результата — блок подтверждения. В каталоге — кнопка ✏️. Заголовок строится через `formatScanTitle`.
