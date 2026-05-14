import fs from 'fs';
import { scoreFindings, getPrimaryDiseaseArea, DISEASE_AREAS, DISEASE_AREA_META, isStaleContent, AND_MODE } from './keywords.js';

function cleanSummary(raw) {
  return (raw ?? '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/#{1,6}\s*/g, '')
    .replace(/\*{1,2}([^*]+)\*{1,2}/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function toISODate(raw) {
  if (!raw) return '';
  if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
  const d = new Date(raw);
  return isNaN(d) ? '' : d.toISOString().slice(0, 10);
}

const resultsDir = 'results';
const files = fs.readdirSync(resultsDir)
  .filter(f => f.startsWith('data_') && f.endsWith('.json'))
  .sort();

// Merge all findings, deduplicate by source_link
const seen = new Set();
const allFindings = [];

for (const file of files) {
  const raw = JSON.parse(fs.readFileSync(`${resultsDir}/${file}`, 'utf8'));
  const findings = raw?.data?.findings ?? [];
  for (const f of findings) {
    if (!f.source_link || seen.has(f.source_link)) continue;
    seen.add(f.source_link);
    const nullish = v => !v || ['n/a', 'none', 'null', 'unknown', '—', '-'].includes(v.toLowerCase().trim());
    const rawCompetitors = Array.isArray(f.competitors) ? f.competitors : f.competitor ? [f.competitor] : [];
    const rawKeywords    = Array.isArray(f.keywords)    ? f.keywords    : f.keyword    ? [f.keyword]    : [];
    const cleanCompetitors = rawCompetitors.filter(c => c && !nullish(c));
    const cleanKeywords    = rawKeywords.filter(k => k && !nullish(k));

    const normalized = {
      ...f,
      competitors: cleanCompetitors.length ? cleanCompetitors : ['Keyword matched'],
      keywords: cleanKeywords,
      publication_date: toISODate(f.publication_date),
    };
    const withCleanSummary = { ...normalized, summary: cleanSummary(normalized.summary) };
    if (isStaleContent(withCleanSummary)) continue;
    if (AND_MODE && (withCleanSummary.competitors[0] === 'Keyword matched' || !withCleanSummary.keywords.length)) continue;
    allFindings.push({ ...withCleanSummary, confidence: f.confidence ?? scoreFindings(withCleanSummary), disease_area: f.disease_area ?? getPrimaryDiseaseArea(withCleanSummary.keywords) });
  }
}

console.log(`Loaded ${files.length} run files — ${allFindings.length} unique findings total.`);

// Sort newest first
allFindings.sort((a, b) => {
  const da = a.publication_date ? new Date(a.publication_date) : new Date(0);
  const db = b.publication_date ? new Date(b.publication_date) : new Date(0);
  return db - da;
});

const runDate = new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' });
const allCompetitors = [...new Set(allFindings.flatMap(f => f.competitors).filter(c => c && c !== 'Keyword matched'))].sort();
const allKeywords = [...new Set(allFindings.flatMap(f => f.keywords).filter(Boolean))].sort();
const allSourceTypes = [...new Set(allFindings.map(f => f.source_type).filter(Boolean))].sort();

const dates = allFindings.map(f => f.publication_date).filter(Boolean).sort();
const minDate = dates[0]?.slice(0, 10) ?? '';
const maxDate = dates[dates.length - 1]?.slice(0, 10) ?? '';

const badgeColor = (type) => {
  const map = {
    'SEC 8-K': '#dc2626', 'Press Release': '#2563eb', 'PubMed': '#16a34a',
    'Clinical Trial': '#9333ea', 'Conference': '#ea580c', 'News': '#0891b2',
  };
  for (const [k, v] of Object.entries(map)) {
    if (type?.toLowerCase().includes(k.toLowerCase())) return v;
  }
  return '#6b7280';
};

const confColor = s => s >= 70 ? '#16a34a' : s >= 45 ? '#d97706' : '#dc2626';
const confLabel = s => s >= 70 ? 'High' : s >= 45 ? 'Medium' : 'Low';

const makeCard = (f) => {
  const score = f.confidence ?? 0;
  const area = f.disease_area ?? 'Other';
  return `
  <div class="card"
    data-competitors="${(f.competitors ?? []).join('|').toLowerCase()}"
    data-keywords="${(f.keywords ?? []).join('|').toLowerCase()}"
    data-source="${f.source_type ?? ''}"
    data-date="${f.publication_date?.slice(0, 10) ?? ''}"
    data-confidence="${score}"
    data-area="${area}">
    <div class="card-header">
      <span class="badge" style="background:${badgeColor(f.source_type)}">${f.source_type || 'Unknown'}</span>
      ${(f.competitors ?? []).map(c => `<span class="competitor-tag">${c}</span>`).join('')}
      ${(f.keywords ?? []).map(k => `<span class="keyword-tag">${k}</span>`).join('')}
      <span class="confidence-badge" style="background:${confColor(score)}1a;color:${confColor(score)};border:1px solid ${confColor(score)}40" title="Confidence: ${score}/100">${confLabel(score)} · ${score}</span>
    </div>
    <p class="summary">${f.summary || 'No summary available.'}</p>
    ${f.source_link ? `<a class="source-link" href="${f.source_link}" target="_blank" rel="noopener">View Source →</a>` : ''}
    <div class="card-domain">${f.publication_date ? `📅 ${new Date(f.publication_date).toLocaleDateString('en-CA')} · ` : ''}${f.source_domain || ''}</div>
  </div>`;
};

const grouped = Object.fromEntries(DISEASE_AREAS.map(a => [a, []]));
allFindings.forEach(f => grouped[f.disease_area ?? 'Other'].push(f));

const findingSections = DISEASE_AREAS.map(area => {
  const areaFindings = grouped[area];
  if (areaFindings.length === 0) return '';
  const meta = DISEASE_AREA_META[area];
  return `
  <div class="disease-section" data-area="${area}">
    <div class="section-header">
      <span class="section-dot" style="background:${meta.color}"></span>
      <span class="section-title">${meta.label}</span>
      <span class="section-count">${areaFindings.length}</span>
    </div>
    <div class="grid section-grid">
      ${areaFindings.map(makeCard).join('')}
    </div>
  </div>`;
}).join('');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Zura Bio — Historical Intelligence</title>
<style>
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #f8fafc; color: #1e293b; }
  header { background: #0f172a; color: white; padding: 24px 40px; display: flex; justify-content: space-between; align-items: center; }
  header h1 { font-size: 1.4rem; font-weight: 700; letter-spacing: -0.02em; }
  header .meta { font-size: 0.8rem; color: #94a3b8; }
  .container { max-width: 1400px; margin: 0 auto; padding: 32px 24px; }
  .stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(160px, 1fr)); gap: 16px; margin-bottom: 32px; }
  .stat { background: white; border-radius: 12px; padding: 18px 22px; border: 1px solid #e2e8f0; }
  .stat .num { font-size: 1.8rem; font-weight: 800; color: #0f172a; }
  .stat .label { font-size: 0.75rem; color: #64748b; margin-top: 4px; text-transform: uppercase; letter-spacing: 0.05em; }
  .layout { display: grid; grid-template-columns: 280px 1fr; gap: 24px; }
  .sidebar { position: sticky; top: 24px; height: fit-content; }
  .mobile-filter-toggle { display: none; width: 100%; padding: 10px 16px; background: #0f172a; color: white; border: none; border-radius: 8px; font-size: 0.875rem; font-weight: 600; cursor: pointer; margin-bottom: 16px; align-items: center; justify-content: center; gap: 8px; }
  @media (max-width: 900px) {
    .layout { grid-template-columns: 1fr; }
    .sidebar { display: none; position: static; }
    .sidebar.open { display: block; }
    .mobile-filter-toggle { display: flex; }
  }
  .panel { background: white; border-radius: 12px; border: 1px solid #e2e8f0; padding: 20px; margin-bottom: 16px; }
  .panel h3 { font-size: 0.82rem; font-weight: 700; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; margin-bottom: 12px; }
  .date-row { display: flex; gap: 8px; align-items: center; margin-bottom: 8px; }
  .date-row label { font-size: 0.75rem; color: #64748b; white-space: nowrap; width: 28px; flex-shrink: 0; }
  .preset-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 6px; margin-bottom: 12px; }
  .preset-btn { padding: 6px 4px; border: 1px solid #e2e8f0; border-radius: 8px; background: #f8fafc; color: #475569; font-size: 0.75rem; font-weight: 600; cursor: pointer; text-align: center; transition: all 0.15s; }
  .preset-btn:hover { background: #f1f5f9; border-color: #6366f1; color: #6366f1; }
  .preset-btn.active { background: #6366f1; border-color: #6366f1; color: white; }
  .divider { font-size: 0.72rem; color: #94a3b8; text-align: center; margin: 8px 0; }
  select, input[type=text], input[type=date] { width: 100%; padding: 8px 10px; border: 1px solid #e2e8f0; border-radius: 8px; font-size: 0.855rem; color: #1e293b; background: #f8fafc; margin-bottom: 10px; }
  .date-row input[type=date] { margin-bottom: 0; }
  button.reset-btn { width: 100%; padding: 9px; border: none; border-radius: 8px; background: #0f172a; color: white; font-size: 0.875rem; font-weight: 600; cursor: pointer; margin-top: 4px; }
  button.reset-btn:hover { background: #1e293b; }
  .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(340px, 1fr)); gap: 16px; }
  .card { background: white; border-radius: 12px; border: 1px solid #e2e8f0; padding: 18px 20px; transition: box-shadow 0.2s; }
  .card:hover { box-shadow: 0 4px 16px rgba(0,0,0,0.08); }
  .card-header { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-bottom: 12px; }
  .badge { font-size: 0.7rem; font-weight: 700; color: white; padding: 3px 9px; border-radius: 100px; text-transform: uppercase; letter-spacing: 0.04em; }
  .competitor-tag { font-size: 0.78rem; font-weight: 700; color: #0f172a; background: #f1f5f9; padding: 3px 9px; border-radius: 100px; }
  .keyword-tag { font-size: 0.75rem; color: #7c3aed; background: #ede9fe; padding: 3px 9px; border-radius: 100px; }
  .summary { font-size: 0.875rem; color: #334155; line-height: 1.6; margin-bottom: 12px; }
  .source-link { font-size: 0.8rem; color: #2563eb; text-decoration: none; font-weight: 500; }
  .source-link:hover { text-decoration: underline; }
  .card-domain { font-size: 0.72rem; color: #94a3b8; margin-top: 6px; }
  .confidence-badge { font-size: 0.7rem; font-weight: 700; padding: 3px 9px; border-radius: 100px; white-space: nowrap; margin-left: auto; }
  .hidden { display: none !important; }
  #results-count { font-size: 0.85rem; color: #64748b; margin-bottom: 16px; }
  .no-results { text-align: center; padding: 60px; color: #94a3b8; font-size: 0.95rem; grid-column: 1/-1; }
  .help-icon { display: inline-flex; align-items: center; justify-content: center; width: 15px; height: 15px; border-radius: 50%; background: #94a3b8; color: white; font-size: 0.6rem; font-weight: 700; cursor: help; position: relative; margin-left: 5px; vertical-align: middle; }
  .help-icon .tooltip { display: none; position: absolute; left: 20px; top: -8px; width: 220px; background: #0f172a; color: #e2e8f0; font-size: 0.72rem; font-weight: 400; line-height: 1.6; padding: 10px 12px; border-radius: 8px; z-index: 100; white-space: normal; box-shadow: 0 4px 16px rgba(0,0,0,0.2); }
  .help-icon:hover .tooltip { display: block; }
  .help-icon .tooltip b { color: #ffffff; }
  .help-icon .tooltip hr { border: none; border-top: 1px solid #334155; margin: 6px 0; }
  .disease-section { margin-bottom: 32px; }
  .section-header { display: flex; align-items: center; gap: 10px; margin-bottom: 14px; padding-bottom: 10px; border-bottom: 2px solid #e2e8f0; }
  .section-dot { width: 12px; height: 12px; border-radius: 50%; flex-shrink: 0; }
  .section-title { font-size: 1rem; font-weight: 700; color: #0f172a; }
  .section-count { background: #f1f5f9; color: #64748b; font-size: 0.75rem; font-weight: 700; padding: 2px 8px; border-radius: 100px; }
</style>
</head>
<body>
<header>
  <h1>Zura Bio — Historical Intelligence</h1>
  <div class="meta">Generated ${runDate} &nbsp;|&nbsp; ${files.length} runs &nbsp;|&nbsp; ${allFindings.length} unique findings</div>
</header>
<div class="container">
  <div class="stats">
    <div class="stat"><div class="num" id="s-total">${allFindings.length}</div><div class="label">Total Findings</div></div>
    <div class="stat"><div class="num">${files.length}</div><div class="label">Runs Loaded</div></div>
    <div class="stat"><div class="num">${allCompetitors.length}</div><div class="label">Competitors</div></div>
    <div class="stat"><div class="num">${allKeywords.length}</div><div class="label">Keywords</div></div>
    <div class="stat"><div class="num" id="s-visible">${allFindings.length}</div><div class="label">Showing</div></div>
  </div>
  <button class="mobile-filter-toggle" onclick="toggleFilters()" id="filter-toggle-btn">&#9776; Show Filters</button>
  <div class="layout">
    <div class="sidebar" id="sidebar">
      <div class="panel">
        <h3>Date Range</h3>
        <div class="preset-grid">
          <button class="preset-btn" onclick="setPreset('today')">Today</button>
          <button class="preset-btn" onclick="setPreset('yesterday')">Yesterday</button>
          <button class="preset-btn" onclick="setPreset('7d')">Last 7 days</button>
          <button class="preset-btn" onclick="setPreset('30d')">Last 30 days</button>
          <button class="preset-btn" onclick="setPreset('mtd')">This month</button>
          <button class="preset-btn active" onclick="setPreset('all')">All time</button>
        </div>
        <div class="divider">— or set custom range —</div>
        <div class="date-row">
          <label>From</label>
          <input type="date" id="date-from" min="${minDate}" max="${maxDate}">
        </div>
        <div class="date-row">
          <label>To</label>
          <input type="date" id="date-to" min="${minDate}" max="${maxDate}">
        </div>
      </div>
      <div class="panel">
        <h3>Filter</h3>
        <select id="filter-competitor">
          <option value="">All Competitors</option>
          ${allCompetitors.map(c => `<option value="${c.toLowerCase()}">${c}</option>`).join('')}
        </select>
        <select id="filter-keyword">
          <option value="">All Keywords</option>
          ${allKeywords.map(k => `<option value="${k.toLowerCase()}">${k}</option>`).join('')}
        </select>
        <select id="filter-source">
          <option value="">All Source Types</option>
          ${allSourceTypes.map(s => `<option value="${s}">${s}</option>`).join('')}
        </select>
        <select id="filter-area">
          <option value="">All Disease Areas</option>
          <option value="HS">Hidradenitis Suppurativa</option>
          <option value="SSc">Systemic Sclerosis</option>
          <option value="PMR/GCA">PMR / GCA</option>
          <option value="Other">Other</option>
        </select>
        <input type="text" id="filter-search" placeholder="Search summaries...">
        <div style="display:flex;align-items:center;margin-bottom:6px;">
          <label style="font-size:0.78rem;font-weight:700;color:#64748b;text-transform:uppercase;letter-spacing:0.05em;">Confidence</label>
          <span class="help-icon">?<span class="tooltip">
            <b>Confidence Score (0–100)</b><hr>
            <b>Domain trust</b> — up to 40 pts<br>
            Trusted (SEC, PubMed, competitor IR) = +40<br>
            Unknown = +15 &nbsp;·&nbsp; Blocked = −20<hr>
            <b>Source type</b> — up to 30 pts<br>
            SEC 8-K / Filing = 30<br>
            Press Release / Clinical Trial = 25<br>
            Conference / Presentation = 20<br>
            News Article = 15 &nbsp;·&nbsp; Analyst = 10<hr>
            <b>Recency</b> — up to 20 pts<br>
            Today = +20 &nbsp;·&nbsp; This month = +10<hr>
            <b>Both signals</b> — 10 pts<br>
            Competitor + keyword matched together
          </span></span>
        </div>
        <select id="filter-confidence">
          <option value="0">All Confidence Levels</option>
          <option value="70">High only (70+)</option>
          <option value="45">Medium + High (45+)</option>
        </select>
        <button class="reset-btn" onclick="resetFilters()">Reset All Filters</button>
      </div>
    </div>
    <div>
      <div id="results-count"></div>
      <div id="findings-container">
        ${findingSections || '<div class="no-results">No findings found.</div>'}
      </div>
    </div>
  </div>
</div>
<script>
  const cards = document.querySelectorAll('.card');
  const totalEl = document.getElementById('s-total');
  const visibleEl = document.getElementById('s-visible');
  const countEl = document.getElementById('results-count');

  const DATA_MIN = '${minDate}';
  const DATA_MAX = '${maxDate}';

  function toISO(d) { return d.toISOString().slice(0, 10); }

  function toggleFilters() {
    const sidebar = document.getElementById('sidebar');
    const btn = document.getElementById('filter-toggle-btn');
    sidebar.classList.toggle('open');
    btn.textContent = sidebar.classList.contains('open') ? '✕ Hide Filters' : '☰ Show Filters';
  }

  function setPreset(key) {
    const today = new Date();
    let from = '', to = '';
    if (key === 'today')          { from = to = toISO(today); }
    else if (key === 'yesterday') { const y = new Date(today); y.setDate(y.getDate()-1); from = to = toISO(y); }
    else if (key === '7d')        { const d = new Date(today); d.setDate(d.getDate()-6); from = toISO(d); to = toISO(today); }
    else if (key === '30d')       { const d = new Date(today); d.setDate(d.getDate()-29); from = toISO(d); to = toISO(today); }
    else if (key === 'mtd')       { from = toISO(new Date(today.getFullYear(), today.getMonth(), 1)); to = toISO(today); }

    document.getElementById('date-from').value = from;
    document.getElementById('date-to').value = to;
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    event.target.classList.add('active');
    applyFilters();
  }

  function clearPreset() {
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
  }

  function updateCount() {
    const visible = [...cards].filter(c => !c.classList.contains('hidden')).length;
    visibleEl.textContent = visible;
    countEl.textContent = visible + ' of ${allFindings.length} findings';
  }

  function applyFilters() {
    const from  = document.getElementById('date-from').value;
    const to    = document.getElementById('date-to').value;
    const comp  = document.getElementById('filter-competitor').value.toLowerCase();
    const kw    = document.getElementById('filter-keyword').value.toLowerCase();
    const src   = document.getElementById('filter-source').value;
    const q     = document.getElementById('filter-search').value.toLowerCase();
    const area  = document.getElementById('filter-area').value;

    cards.forEach(card => {
      const date  = card.dataset.date ?? '';
      const comps = card.dataset.competitors?.split('|') ?? [];
      const kws   = card.dataset.keywords?.split('|') ?? [];

      const minConf = parseInt(document.getElementById('filter-confidence').value) || 0;
      const noRange = !from && !to;
      const matchDate = noRange || (date && (!from || date >= from) && (!to || date <= to));
      const matchConf = parseInt(card.dataset.confidence ?? 0) >= minConf;
      const matchComp = !comp || comps.some(c => c === comp);
      const matchKw   = !kw   || kws.some(k => k === kw);
      const matchSrc  = !src  || card.dataset.source === src;
      const matchQ    = !q    || card.querySelector('.summary')?.textContent.toLowerCase().includes(q);
      const matchArea = !area || card.dataset.area === area;

      card.classList.toggle('hidden', !(matchDate && matchComp && matchKw && matchSrc && matchQ && matchConf && matchArea));
    });
    document.querySelectorAll('.disease-section').forEach(sec => {
      const sectionCards = [...sec.querySelectorAll('.card')];
      const visibleCount = sectionCards.filter(c => !c.classList.contains('hidden')).length;
      sec.classList.toggle('hidden', visibleCount === 0);
      sec.querySelector('.section-count').textContent = visibleCount;
    });
    updateCount();
  }

  function resetFilters() {
    document.getElementById('date-from').value = '';
    document.getElementById('date-to').value = '';
    document.querySelectorAll('.preset-btn').forEach(b => b.classList.remove('active'));
    document.querySelector('.preset-btn:last-child').classList.add('active');
    document.getElementById('filter-confidence').value = '0';
    document.getElementById('filter-competitor').value = '';
    document.getElementById('filter-keyword').value = '';
    document.getElementById('filter-source').value = '';
    document.getElementById('filter-search').value = '';
    document.getElementById('filter-area').value = '';
    applyFilters();
  }

  ['date-from','date-to'].forEach(id => document.getElementById(id).addEventListener('change', () => { clearPreset(); applyFilters(); }));
  ['filter-competitor','filter-keyword','filter-source','filter-confidence','filter-area'].forEach(id =>
    document.getElementById(id).addEventListener('change', applyFilters));
  document.getElementById('filter-search').addEventListener('input', applyFilters);

  updateCount();
</script>
</body>
</html>`;

fs.writeFileSync(`${resultsDir}/historical.html`, html);
console.log(`Historical dashboard saved to results/historical.html (${allFindings.length} findings across ${files.length} runs)`);
