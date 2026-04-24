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
const { analyzeInci } = require('./services/analyze');
const scans = require('./services/scans');
const requireTelegramAuth = require('./middleware/requireTelegramAuth');

const PORT = parseInt(process.env.PORT, 10) || 3001;
const HOST = '127.0.0.1';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '10mb' }));

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

// POST /api/analyze — анализ INCI через Gemini
app.post('/api/analyze', requireTelegramAuth, async (req, res) => {
  try {
    const { content } = req.body || {};
    const out = await analyzeInci(req.user.id, content);
    if (!out.ok) {
      // Внешние ошибки — 502 (Bad Gateway к AI), валидация — 400
      const userErrors = new Set(['bad_input', 'bad_type', 'empty_data', 'text_too_long', 'image_too_large']);
      const status = userErrors.has(out.error) ? 400 : 502;
      return res.status(status).json({ error: out.error, detail: out.detail });
    }
    res.json(out.result);
  } catch (err) {
    console.error('[POST /api/analyze]', err);
    res.status(500).json({ error: 'analyze_failed' });
  }
});

// POST /api/scans — создать запись о скане (после успешного /api/analyze)
app.post('/api/scans', requireTelegramAuth, (req, res) => {
  try {
    const data = req.body || {};
    if (!data.verdict) return res.status(400).json({ error: 'verdict_required' });
    const scan = scans.createScan(req.user.id, data);
    res.status(201).json({ scan });
  } catch (err) {
    if (err.code === 'bad_verdict') return res.status(400).json({ error: err.code });
    console.error('[POST /api/scans]', err);
    res.status(500).json({ error: 'create_failed' });
  }
});

// GET /api/scans — список сканов текущего пользователя с фильтром
app.get('/api/scans', requireTelegramAuth, (req, res) => {
  try {
    const shelf = req.query.shelf || 'all';
    const limit = req.query.limit || 50;
    const list = scans.listScans(req.user.id, shelf, limit);
    res.json({ scans: list });
  } catch (err) {
    if (err.code === 'bad_shelf') return res.status(400).json({ error: err.code });
    console.error('[GET /api/scans]', err);
    res.status(500).json({ error: 'list_failed' });
  }
});

// PUT /api/scans/:id/shelf — переместить на полку
app.put('/api/scans/:id/shelf', requireTelegramAuth, (req, res) => {
  try {
    const scanId = parseInt(req.params.id, 10);
    if (!scanId) return res.status(400).json({ error: 'bad_id' });
    const shelf = req.body?.shelf;
    if (!shelf) return res.status(400).json({ error: 'shelf_required' });

    const scan = scans.updateShelf(scanId, req.user.id, shelf);
    if (!scan) return res.status(404).json({ error: 'not_found' });
    res.json({ scan });
  } catch (err) {
    if (err.code === 'bad_shelf') return res.status(400).json({ error: err.code });
    console.error('[PUT /api/scans/:id/shelf]', err);
    res.status(500).json({ error: 'update_failed' });
  }
});

// DELETE /api/scans/:id — удалить скан (только свой)
app.delete('/api/scans/:id', requireTelegramAuth, (req, res) => {
  try {
    const scanId = parseInt(req.params.id, 10);
    if (!scanId) return res.status(400).json({ error: 'bad_id' });
    const ok = scans.deleteScan(scanId, req.user.id);
    if (!ok) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (err) {
    console.error('[DELETE /api/scans/:id]', err);
    res.status(500).json({ error: 'delete_failed' });
  }
});

// Админ-роуты (CRUD для AI-агентов). Все эндпоинты требуют is_admin=1.
app.use('/api/admin', require('./routes/admin'));

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
