/**
 * КУДРИ · проверка Telegram Mini App initData.
 * Документация алгоритма: https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */

const crypto = require('crypto');
const { log } = require('./logger');

const BOT_TOKEN = process.env.TG_BOT_TOKEN;
const MAX_AGE_SECONDS = 24 * 60 * 60; // 24 часа

if (!BOT_TOKEN) {
  // Без токена модуль бесполезен — шумим в stderr при импорте, но не падаем:
  // /health должен продолжать работать даже без TG_BOT_TOKEN.
  log.warn(null, '[auth]', 'TG_BOT_TOKEN is not set — Telegram auth will fail');
}

/**
 * Валидирует initData-строку от Telegram Mini App.
 * Возвращает { ok: true, user: <object>, authDate: <number> } при успехе.
 * Возвращает { ok: false, reason: '<string>' } при провале.
 */
function verifyTelegramInitData(initDataStr) {
  if (!BOT_TOKEN) return { ok: false, reason: 'bot_token_not_configured' };
  if (!initDataStr || typeof initDataStr !== 'string') {
    return { ok: false, reason: 'empty_init_data' };
  }

  const params = new URLSearchParams(initDataStr);
  const hash = params.get('hash');
  if (!hash) return { ok: false, reason: 'no_hash' };

  // Собираем data-check-string: все пары кроме hash, отсортированные по ключу
  params.delete('hash');
  const entries = [];
  for (const [key, value] of params.entries()) {
    entries.push(`${key}=${value}`);
  }
  entries.sort();
  const dataCheckString = entries.join('\n');

  // Вычисляем ожидаемый hash
  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(BOT_TOKEN).digest();
  const expected = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  let hashMatch = false;
  try {
    hashMatch = crypto.timingSafeEqual(
      Buffer.from(hash, 'hex'),
      Buffer.from(expected, 'hex')
    );
  } catch {
    return { ok: false, reason: 'hash_format' };
  }
  if (!hashMatch) return { ok: false, reason: 'bad_hash' };

  // Проверяем свежесть
  const authDate = parseInt(params.get('auth_date'), 10);
  if (!authDate || isNaN(authDate)) return { ok: false, reason: 'no_auth_date' };
  const ageSec = Math.floor(Date.now() / 1000) - authDate;
  if (ageSec > MAX_AGE_SECONDS) return { ok: false, reason: 'expired' };
  if (ageSec < -60) return { ok: false, reason: 'future_date' }; // небольшой допуск на рассинхрон часов

  // Парсим user
  const userJson = params.get('user');
  if (!userJson) return { ok: false, reason: 'no_user' };
  let user;
  try {
    user = JSON.parse(userJson);
  } catch {
    return { ok: false, reason: 'bad_user_json' };
  }
  if (!user.id) return { ok: false, reason: 'no_user_id' };

  return { ok: true, user, authDate };
}

module.exports = { verifyTelegramInitData };
