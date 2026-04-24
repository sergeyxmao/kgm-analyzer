/**
 * КУДРИ · Express-middleware: пропускает только админов.
 * Ожидает что requireTelegramAuth уже выполнен и положил пользователя в req.user.
 * Перечитывает запись из БД через getUserById — так флаг is_admin всегда свежий
 * (если админство сняли, следующий запрос тут же получит 403).
 */

const { getUserById } = require('../services/users');

function requireAdmin(req, res, next) {
  if (!req.user || !req.user.id) {
    return res.status(401).json({ error: 'unauthorized' });
  }

  const user = getUserById(req.user.id);
  if (!user || !user.isAdmin) {
    return res.status(403).json({ error: 'not_admin' });
  }

  return next();
}

module.exports = requireAdmin;
