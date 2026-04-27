/**
 * КУДРИ · server-side рендер публичной страницы шеринга скана.
 * Без шаблонизатора — простой template literal + escape().
 * Стилистика — pastel premium, аналог frontend/index.html.
 */

const BOT_URL = 'https://t.me/kudri_lena_bot';

const VERDICT_LABEL = { good: 'Подходит', warn: 'С оговорками', bad: 'Не подходит' };
const VERDICT_ICON  = { good: '✓',        warn: '!',            bad: '✕'           };

const CURL_LABELS = {
  '2A': '2A', '2B': '2B', '2C': '2C',
  '3A': '3A', '3B': '3B', '3C': '3C',
  '4': '4'
};
const POROSITY_LABELS = {
  low: 'низкая пористость',
  medium: 'средняя пористость',
  high: 'высокая пористость',
  unknown: 'пористость не определена'
};
const THICKNESS_LABELS = {
  thin: 'тонкие',
  medium: 'средние',
  thick: 'толстые'
};
const SCALP_LABELS = {
  oily: 'жирная кожа головы',
  normal: 'нормальная кожа головы',
  dry: 'сухая кожа головы',
  sensitive: 'чувствительная кожа головы',
  mixed: 'смешанная кожа головы'
};
const GOAL_LABELS = {
  hydration: 'увлажнение',
  nutrition: 'питание',
  growth: 'рост',
  volume: 'объём',
  definition: 'дефиниция',
  frizz: 'антипушение',
  shine: 'блеск',
  repair: 'восстановление',
  color: 'защита цвета',
  scalp: 'кожа головы'
};

function formatScanTitle(scan) {
  const brand = (scan.brand || '').trim();
  const name = (scan.productName || scan.product_name || '').trim();
  if (brand && name) return `${brand} · ${name}`;
  if (brand) return brand;
  if (name) return name;
  return 'Бренд не определён';
}

