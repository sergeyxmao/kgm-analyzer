/**
 * КУДРИ · админ-роуты. Все эндпоинты — только для админов (is_admin=1).
 * Монтируются в server.js на префикс /api/admin.
 *
 * Контракт ошибок сервиса:
 *   err.code === 'validation' → 400 { error:'validation', field, reason? }
 *   err.code === 'conflict'   → 409 { error:'conflict',   field }
 *   прочее                     → 500 { error:'internal_error' }
 */

const express = require('express');

const requireTelegramAuth = require('../middleware/requireTelegramAuth');
const requireAdmin = require('../middleware/requireAdmin');
const agents = require('../services/ai-agents');

const router = express.Router();

// Все эндпоинты защищены — сначала проверяем Telegram, затем админство
router.use(requireTelegramAuth, requireAdmin);

// GET /api/admin/agents — список
router.get('/agents', (req, res) => {
  try {
    res.json({ agents: agents.listAgents() });
  } catch (err) {
    console.error('[GET /api/admin/agents]', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

// GET /api/admin/agents/:id — один агент
router.get('/agents/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'bad_id' });

  try {
    const agent = agents.getAgentById(id);
    if (!agent) return res.status(404).json({ error: 'not_found' });
    res.json({ agent });
  } catch (err) {
    console.error('[GET /api/admin/agents/:id]', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

// POST /api/admin/agents — создать
router.post('/agents', (req, res) => {
  try {
    const agent = agents.createAgent(req.body || {});
    res.status(201).json({ agent });
  } catch (err) {
    return sendServiceError(res, err, '[POST /api/admin/agents]');
  }
});

// PUT /api/admin/agents/:id — PATCH-обновление
router.put('/agents/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'bad_id' });

  try {
    const agent = agents.updateAgent(id, req.body || {});
    if (!agent) return res.status(404).json({ error: 'not_found' });
    res.json({ agent });
  } catch (err) {
    return sendServiceError(res, err, '[PUT /api/admin/agents/:id]');
  }
});

// DELETE /api/admin/agents/:id
router.delete('/agents/:id', (req, res) => {
  const id = parseInt(req.params.id, 10);
  if (!id) return res.status(400).json({ error: 'bad_id' });

  try {
    const ok = agents.deleteAgent(id);
    if (!ok) return res.status(404).json({ error: 'not_found' });
    res.status(204).send();
  } catch (err) {
    console.error('[DELETE /api/admin/agents/:id]', err);
    res.status(500).json({ error: 'internal_error' });
  }
});

function sendServiceError(res, err, tag) {
  if (err && err.code === 'validation') {
    const body = { error: 'validation', field: err.field };
    if (err.reason) body.reason = err.reason;
    return res.status(400).json(body);
  }
  if (err && err.code === 'conflict') {
    return res.status(409).json({ error: 'conflict', field: err.field });
  }
  console.error(tag, err);
  return res.status(500).json({ error: 'internal_error' });
}

module.exports = router;
