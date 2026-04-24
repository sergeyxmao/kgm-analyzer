# Frontend ↔ Backend интеграция

## Описание
Фронт (`frontend/index.html`) в Telegram Mini App общается с бэкендом через same-origin `/api/*`. Эндпоинты используются для авторизации, получения и сохранения профиля. `localStorage` остаётся как кэш и fallback.

VK и веб-режим пока не интегрированы с бэком — работают в `localStorage`-only режиме (планируются в последующих ТЗ).

## Расположение кода
Всё в `frontend/index.html`:
- Объект `Api` — HTTP-клиент, оборачивает `fetch`.
- `Auth.loginTelegram()` — вызывает `GET /api/me`.
- `Auth.afterLogin()` — вызывает `GET /api/profile`.
- `Onboarding.finish()` — вызывает `PUT /api/profile`.

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
  ├─ Storage.set('profile', answers)   — всегда
  ├─ (в TG) Api.putProfile(answers)
  │    ├─ OK → показать app
  │    └─ FAIL → тост «сохранено локально», показать app
```

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
