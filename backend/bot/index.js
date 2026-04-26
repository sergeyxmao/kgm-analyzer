/**
 * КУДРИ · Telegram-бот.
 * Отвечает на /start приветственным сообщением и кнопкой открытия Mini App.
 * Работает через webhook, монтируется в server.js на путь /telegram/webhook/<secret>.
 *
 * Регистрация webhook (выполняется владельцем вручную после деплоя):
 *   curl "https://api.telegram.org/bot<TOKEN>/setWebhook?url=https://api.elenadortman.store/telegram/webhook/<secret>"
 */

const { Telegraf } = require('telegraf');

const BOT_TOKEN = process.env.TG_BOT_TOKEN;
const WEBHOOK_SECRET = process.env.TG_WEBHOOK_SECRET;
const MINI_APP_URL = 'https://elenadortman.store';

const WELCOME_TEXT = `Привет! Это КУДРИ ✨

Я помогаю девушкам с кудрявыми волосами разбирать составы косметики по принципам кудрявого метода (КГМ).

Просто открой приложение, ответь на пару вопросов про свои волосы — и сможешь сканировать любое средство, чтобы узнать, подходит ли оно тебе.`;

if (!BOT_TOKEN) {
  console.warn('[bot] TG_BOT_TOKEN is not set — bot will not work');
}
if (!WEBHOOK_SECRET) {
  console.warn('[bot] TG_WEBHOOK_SECRET is not set — bot webhook will not be mounted');
}

// placeholder-токен чтобы конструктор не падал при импорте без .env
const bot = new Telegraf(BOT_TOKEN || 'NO_TOKEN');

// Пред-инициализируем botInfo, чтобы telegraf не дёргал getMe() лениво при первом апдейте.
// Иначе любой битый токен в dev-окружении валит процесс необработанным reject из telegraf.
bot.botInfo = { id: 8643110028, is_bot: true, first_name: 'КУДРИ', username: 'kudri_lena_bot' };

// Команда /start — приветствие + кнопка открытия Mini App
bot.command('start', async (ctx) => {
  try {
    await ctx.reply(WELCOME_TEXT, {
      reply_markup: {
        inline_keyboard: [[
          { text: 'Открыть КУДРИ', web_app: { url: MINI_APP_URL } }
        ]]
      }
    });
  } catch (err) {
    console.error('[bot] /start failed:', err.message);
  }
});

// Все прочие апдейты — молчим
bot.on('message', () => { /* silence */ });

function getWebhookHandler() {
  if (!BOT_TOKEN || !WEBHOOK_SECRET) {
    // Конфиг не готов: на bot-путь отдаём 503, остальное пропускаем дальше по цепочке
    return (req, res, next) => {
      if (req.path.startsWith('/telegram/webhook/')) {
        return res.status(503).json({ error: 'bot_not_configured' });
      }
      next();
    };
  }
  return bot.webhookCallback(`/telegram/webhook/${WEBHOOK_SECRET}`);
}

module.exports = { getWebhookHandler };
