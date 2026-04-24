/**
 * КУДРИ · клиент OpenAI-совместимого Chat Completions API.
 * Используется как fallback к Gemini при rate-limit / квоте / сетевых сбоях.
 *
 * Работает с любым провайдером, совместимым с OpenAI Chat Completions:
 * OpenAI, DeepSeek, OpenRouter, Groq и т.п. — задаётся через OPENAI_BASE_URL.
 *
 * Интерфейс generate() принимает такой же parts-массив, как gemini.js,
 * чтобы вызывать оба клиента единообразно из analyze.js.
 */

const API_KEY = process.env.OPENAI_API_KEY;
const MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini';
const BASE_URL = process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
const API_URL = `${BASE_URL}/chat/completions`;
const TIMEOUT_MS = 60000;

function isConfigured() {
  return Boolean(API_KEY);
}

// Конвертирует parts Gemini-формата в content OpenAI-формата.
// text → {type:'text'}, inline_data → {type:'image_url'} с data-URL.
function partsToContent(parts) {
  return parts.map(p => {
    if (p.text) return { type: 'text', text: p.text };
    if (p.inline_data) {
      const { mime_type, data } = p.inline_data;
      return { type: 'image_url', image_url: { url: `data:${mime_type};base64,${data}` } };
    }
    return null;
  }).filter(Boolean);
}

async function generate(parts, opts = {}) {
  if (!API_KEY) throw new Error('openai_key_missing');

  const body = {
    model: MODEL,
    messages: [{ role: 'user', content: partsToContent(parts) }],
    temperature: opts.temperature ?? 0.2,
    max_tokens: opts.maxOutputTokens ?? 2048,
    response_format: { type: 'json_object' }
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);

  let res;
  try {
    res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${API_KEY}`
      },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timer);
    if (err.name === 'AbortError') throw new Error('openai_timeout');
    throw new Error(`openai_network: ${err.message}`);
  }
  clearTimeout(timer);

  if (!res.ok) {
    const text = await res.text();
    const e = new Error(`openai_http_${res.status}`);
    e.status = res.status;
    e.detail = text.slice(0, 500);
    throw e;
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content;
  if (!text) throw new Error('openai_empty_response');
  return text;
}

module.exports = { generate, isConfigured, MODEL };
