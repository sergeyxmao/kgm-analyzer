/**
 * КУДРИ · middleware: требует флаг is_admin у текущего пользователя.
 * Используется ПОСЛЕ requireTelegramAuth (зависит от req.user).
 */

function requireAdmin(req, res, next) {
  if (!req.user || req.user.is_admin !== 1) {
    return res.status(403).json({ error: 'forbidden' });
  }
  return next();
}

module.exports = requireAdmin;
