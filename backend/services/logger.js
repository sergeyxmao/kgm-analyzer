/**
 * КУДРИ · структурированный логгер.
 *
 * Все строки в /var/log/kudri-api.log имеют единый формат:
 *   <ISO-timestamp> [<req-id>] <LEVEL> <ctx> <message>
 *
 * - <req-id> — 4 hex-символа, привязка к конкретному HTTP-запросу.
 *   Если запрос недоступен (старт сервиса, фоновая задача) — '----'.
 * - <LEVEL> — INFO | WARN | ERROR | (пусто для access-лога — он отдельным форматом).
 * - <ctx> — короткая метка вроде [GET /api/me] или [bot] или [s3] (квадратные скобки).
 * - <message> — текст ошибки/события. Для Error объектов выводится `${err.name}: ${err.message}` + stack с отступом 4 пробела.
 *
 * Чувствительные части URL маскируются (см. maskPath).
 *
 * Использование:
 *   const { log } = require('./services/logger');
 *   log.info(null, '[startup]', 'listening on 127.0.0.1:3001');
 *   log.warn(req, '[auth]', 'bad token');
 *   log.error(req, '[POST /api/scans]', err);
 *
 * Express middleware:
 *   app.use(log.requestId);   // ставит req.id и заголовок X-Request-Id
 *   app.use(log.access);      // пишет access-строку в конце запроса
 */

const crypto = require('crypto');

// Эндпоинты, которые НЕ логируются в access-лог (мониторинг)
const SKIP_ACCESS = new Set(['/health', '/db-status']);

// Маскировка чувствительных частей пути
function maskPath(pathname) {
  // /telegram/webhook/<секрет> → /telegram/webhook/[secret]
  if (pathname.startsWith('/telegram/webhook/')) return '/telegram/webhook/[secret]';
  return pathname;
}

// Получает clientIP с учётом прокси
function clientIp(req) {
  return req.get('X-Real-IP') || req.ip || req.connection?.remoteAddress || '-';
}

// Форматирование Error для лога
function formatError(err) {
  if (!err) return 'unknown_error';
  if (err instanceof Error) {
    const lines = [`${err.name}: ${err.message}`];
    if (err.stack) {
      const stackLines = err.stack.split('\n').slice(1); // первая строка дублирует name+message
      stackLines.forEach(l => lines.push('    ' + l.trim()));
    }
    return lines.join('\n');
  }
  return String(err);
}

// Единая точка выхода для всех строк логгера.
// ВНИМАНИЕ: сознательно используем console.error (а не console.log) — в systemd с
// StandardOutput=append:/var/log/kudri-api.log оба идут в один файл, но stderr
// небуферизуется. Это критично для логов: потеря строк при крэше = слепота.
function writeLine(line) {
  console.error(line);
}

// Базовая запись уровневой строки. Отдельная функция чтобы все методы шли через
// одну точку (упростит миграцию на winston/pino при необходимости).
function write(level, req, ctx, message) {
  const ts = new Date().toISOString();
  const id = (req && req.id) || '----';
  const text = (message instanceof Error) ? formatError(message) : String(message);
  writeLine(`${ts} [${id}] ${level} ${ctx} ${text}`);
}

const log = {
  info(req, ctx, message)  { write('INFO',  req, ctx, message); },
  warn(req, ctx, message)  { write('WARN',  req, ctx, message); },
  error(req, ctx, message) { write('ERROR', req, ctx, message); },

  // Express middleware: присваивает req.id, ставит заголовок X-Request-Id
  requestId(req, res, next) {
    req.id = crypto.randomUUID().slice(0, 4);
    res.setHeader('X-Request-Id', req.id);
    next();
  },

  // Express middleware: пишет access-строку при завершении запроса
  access(req, res, next) {
    const start = Date.now();
    res.on('finish', () => {
      const pathname = req.path || req.url.split('?')[0];
      if (SKIP_ACCESS.has(pathname)) return;
      const ms = Date.now() - start;
      const size = res.getHeader('Content-Length') || '-';
      const ts = new Date().toISOString();
      const id = req.id || '----';
      const ip = clientIp(req);
      const method = req.method;
      const masked = maskPath(pathname);
      const status = res.statusCode;
      // Формат: 2026-04-27T08:15:23.456Z [a3f1] 91.108.5.4 GET /api/me 200 134b 12ms
      writeLine(`${ts} [${id}] ${ip} ${method} ${masked} ${status} ${size}b ${ms}ms`);
    });
    next();
  }
};

module.exports = { log };