function escape(s) {
  if (s === null || s === undefined) return '';
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function describeProfile(snap) {
  if (!snap) return null;
  const parts = [];
  if (snap.curlType) parts.push(`тип ${CURL_LABELS[snap.curlType] || snap.curlType}`);
  if (snap.porosity && POROSITY_LABELS[snap.porosity]) parts.push(POROSITY_LABELS[snap.porosity]);
  if (snap.thickness && THICKNESS_LABELS[snap.thickness]) parts.push(`волосы ${THICKNESS_LABELS[snap.thickness]}`);
  if (snap.scalp && SCALP_LABELS[snap.scalp]) parts.push(SCALP_LABELS[snap.scalp]);
  if (snap.goals && snap.goals.length) {
    const goals = snap.goals.map(g => GOAL_LABELS[g]).filter(Boolean).join(', ');
    if (goals) parts.push(`цели: ${goals}`);
  }
  return parts.length ? 'анализ для ' + parts.join(' · ') : null;
}

function renderIngredients(ingredients) {
  if (!Array.isArray(ingredients) || ingredients.length === 0) return '';
  const items = ingredients.map(ing => {
    const status = ['good', 'warn', 'bad'].includes(ing?.status) ? ing.status : 'warn';
    return `
      <div class="ingredient-item">
        <span class="ingredient-dot ${status}"></span>
        <div class="ingredient-content">
          <div class="ingredient-name">${escape(ing?.name || '')}</div>
          ${ing?.note ? `<div class="ingredient-note">${escape(ing.note)}</div>` : ''}
        </div>
      </div>
    `;
  }).join('');
  return `<div class="ingredient-list">${items}</div>`;
}

const BASE_STYLES = `
  *{margin:0;padding:0;box-sizing:border-box;-webkit-tap-highlight-color:transparent}
  :root{
    --peach-100:#FFE8DC;--peach-200:#FFD4BD;
    --rose-300:#FF8FA3;--rose-400:#E85A75;
    --terracotta:#C8593A;--terracotta-soft:#E8A491;
    --cream:#FDFAF6;--bone:#F5EFE7;--sand:#E8DDD0;
    --ink:#2A1F1A;--ink-soft:#5C4A40;--ink-mute:#9B8B82;
    --green:#6B8E5A;--green-soft:#DCE7D0;
    --danger:#C8553D;--danger-soft:#F4DACE;
    --warning:#D4923D;--warning-soft:#F8E5C8;
    --r-sm:12px;--r-md:18px;--r-lg:24px;--r-pill:999px;
    --shadow-md:0 8px 24px rgba(232,90,117,0.10),0 2px 6px rgba(42,31,26,0.06);
    --font-display:'Fraunces',Georgia,serif;
    --font-body:'Inter',-apple-system,sans-serif;
  }
  html,body{font-family:var(--font-body);font-size:15px;line-height:1.55;color:var(--ink);background:var(--cream);min-height:100vh}
  body{background:radial-gradient(ellipse 800px 600px at 50% -200px,var(--peach-100) 0%,transparent 60%),var(--cream);padding:0 0 40px}
  .wrap{max-width:480px;margin:0 auto;padding:20px 16px}
  .topbar{display:flex;align-items:center;justify-content:space-between;padding:8px 4px 20px}
  .logo{font-family:var(--font-display);font-size:22px;font-weight:500;letter-spacing:-0.5px;color:var(--ink)}
  .logo em{font-style:italic;color:var(--terracotta)}
  .photo-wrap{border-radius:var(--r-lg);overflow:hidden;margin-bottom:16px;box-shadow:var(--shadow-md);background:var(--bone);aspect-ratio:4/3;display:grid;place-items:center}
  .photo-wrap img{width:100%;height:100%;object-fit:cover;display:block}
  .verdict-card{background:white;border-radius:var(--r-lg);padding:24px;margin-bottom:16px;box-shadow:var(--shadow-md);position:relative;overflow:hidden}
  .verdict-card::before{content:'';position:absolute;top:0;left:0;right:0;height:4px}
  .verdict-card.good::before{background:linear-gradient(90deg,var(--green),var(--green-soft))}
  .verdict-card.warn::before{background:linear-gradient(90deg,var(--warning),var(--warning-soft))}
  .verdict-card.bad::before{background:linear-gradient(90deg,var(--danger),var(--terracotta-soft))}
  .verdict-head{display:flex;align-items:center;gap:12px;margin-bottom:14px}
  .verdict-icon{width:44px;height:44px;border-radius:50%;display:grid;place-items:center;font-size:22px;flex-shrink:0;font-weight:600}
  .verdict-card.good .verdict-icon{background:var(--green-soft);color:var(--green)}
  .verdict-card.warn .verdict-icon{background:var(--warning-soft);color:var(--warning)}
  .verdict-card.bad .verdict-icon{background:var(--danger-soft);color:var(--danger)}
  .verdict-status{font-family:var(--font-display);font-size:22px;font-weight:500;letter-spacing:-0.3px;margin-bottom:2px}
  .verdict-meta{font-size:12px;color:var(--ink-mute)}
  .verdict-summary{font-size:14px;line-height:1.55;color:var(--ink-soft);margin-top:8px;margin-bottom:16px}
  .profile-line{font-size:12px;color:var(--ink-mute);font-style:italic;margin-bottom:16px;padding:10px 12px;background:var(--bone);border-radius:var(--r-sm)}
  .ingredient-list{display:grid;gap:8px}
  .ingredient-item{display:flex;align-items:flex-start;gap:10px;padding:10px 12px;background:var(--cream);border-radius:var(--r-sm)}
  .ingredient-dot{width:8px;height:8px;border-radius:50%;margin-top:6px;flex-shrink:0}
  .ingredient-dot.good{background:var(--green)}
  .ingredient-dot.warn{background:var(--warning)}
  .ingredient-dot.bad{background:var(--danger)}
  .ingredient-content{flex:1;min-width:0}
  .ingredient-name{font-weight:600;font-size:13px;margin-bottom:2px}
  .ingredient-note{font-size:12px;color:var(--ink-mute);line-height:1.4}
  .cta{display:block;margin-top:24px;padding:16px 20px;background:var(--terracotta);color:white;text-align:center;text-decoration:none;border-radius:var(--r-pill);font-weight:600;font-size:15px;box-shadow:var(--shadow-md)}
  .cta:active{transform:scale(0.98)}
  .footer{text-align:center;font-size:11px;color:var(--ink-mute);margin-top:24px;padding:0 16px}
  .empty-card{background:white;border-radius:var(--r-lg);padding:40px 24px;text-align:center;box-shadow:var(--shadow-md)}
  .empty-emoji{font-size:48px;margin-bottom:12px}
  .empty-title{font-family:var(--font-display);font-size:22px;margin-bottom:8px}
  .empty-text{font-size:14px;color:var(--ink-mute);margin-bottom:20px}
`;

const HEAD_FONTS = `
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
  <link href="https://fonts.googleapis.com/css2?family=Fraunces:ital,opsz,wght@0,9..144,400;0,9..144,500;0,9..144,600;1,9..144,400&family=Inter:wght@400;500;600&display=swap" rel="stylesheet">
`;

function renderSharePage(scan) {
  const verdict = ['good', 'warn', 'bad'].includes(scan.verdict) ? scan.verdict : 'warn';
  const verdictLabel = scan.verdictTitle || VERDICT_LABEL[verdict];
  const title = formatScanTitle(scan);
  const productType = scan.productType || '';
  const summary = scan.summary || '';
  const photoUrl = scan.photoUrl || '';
  const profileLine = describeProfile(scan.profileSnapshot);

  const ogTitle = `${verdictLabel} · ${title}`;
  const ogDesc = summary || 'Анализ INCI для кудрявых волос — КУДРИ';

  const ogImageMeta = photoUrl
    ? `<meta property="og:image" content="${escape(photoUrl)}">`
    : '';

  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,viewport-fit=cover">
<meta name="theme-color" content="#FFE8DC">
<title>${escape(title)} · КУДРИ</title>
<meta name="description" content="${escape(ogDesc)}">
<meta property="og:title" content="${escape(ogTitle)}">
<meta property="og:description" content="${escape(ogDesc)}">
<meta property="og:type" content="article">
${ogImageMeta}
${HEAD_FONTS}
<style>${BASE_STYLES}</style>
</head>
<body>
  <div class="wrap">
    <div class="topbar">
      <div class="logo">КУ<em>ДРИ</em></div>
    </div>

    ${photoUrl ? `<div class="photo-wrap"><img src="${escape(photoUrl)}" alt=""></div>` : ''}

    <div class="verdict-card ${verdict}">
      <div class="verdict-head">
        <div class="verdict-icon">${VERDICT_ICON[verdict]}</div>
        <div>
          <div class="verdict-status">${escape(verdictLabel)}</div>
          <div class="verdict-meta">${escape(title)}${productType ? ` · ${escape(productType)}` : ''}</div>
        </div>
      </div>
      ${summary ? `<div class="verdict-summary">${escape(summary)}</div>` : ''}
      ${profileLine ? `<div class="profile-line">${escape(profileLine)}</div>` : ''}
      ${renderIngredients(scan.ingredients)}
    </div>

    <a class="cta" href="${BOT_URL}">Открыть КУДРИ</a>

    <div class="footer">КУДРИ · анализ INCI для кудрявых волос</div>
  </div>
</body>
</html>`;
}

function renderNotFoundPage() {
  return `<!DOCTYPE html>
<html lang="ru">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,viewport-fit=cover">
<meta name="theme-color" content="#FFE8DC">
<title>Ссылка не найдена · КУДРИ</title>
${HEAD_FONTS}
<style>${BASE_STYLES}</style>
</head>
<body>
  <div class="wrap">
    <div class="topbar">
      <div class="logo">КУ<em>ДРИ</em></div>
    </div>
    <div class="empty-card">
      <div class="empty-emoji">🔗</div>
      <div class="empty-title">Ссылка не найдена</div>
      <div class="empty-text">Возможно, она была отозвана или никогда не существовала.</div>
      <a class="cta" href="${BOT_URL}">Открыть КУДРИ</a>
    </div>
    <div class="footer">КУДРИ · анализ INCI для кудрявых волос</div>
  </div>
</body>
</html>`;
}

module.exports = { renderSharePage, renderNotFoundPage };
