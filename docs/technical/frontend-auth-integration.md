# Frontend ↔ Backend интеграция

## Описание
Фронт (`frontend/index.html`) в Telegram Mini App общается с бэкендом через same-origin `/api/*`. Эндпоинты используются для авторизации, получения и сохранения профиля. `localStorage` остаётся как кэш и fallback.

VK и веб-режим пока не интегрированы с бэком — работают в `localStorage`-only режиме (планируются в последующих ТЗ).

## Расположение кода
Всё в `frontend/index.html`:
- Объект `Api` — HTTP-клиент, оборачивает `fetch`. Методы: `getMe`, `getProfile`, `putProfile`, `analyze`, `createScan`, `listScans`, `updateScanShelf`, `deleteScan`.
- `Auth.loginTelegram()` — вызывает `GET /api/me`.
- `Auth.afterLogin()` — вызывает `GET /api/profile`.
- `Onboarding.finish()` — вызывает `PUT /api/profile`.
- `Scanner.analyze()` — вызывает `POST /api/analyze`, затем `POST /api/scans` для сохранения.
- `Scanner.saveTo()` — вызывает `PUT /api/scans/:id/shelf`.
- `App.refreshRecent()` — вызывает `GET /api/scans?limit=3` (последние).
- `Catalog.load()` — вызывает `GET /api/scans?shelf=<>&limit=100`.

## Архитектура

### Определение среды
`Api.canUseBackend()` — `true`, если `window.Telegram.WebApp.initData` непустой. Это единственный признак «мы в TG Mini App с рабочим auth».

### Алгоритм входа (TG)

```
Auth.loginTelegram():
  ├─ Api.getMe()   → пользователь зарегистрирован на бэке, is_admin пришёл с сервера
  │    ├─ OK → Storage.set('user', ...), afterLogin()
  │    └─ FAIL → fallback: определяем is_admin по ADMIN_TG_ID на клиенте, работаем без бэка

Auth.afterLogin():
  ├─ (в TG) Api.getProfile()
  │    ├─ profile есть → Storage.set('profile', ...), показать app
  │    ├─ profile null → удалить из Storage, показать онбординг
  │    └─ ошибка → оставить Storage как есть
  └─ (не в TG) работать с тем, что в Storage

Onboarding.finish():
  ├─ Собирает colorState из выбранной опции + текста «Уточнения»
  │    в строку формата «<Метка>. Уточнения: <note>»
  ├─ Storage.set('profile', {..., color: colorState})   — всегда (ключ `color` для совместимости)
  ├─ (в TG) Api.putProfile({..., colorState})           — на бэк уже camelCase
  │    ├─ OK → показать app
  │    └─ FAIL → тост «сохранено локально», показать app
```

## Онбординг: шаги
Онбординг состоит из 6 шагов (eyebrow «Шаг N из 6»):
1. `curlType` — тип кудрей (single)
2. `porosity` — пористость (single)
3. `thickness` — толщина волоса (single)
4. `scalp` — кожа головы (single)
5. `colorState` — окрашивание (single_with_note: выбор опции + опциональный textarea «Уточнения»)
6. `goals` — цели ухода (multi)

Для шага `colorState` кнопка «Дальше» активна, если выбрана одна из опций; текст уточнений не обязателен. В state онбординга значения хранятся как два отдельных ключа: `colorState_choice` (id опции) и `colorState_note` (строка), в `finish()` склеиваются в одну строку.

## Редактирование профиля
Кнопка «Изменить профиль» в `screen-profile` вызывает `Onboarding.start(false)`. В отличие от первого запуска — `reset=false`, текущие ответы предзаполняются в `state.answers` из `localStorage`. После прохождения онбординга `finish()` заново отправляет `PUT /api/profile` с обновлёнными полями.

Для поля `colorState` реализован reverse-mapping из строки формата `«<Метка>. Уточнения: <note>»` обратно в `colorState_choice` + `colorState_note`. Если старое значение не распознано (например, предзаполнено вручную через curl / SQL до этой фичи) — целиком кладётся в `note` с дефолтным `choice = 'full'`, чтобы пользователь увидел что там было и мог поправить.

## Форматы данных
Бэк принимает/отдаёт camelCase: `curlType`, `colorState`, `goals`.

Фронт хранит в `localStorage` почти тот же формат, с единственным исключением:
- в `localStorage` поле называется `color` (устаревшее имя)
- на бэке — `colorState`

Маппинг делается при сериализации в запрос / десериализации из ответа (см. `afterLogin`).

## Обработка ошибок
- Сетевые ошибки / 5xx / 401 — фронт fallback-ит на `localStorage`, работает в офлайн-режиме.
- Тост информирует пользователя при деградации.
- Приложение никогда не падает из-за недоступности бэка — TG Mini App должен открываться даже если API упал.

## Не делает это ТЗ
- Не переносит историю сканов (`Scanner`/`saveToHistory`) на бэк — следующее ТЗ (вместе с `/api/analyze`).
- Не интегрирует VK Bridge с бэком — отложено.
- Не добавляет кнопку «синхронизировать профиль» в UI — пока реинициализации при перезагрузке достаточно.

## История изменений
- 2026-04-24: Создан файл. Интеграция TG auth и profile с бэкендом.
- 2026-04-24: Добавлен 6-й шаг онбординга — `colorState` (single_with_note). В `Onboarding.finish()` — сбор строки и отправка как `colorState` (camelCase) на бэк. Кнопка «Изменить профиль» переведена на `start(false)` с reverse-mapping существующего значения.
