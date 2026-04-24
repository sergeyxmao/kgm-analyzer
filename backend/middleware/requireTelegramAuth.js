/**
 * КУДРИ · Express-middleware: валидирует X-Telegram-Init-Data, апсертит пользователя,
 * кладёт его в req.user.
 */

const { verifyTelegramInitData } = require('../services/auth');
const { upsertTelegramUser } = require('../services/users');

function requireTelegramAuth(req, res, next) {
  const initData = req.get('X-Telegram-Init-Data');
  const check = verifyTelegramInitData(initData);

  if (!check.ok) {
    return res.status(401).json({ error: 'unauthorized', reason: check.reason });
  }

  try {
    req.user = upsertTelegramUser(check.user);
    return next();
  } catch (err) {
    console.error('[auth] upsert failed:', err);
    return res.status(500).json({ error: 'auth_upsert_failed' });
  }
}

module.exports = requireTelegramAuth;
