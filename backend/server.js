/**
 * КУДРИ backend — Express API.
 * Минимальный старт: health-check. Бизнес-логика добавляется следующими ТЗ.
 */

const path = require('path');
const dotenv = require('dotenv');
const express = require('express');
const multer = require('multer');

// Загружаем .env из backend/.env (рядом с этим файлом)
dotenv.config({ path: path.join(__dirname, '.env') });

const { getSchemaVersion, listTables, countRows, dbPath } = require('./services/db');
const { getProfileByUserId, upsertProfile } = require('./services/profiles');
const { analyzeInci, buildAnalystPrompt } = require('./services/analyze');
const scans = require('./services/scans');
const s3 = require('./services/s3');
const aiRouter = require('./services/ai-router');
const productImageFinder = require('./services/product-image-finder');
const requireTelegramAuth = require('./middleware/requireTelegramAuth');
const { getWebhookHandler } = require('./bot');
const { log } = require('./services/logger');

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 2 * 1024 * 1024 } // 2 МБ
});

const PORT = parseInt(process.env.PORT, 10) || 3001;
const HOST = '127.0.0.1';

const app = express();
app.disable('x-powered-by');
app.use(log.requestId);
app.use(log.access);
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
    log.error(req, '[db-status]', err);
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
    log.error(req, '[GET /api/profile]', err);
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
    log.error(req, '[PUT /api/profile]', err);
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
    log.error(req, '[POST /api/analyze]', err);
    res.status(500).json({ error: 'analyze_failed' });
  }
});

// POST /api/scans — создать запись о скане (после успешного /api/analyze)
app.post('/api/scans', requireTelegramAuth, async (req, res) => {
  try {
    const data = req.body || {};
    if (!data.verdict) return res.status(400).json({ error: 'verdict_required' });
    const scan = await scans.createScan(req.user.id, data);
    res.status(201).json({ scan });
  } catch (err) {
    if (err.code === 'bad_verdict') return res.status(400).json({ error: err.code });
    log.error(req, '[POST /api/scans]', err);
    res.status(500).json({ error: 'create_failed' });
  }
});

// GET /api/scans — список сканов текущего пользователя с фильтром
app.get('/api/scans', requireTelegramAuth, async (req, res) => {
  try {
    const shelf = req.query.shelf || 'all';
    const limit = req.query.limit || 50;
    const list = await scans.listScans(req.user.id, shelf, limit);
    res.json({ scans: list });
  } catch (err) {
    if (err.code === 'bad_shelf') return res.status(400).json({ error: err.code });
    log.error(req, '[GET /api/scans]', err);
    res.status(500).json({ error: 'list_failed' });
  }
});

// PATCH /api/scans/:id/brand — обновить бренд и название товара (только свой скан)
app.patch('/api/scans/:id/brand', requireTelegramAuth, async (req, res) => {
  try {
    const scanId = parseInt(req.params.id, 10);
    if (!scanId) return res.status(400).json({ error: 'bad_id' });
    const body = req.body || {};
    const scan = await scans.updateScanBrand(scanId, req.user.id, {
      brand: body.brand,
      productName: body.productName
    });
    if (!scan) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true, brand: scan.brand, productName: scan.productName });
  } catch (err) {
    if (err.code === 'bad_field' || err.code === 'field_too_long') {
      return res.status(400).json({ error: err.code });
    }
    log.error(req, '[PATCH /api/scans/:id/brand]', err);
    res.status(500).json({ error: 'update_failed' });
  }
});

// PUT /api/scans/:id/shelf — переместить на полку
app.put('/api/scans/:id/shelf', requireTelegramAuth, async (req, res) => {
  try {
    const scanId = parseInt(req.params.id, 10);
    if (!scanId) return res.status(400).json({ error: 'bad_id' });
    const shelf = req.body?.shelf;
    if (!shelf) return res.status(400).json({ error: 'shelf_required' });

    const scan = await scans.updateShelf(scanId, req.user.id, shelf);
    if (!scan) return res.status(404).json({ error: 'not_found' });
    res.json({ scan });
  } catch (err) {
    if (err.code === 'bad_shelf') return res.status(400).json({ error: err.code });
    log.error(req, '[PUT /api/scans/:id/shelf]', err);
    res.status(500).json({ error: 'update_failed' });
  }
});

