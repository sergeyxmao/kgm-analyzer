/**
 * КУДРИ backend — Express API.
 * Минимальный старт: health-check. Бизнес-логика добавляется следующими ТЗ.
 */

const path = require('path');
const dotenv = require('dotenv');
const express = require('express');

// Загружаем .env из backend/.env (рядом с этим файлом)
dotenv.config({ path: path.join(__dirname, '.env') });

const { getSchemaVersion, listTables, countRows, dbPath } = require('./services/db');
const { getProfileByUserId, upsertProfile } = require('./services/profiles');
const requireTelegramAuth = require('./middleware/requireTelegramAuth');

const PORT = parseInt(process.env.PORT, 10) || 3001;
const HOST = '127.0.0.1';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '2mb' }));

// Health-check — используется для мониторинга и подтверждения что сервис жив
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'kudri-api',
    version: require('./package.json').version,
    uptime: Math.round(process.uptime()),
    timestamp: new Date().toISOString()
  });
});

// Диагностика БД — подтверждает что сервер видит файл, схема применена, считаны все таблицы
app.get('/db-status', (req, res) => {
  try {
    res.json({
      status: 'ok',
      dbPath: dbPath,
      schemaVersion: getSchemaVersion(),
      tables: listTables(),
      counts: countRows()
    });
  } catch (err) {
    console.error('[db-status]', err);
    res.status(500).json({ status: 'error', error: err.message });
  }
});

// Текущий пользователь. Требует валидный X-Telegram-Init-Data
app.get('/api/me', requireTelegramAuth, (req, res) => {
  res.json({
    id: req.user.id,
    platform: req.user.platform,
    platformId: req.user.platform_id,
    username: req.user.username,
    firstName: req.user.first_name,
    lastName: req.user.last_name,
    photoUrl: req.user.photo_url,
    isAdmin: req.user.is_admin === 1,
    createdAt: req.user.created_at,
    lastSeenAt: req.user.last_seen_at
  });
});

// Получить профиль текущего пользователя
app.get('/api/profile', requireTelegramAuth, (req, res) => {
  try {
    const profile = getProfileByUserId(req.user.id);
    res.json({ profile });
  } catch (err) {
    console.error('[GET /api/profile]', err);
    res.status(500).json({ error: 'profile_read_failed' });
  }
});

// Создать/обновить профиль текущего пользователя (PATCH-семантика)
app.put('/api/profile', requireTelegramAuth, (req, res) => {
  try {
    const result = upsertProfile(req.user.id, req.body);
    if (result.error) {
      return res.status(400).json({ error: result.error, field: result.field });
    }
    res.json({ profile: result.profile });
  } catch (err) {
    console.error('[PUT /api/profile]', err);
    res.status(500).json({ error: 'profile_write_failed' });
  }
});

// Все прочие пути — 404 JSON
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// Обработчик ошибок последней инстанции — чтобы сервер не падал на неожиданностях
app.use((err, req, res, next) => {
  console.error('[ERROR]', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, HOST, () => {
  console.log(`[kudri-api] listening on ${HOST}:${PORT}`);
});
