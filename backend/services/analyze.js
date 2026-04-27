/**
 * КУДРИ · оркестрация анализа INCI.
 * Строит промпт с учётом профиля пользователя, вызывает AI через роутер, парсит результат.
 */

const aiRouter = require('./ai-router');
const { getProfileByUserId } = require('./profiles');

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
3. Если на фото видна упаковка с надписями — извлеки название бренда (производителя) и точное название товара.
4. Оцени по принципам КГМ для ИМЕННО этого профиля
5. Верни СТРОГО JSON в таком формате (без markdown, без \`\`\`):

{
  "verdict": "good" | "warn" | "bad",
  "verdictTitle": "Подходит" | "С оговорками" | "Не подходит",
  "productType": "тип средства",
  "brand": "название бренда или null если не видно",
  "productName": "название товара или null если не видно",
  "brandConfidence": "high" | "medium" | "low",
  "summary": "1-2 предложения почему",
  "ingredients": [
    {"name": "название ингредиента", "status": "good"|"warn"|"bad", "note": "роль и почему такая оценка для ЭТОГО профиля"}
  ]
}

Правила для brand / productName / brandConfidence:
- "high" — бренд и название чётко читаются и узнаваемы.
- "medium" — только частично читаются или неясно где бренд а где название.
- "low" — на фото нет упаковки, нет читаемого текста, или только состав.
- Если ввод текстовый (без фото) — brand и productName всегда null, brandConfidence не указывай.

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

/**
 * Анализирует INCI.
 * @returns { ok: true, result: <parsed JSON from AI> }
 * @returns { ok: false, error: '<code>', detail?: string }
 */
async function analyzeInci(userId, input) {
  const v = validateInput(input);
  if (v.error) return { ok: false, error: v.error };

  const profile = getProfileByUserId(userId);
  const prompt = buildPrompt(profile);

  const routerInput = { prompt };
  if (input.type === 'image') {
    let mime = 'image/jpeg';
    let base64 = input.data;
    const m = input.data.match(/^data:([^;]+);base64,(.+)$/);
    if (m) { mime = m[1]; base64 = m[2]; }
    routerInput.image = { mime, base64 };
  } else {
    routerInput.prompt = prompt + '\n\nСОСТАВ:\n' + input.data;
  }

  let text;
  try {
    text = await aiRouter.generate(routerInput, 'analyst');
  } catch (err) {
    return { ok: false, error: err.code || err.message, detail: err.detail };
  }

  try {
    const result = JSON.parse(text);
    if (!result.verdict || !result.verdictTitle) {
      return { ok: false, error: 'bad_ai_response' };
    }
    if (input.type === 'image') {
      if (result.brand !== undefined && result.brand !== null && typeof result.brand !== 'string') {
        result.brand = null;
      }
      if (result.productName !== undefined && result.productName !== null && typeof result.productName !== 'string') {
        result.productName = null;
      }
      if (result.brandConfidence && !['high', 'medium', 'low'].includes(result.brandConfidence)) {
        delete result.brandConfidence;
      }
    } else {
      result.brand = null;
      result.productName = null;
      delete result.brandConfidence;
    }
    return { ok: true, result };
  } catch {
    return { ok: false, error: 'bad_ai_json' };
  }
}

module.exports = { analyzeInci, buildAnalystPrompt: buildPrompt };
