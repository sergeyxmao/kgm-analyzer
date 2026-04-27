/**
 * КУДРИ · AI-роутер. Единая точка вызова AI-провайдеров.
 * Читает активных агентов из БД через ai-agents.listActiveByRole(role),
 * идёт по ним в порядке priority ASC. При ошибках сети, timeout, HTTP 429
 * или HTTP 5xx — переходит к следующему. При HTTP 4xx (кроме 429) —
 * это конфиг-ошибка агента, отдаём её наружу без fallback.
 *
 * Поддерживаемые провайдеры: 'gemini' (Google generateContent),
 * 'openai' (Chat Completions). Endpoint и api_key берутся из БД.
 * Endpoint должен быть полным URL запроса (без подстановок пути).
 */

const agentsService = require('./ai-agents');
const { log } = require('./logger');

const REQUEST_TIMEOUT_MS = 60000;
const MAX_DETAIL_LEN = 500;

/**
 * Главный публичный метод.
 * @param {{ prompt: string, image?: { mime: string, base64: string } }} input
 * @param {string} role — 'analyst' | 'ocr' | 'both'
 * @returns {Promise<string>} — текстовый ответ модели
 */
async function generate(input, role) {
  if (!input || typeof input !== 'object' || typeof input.prompt !== 'string' || input.prompt.length === 0) {
    const e = new Error('bad_input');
    e.code = 'bad_input';
    throw e;
  }

  const agents = agentsService.listActiveByRole(role);
  if (agents.length === 0) {
    const e = new Error('no_active_agents');
    e.code = 'no_active_agents';
    throw e;
  }

  const failures = [];
  for (const agent of agents) {
    try {
      return await callAgent(agent, input);
    } catch (err) {
      log.warn(null, '[ai-router]', `${agent.name} failed: ${err.code}`);
      if (!isRetryable(err)) throw err;
      failures.push({ agent: agent.name, error: err.code });
    }
  }

  log.error(null, '[ai-router]', `all agents failed: ${JSON.stringify(failures)}`);
  const e = new Error('all_agents_failed');
  e.code = 'all_agents_failed';
  e.detail = failures;
  throw e;
}

/**
 * Признак «можно попробовать следующего агента».
 * Retryable: network errors, timeout, HTTP 429, HTTP 5xx.
 * Non-retryable: HTTP 4xx (кроме 429), bad_response, unsupported_provider.
 */
function isRetryable(err) {
  if (err.code === 'network' || err.code === 'timeout') return true;
  if (err.status === 429) return true;
  if (typeof err.status === 'number' && err.status >= 500 && err.status < 600) return true;
  return false;
}

async function callAgent(agent, input) {
  if (agent.provider === 'gemini') return callGemini(agent, input);
  if (agent.provider === 'openai') return callOpenAI(agent, input);
  const e = new Error('unsupported_provider');
  e.code = 'unsupported_provider';
  e.detail = agent.provider;
  throw e;
}

async function callGemini(agent, input) {
  const parts = [{ text: input.prompt }];
  if (input.image) {
    parts.push({ inline_data: { mime_type: input.image.mime, data: input.image.base64 } });
  }

  const body = { contents: [{ parts }] };
  if (agent.params) body.generationConfig = { ...agent.params };

  const url = `${agent.endpoint}?key=${agent.apiKey}`;
  const res = await httpPostJson(url, {}, body);
  const data = await readJson(res);
  const text = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (typeof text !== 'string' || text.length === 0) {
    const e = new Error('bad_response');
    e.code = 'bad_response';
    e.detail = JSON.stringify(data).slice(0, MAX_DETAIL_LEN);
    throw e;
  }
  return text;
}

async function callOpenAI(agent, input) {
  let content;
  if (input.image) {
    content = [
      { type: 'text', text: input.prompt },
      { type: 'image_url', image_url: { url: `data:${input.image.mime};base64,${input.image.base64}` } }
    ];
  } else {
    content = input.prompt;
  }

  const body = { model: agent.model, messages: [{ role: 'user', content }] };
  if (agent.params) Object.assign(body, agent.params);

  const headers = { Authorization: `Bearer ${agent.apiKey}` };
  const res = await httpPostJson(agent.endpoint, headers, body);
  const data = await readJson(res);
  const text = data?.choices?.[0]?.message?.content;
  if (typeof text !== 'string' || text.length === 0) {
    const e = new Error('bad_response');
    e.code = 'bad_response';
    e.detail = JSON.stringify(data).slice(0, MAX_DETAIL_LEN);
    throw e;
  }
  return text;
}

/**
 * POST JSON c таймаутом. При не-2xx бросает err с code='http_<status>' и status=<number>.
 * При сетевой ошибке/таймауте — code='network'/'timeout'.
 */
async function httpPostJson(url, headers, body) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify(body),
      signal: controller.signal
    });
  } catch (err) {
    clearTimeout(timer);
    const isTimeout = err.name === 'AbortError';
    const e = new Error(isTimeout ? 'timeout' : 'network');
    e.code = isTimeout ? 'timeout' : 'network';
    e.detail = err.message;
    throw e;
  }
  clearTimeout(timer);

  if (!res.ok) {
    const text = await res.text().catch(() => '');
    const e = new Error(`http_${res.status}`);
    e.code = `http_${res.status}`;
    e.status = res.status;
    e.detail = text.slice(0, MAX_DETAIL_LEN);
    throw e;
  }
  return res;
}

async function readJson(res) {
  try {
    return await res.json();
  } catch (err) {
    const e = new Error('bad_response');
    e.code = 'bad_response';
    e.detail = err.message;
    throw e;
  }
}

module.exports = { generate };