// POST /api/scans/:id/share — создать или вернуть существующий публичный токен
app.post('/api/scans/:id/share', requireTelegramAuth, async (req, res) => {
  try {
    const scanId = parseInt(req.params.id, 10);
    if (!scanId) return res.status(400).json({ error: 'bad_id' });
    const result = await scans.createShareToken(scanId, req.user.id);
    if (!result) return res.status(404).json({ error: 'not_found' });
    const url = `https://elenadortman.store/share/${result.token}`;
    res.json({ token: result.token, url });
  } catch (err) {
    log.error(req, '[POST /api/scans/:id/share]', err);
    res.status(500).json({ error: 'share_failed' });
  }
});

// DELETE /api/scans/:id/share — отозвать публичный токен
app.delete('/api/scans/:id/share', requireTelegramAuth, async (req, res) => {
  try {
    const scanId = parseInt(req.params.id, 10);
    if (!scanId) return res.status(400).json({ error: 'bad_id' });
    const ok = await scans.revokeShareToken(scanId, req.user.id);
    if (!ok) return res.status(404).json({ error: 'not_found' });
    res.json({ ok: true });
  } catch (err) {
    log.error(req, '[DELETE /api/scans/:id/share]', err);
    res.status(500).json({ error: 'revoke_failed' });
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
    log.error(req, '[DELETE /api/scans/:id]', err);
    res.status(500).json({ error: 'delete_failed' });
  }
});

// POST /api/scans/full-photo — фото → S3 → AI → запись в БД
app.post('/api/scans/full-photo', requireTelegramAuth, upload.single('photo'), async (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no_photo' });

  const mime = req.file.mimetype;
  if (mime !== 'image/jpeg' && mime !== 'image/png') {
    return res.status(400).json({ error: 'bad_mime' });
  }

  try {
    // 1. Загрузка в S3
    const photoKey = await s3.uploadObject(req.file.buffer, mime, 'scans');

    // 2. Анализ через AI
    const profile = getProfileByUserId(req.user.id);
    const prompt = buildAnalystPrompt(profile);
    let text;
    try {
      text = await aiRouter.generate({
        prompt,
        image: { mime, base64: req.file.buffer.toString('base64') }
      }, 'analyst');
    } catch (err) {
      try { await s3.deleteObject(photoKey); } catch {}
      return res.status(502).json({ error: err.code || err.message, detail: err.detail });
    }

    let result;
    try {
      result = JSON.parse(text);
      if (!result.verdict || !result.verdictTitle) throw new Error('no_verdict');
    } catch {
      try { await s3.deleteObject(photoKey); } catch {}
      return res.status(502).json({ error: 'bad_ai_response' });
    }

    // 3. Сохранение в БД
    const brand = typeof result.brand === 'string' ? result.brand : null;
    const productName = typeof result.productName === 'string' ? result.productName : null;
    const productImageStatus = (brand && productName) ? 'pending' : null;

    const scan = await scans.createScan(req.user.id, {
      verdict: result.verdict,
      verdictTitle: result.verdictTitle,
      productType: result.productType,
      brand,
      productName,
      summary: result.summary,
      ingredients: result.ingredients,
      profileSnapshot: profile,
      photoKey,
      productImageStatus
    });

    const brandConfidence = ['high', 'medium', 'low'].includes(result.brandConfidence)
      ? result.brandConfidence
      : null;
    res.status(201).json({ scan, brandConfidence });

    // 4. Фоновый поиск фото товара (огнём-и-забыть). Не блокирует ответ.
    if (brand && productName) {
      setImmediate(() => {
        productImageFinder.findAndSaveProductImage(scan.id, brand, productName);
      });
    }
  } catch (err) {
    log.error(req, '[POST /api/scans/full-photo]', err);
    res.status(500).json({ error: 'photo_scan_failed' });
  }
});

// Telegram webhook. Path содержит секрет из .env, поэтому маршрут не угадать извне.
// Telegraf сам парсит JSON-тело и сам валидирует путь.
app.use(getWebhookHandler());

// Админ-роуты (CRUD для AI-агентов). Все эндпоинты требуют is_admin=1.
app.use('/api/admin', require('./routes/admin'));

// Публичный роутер шеринга — без auth
app.use('/share', require('./routes/share'));

// Все прочие пути — 404 JSON
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.path });
});

// Обработчик ошибок последней инстанции — чтобы сервер не падал на неожиданностях
app.use((err, req, res, next) => {
  log.error(req, '[unhandled]', err);
  res.status(500).json({ error: 'Internal server error' });
});

app.listen(PORT, HOST, () => {
  log.info(null, '[startup]', `listening on ${HOST}:${PORT}`);
});
