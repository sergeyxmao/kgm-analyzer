/**
 * КУДРИ · клиент Google Gemini.
 * Минимальная обёртка над generateContent API.
 * Модель и ключ — из .env.
 */

const API_KEY = process.env.GEMINI_API_KEY;
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`;
const TIMEOUT_MS = 60000;

if (!API_KEY) {
  console.warn('[gemini] GEMINI_API_KEY is not set — /api/analyze will fail');
}

/**
 * Вызывает Gemini generateContent с заданными parts.
 * @param {Array} parts — массив parts (text / inline_data) по формату Google API
 * @param {object} [opts] — temperature, maxOutputTokens
 * @returns {Promise<string>} — текстовый ответ модели (без JSON.parse)
 */
async function generate(parts, opts = {}) {
  if (!API_KEY) throw new Error('gemini_key_missing');

  const body = {
    contents: [{ parts }],
    generationConfig: {
      temperature: opts.temperature ?? 0.2,
      maxOutputTokens: opts.maxOutputTokens ?? 2048,
      responseMimeType: 'application/json'
    }
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res;
  try {
    res = await fetch(`${API_URL}?key=${API_KEY}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error('gemini_timeout');
    throw new Error(`gemini_network: ${err.message}`);
  }
  clearTimeout(timer);

  if (!res.ok) {
    const text = await res.text();
    const e = new Error(`gemini_http_${res.status}`);
    e.status = res.status;
    e.detail = text.slice(0, 500);
    throw e;
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!text) throw new Error('gemini_empty_response');
  return text;
}

module.exports = { generate, MODEL };
