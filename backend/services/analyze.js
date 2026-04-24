/**
 * КУДРИ · оркестрация анализа INCI.
 * Строит промпт с учётом профиля пользователя, вызывает Gemini, парсит результат.
 */

const gemini = require('./gemini');
const openai = require('./openai');
const { getProfileByUserId } = require('./profiles');

// Gemini-ошибки, при которых имеет смысл переключиться на OpenAI:
// квоты, rate-limit, сетевые сбои, overloaded. НЕ fallback'им на 400 (наша ошибка)
// и не fallback'им, если сам ответ Gemini невалидный — проблема в промпте, а не в провайдере.
function shouldFallback(err) {
  const msg = err.message || '';
  if (msg === 'gemini_key_missing') return true;
  if (msg === 'gemini_timeout') return true;
  if (msg.startsWith('gemini_network:')) return true;
  if (msg === 'gemini_empty_response') return true;
  if (msg.startsWith('gemini_http_')) {
    const code = parseInt(msg.slice('gemini_http_'.length), 10);
    return code === 429 || code === 403 || code >= 500;
  }
  return false;
}

const GOAL_LABELS = {
  hydration: 'увлажнение', nutrition: 'питание', growth: 'рост',
  volume: 'объём', definition: 'дефиниция', frizz: 'антипушение',
  shine: 'блеск', repair: 'восстановление', color: 'защита цвета', scalp: 'кожа головы'
};

function buildPrompt(profile) {
  const p = profile || {};
  const goalsTxt = (p.goals || []).map(g => GOAL_LABELS[g]).filter(Boolean).join(', ');

  return `Ты эксперт по КГМ (кудрявому методу) и анализу косметических составов INCI.

ПРОФИЛЬ ВОЛОС:
- Тип кудрей: ${p.curlType || '—'}
- Пористость: ${p.porosity || '—'}
- Толщина: ${p.thickness || '—'}
- Кожа головы: ${p.scalp || '—'}
- Цели: ${goalsTxt || '—'}

ЗАДАЧА:
1. Прочитай INCI-состав (с фото или текста)
2. Определи тип средства (шампунь, кондиционер, маска, гель, несмывашка...)
3. Оцени по принципам КГМ для ИМЕННО этого профиля
4. Верни СТРОГО JSON в таком формате (без markdown, без \`\`\`):

{
  "verdict": "good" | "warn" | "bad",
  "verdictTitle": "Подходит" | "С оговорками" | "Не подходит",
  "productType": "тип средства",
  "summary": "1-2 предложения почему",
  "ingredients": [
    {"name": "название ингредиента", "status": "good"|"warn"|"bad", "note": "роль и почему такая оценка для ЭТОГО профиля"}
  ]
}

Анализируй ТОЛЬКО ключевые ингредиенты (5-10 самых важных). Будь конкретна с учётом профиля. Если силикон — для каких пористостей это норм а для каких нет. Если сульфат — стоит ли его этому типу головы.`;
}

/**
 * Валидирует вход.
 * Принимает { type: 'text'|'image', data: string }.
 * Для image data — dataURL (data:image/...;base64,...) ИЛИ чистый base64.
 */
function validateInput(input) {
  if (!input || typeof input !== 'object') return { error: 'bad_input' };
  if (input.type !== 'text' && input.type !== 'image') return { error: 'bad_type' };
  if (typeof input.data !== 'string' || input.data.length === 0) return { error: 'empty_data' };

  if (input.type === 'text') {
    if (input.data.length > 8000) return { error: 'text_too_long' };
  } else {
    // image: проверяем размер base64 (грубо — *3/4 == реальный размер)
    // ограничение 6 МБ на сырой payload — под запас при base64-обёртке
    if (input.data.length > 8 * 1024 * 1024) return { error: 'image_too_large' };
  }
  return { ok: true };
}

function buildParts(prompt, input) {
  const parts = [{ text: prompt }];
  if (input.type === 'image') {
    let mime = 'image/jpeg';
    let base64 = input.data;
    const m = input.data.match(/^data:([^;]+);base64,(.+)$/);
    if (m) { mime = m[1]; base64 = m[2]; }
    parts.push({ inline_data: { mime_type: mime, data: base64 } });
  } else {
    parts.push({ text: 'СОСТАВ:\n' + input.data });
  }
  return parts;
}

/**
 * Анализирует INCI.
 * @returns { ok: true, result: <parsed JSON from Gemini> }
 * @returns { ok: false, error: '<code>', detail?: string }
 */
async function analyzeInci(userId, input) {
  const v = validateInput(input);
  if (v.error) return { ok: false, error: v.error };

  const profile = getProfileByUserId(userId);
  const prompt = buildPrompt(profile);
  const parts = buildParts(prompt, input);

  let text;
  let provider = 'gemini';
  try {
    text = await gemini.generate(parts, { temperature: 0.2, maxOutputTokens: 2048 });
  } catch (primaryErr) {
    if (openai.isConfigured() && shouldFallback(primaryErr)) {
      console.warn(`[analyze] gemini failed (${primaryErr.message}), falling back to openai`);
      try {
        text = await openai.generate(parts, { temperature: 0.2, maxOutputTokens: 2048 });
        provider = 'openai';
      } catch (fallbackErr) {
        console.error(`[analyze] openai fallback also failed: ${fallbackErr.message}`);
        return {
          ok: false,
          error: fallbackErr.message,
          detail: fallbackErr.detail,
          primaryError: primaryErr.message
        };
      }
    } else {
      return { ok: false, error: primaryErr.message, detail: primaryErr.detail };
    }
  }

  try {
    const result = JSON.parse(text);
    if (!result.verdict || !result.verdictTitle) {
      return { ok: false, error: 'bad_ai_response', provider };
    }
    return { ok: true, result, provider };
  } catch {
    return { ok: false, error: 'bad_ai_json', provider };
  }
}

module.exports = { analyzeInci };
