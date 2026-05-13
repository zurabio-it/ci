import { XMLParser } from 'fast-xml-parser';
import fs from 'fs';
import { KEYWORD_ALIASES } from './keywords.js';

const TEAMS_WEBHOOK = process.env.TEAMS_DEV_WEBHOOK_URL;
const SEEN_FILE = 'seen_links_rss.json';
const CUTOFF_HOURS = 48;

// 17 competitors with RSS feeds (INSM, UCB, IFRX have no RSS)
const RSS_FEEDS = [
  { ticker: 'AVTX', name: 'Avalo Therapeutics',          url: 'https://ir.avalotx.com/rss/news-releases.xml' },
  { ticker: 'MLTX', name: 'MoonLake Immunotherapeutics', url: 'https://ir.moonlaketx.com/rss/news-releases.xml' },
  { ticker: 'ORKA', name: 'Oruka Therapeutics',          url: 'https://ir.orukatx.com/rss/news-releases.xml' },
  { ticker: 'ACRS', name: 'Aclaris Therapeutics',        url: 'https://investor.aclaristx.com/rss/news-releases.xml' },
  { ticker: 'ANAB', name: 'AnaptysBio',                  url: 'https://ir.anaptysbio.com/rss/news-releases.xml' },
  { ticker: 'KYMR', name: 'Kymera Therapeutics',         url: 'https://investors.kymeratx.com/rss/news-releases.xml' },
  { ticker: 'GLUE', name: 'Monte Rosa Therapeutics',     url: 'https://ir.monterosatx.com/rss/news-releases.xml' },
  { ticker: 'CGEM', name: 'Cullinan Therapeutics',       url: 'https://investors.cullinantherapeutics.com/rss/news-releases.xml' },
  { ticker: 'NKTX', name: 'Nkarta',                     url: 'https://ir.nkartatx.com/rss/news-releases.xml' },
  { ticker: 'XNCR', name: 'Xencor',                     url: 'https://investors.xencor.com/rss/news-releases.xml' },
  { ticker: 'KNSA', name: 'Kiniksa Pharmaceuticals',     url: 'https://investors.kiniksa.com/rss/news-releases.xml' },
  { ticker: 'VERA', name: 'Vera Therapeutics',           url: 'https://ir.veratx.com/rss/news-releases.xml' },
  { ticker: 'VOR',  name: 'Vor Bio',                    url: 'https://ir.vorbio.com/rss/news-releases.xml' },
  { ticker: 'GLPG', name: 'Galapagos',                  url: 'https://www.glpg.com/rss/news-releases.xml' },
  { ticker: 'ALMS', name: 'Alumis',                     url: 'https://investors.alumis.com/rss/news-releases.xml' },
  { ticker: 'QTTB', name: 'Q32 Bio',                    url: 'https://ir.q32bio.com/rss/news-releases.xml' },
  { ticker: 'INCY', name: 'Incyte',                     url: 'https://investor.incyte.com/rss/news-releases.xml' },
];

// Build alias → canonical map for keyword matching
const CANONICAL_FOR_ALIAS = {};
for (const [canonical, aliases] of Object.entries(KEYWORD_ALIASES)) {
  for (const alias of aliases) {
    CANONICAL_FOR_ALIAS[alias.toLowerCase()] = canonical;
  }
}

function matchKeywords(text) {
  const lower = text.toLowerCase();
  const matched = new Set();
  for (const [alias, canonical] of Object.entries(CANONICAL_FOR_ALIAS)) {
    if (lower.includes(alias)) matched.add(canonical);
  }
  return [...matched];
}

function stripHtml(str) {
  return (str ?? '').replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
}

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_' });

function parseItems(xml) {
  try {
    const obj = parser.parse(xml);
    const items = obj?.rss?.channel?.item ?? [];
    return Array.isArray(items) ? items : [items];
  } catch {
    return [];
  }
}

function itemLink(item) {
  const g = item.guid;
  const guidStr = typeof g === 'string' ? g : g?.['#text'] ?? '';
  return item.link || guidStr || '';
}

function isRecent(pubDateStr) {
  if (!pubDateStr) return true; // no date — include to be safe
  const pub = new Date(pubDateStr);
  if (isNaN(pub.getTime())) return true; // unparseable — include to be safe
  return (Date.now() - pub.getTime()) < CUTOFF_HOURS * 60 * 60 * 1000;
}

const seenLinks = new Set(
  fs.existsSync(SEEN_FILE) ? JSON.parse(fs.readFileSync(SEEN_FILE, 'utf8')) : []
);

// Fetch all feeds concurrently
console.log(`Checking ${RSS_FEEDS.length} RSS feeds...`);
const fetchResults = await Promise.allSettled(
  RSS_FEEDS.map(async feed => {
    const res = await fetch(feed.url, { signal: AbortSignal.timeout(10000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const xml = await res.text();
    return { feed, items: parseItems(xml) };
  })
);

const newFindings = [];
let feedErrors = 0;

for (const result of fetchResults) {
  if (result.status === 'rejected') {
    const feed = RSS_FEEDS[fetchResults.indexOf(result)];
    console.log(`  ${feed.ticker}: feed error — ${result.reason.message}`);
    feedErrors++;
    continue;
  }

  const { feed, items } = result.value;

  for (const item of items) {
    const link = itemLink(item);
    if (!link) continue;
    if (seenLinks.has(link)) continue;
    if (!isRecent(item.pubDate)) continue;

    seenLinks.add(link);

    const title = stripHtml(item.title ?? '');
    const description = stripHtml(item.description ?? '');
    const keywords = matchKeywords(`${title} ${description}`);

    if (keywords.length === 0) continue;

    newFindings.push({ ticker: feed.ticker, name: feed.name, title, link, pubDate: item.pubDate ?? '', keywords });
  }
}

// Persist updated seen links
fs.writeFileSync(SEEN_FILE, JSON.stringify([...seenLinks], null, 2));

console.log(`RSS check complete — ${newFindings.length} new keyword-matched finding(s) (${feedErrors} feed error(s)).`);

if (newFindings.length === 0) {
  process.exit(0);
}

// Post to Teams CI Dev channel
if (!TEAMS_WEBHOOK) {
  console.error('TEAMS_DEV_WEBHOOK_URL not set — skipping Teams notification.');
  process.exit(0);
}

const runDate = new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' });
const tickers = [...new Set(newFindings.map(f => f.ticker))];

const findingBlocks = newFindings.flatMap(f => {
  const items = [
    { type: 'TextBlock', text: `**${f.ticker} — ${f.name}**`, wrap: true, weight: 'Bolder', size: 'Small' },
    { type: 'TextBlock', text: f.title, wrap: true, size: 'Small' },
    { type: 'TextBlock', text: `${f.keywords.join(', ')}${f.pubDate ? ' · ' + f.pubDate : ''}`, wrap: true, size: 'Small', color: 'Good' },
  ];
  if (f.link) {
    items.push({ type: 'TextBlock', text: `[View Release →](${f.link})`, wrap: true, size: 'Small', color: 'Accent' });
  }
  return [{ type: 'Container', separator: true, items }];
});

const adaptiveCard = {
  type: 'AdaptiveCard',
  $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
  version: '1.4',
  body: [
    { type: 'TextBlock', text: 'Zura Bio — RSS Feed Alert', weight: 'Bolder', size: 'Large' },
    {
      type: 'TextBlock',
      text: `**${newFindings.length} new release${newFindings.length !== 1 ? 's' : ''}** · ${tickers.join(', ')} · ${runDate}`,
      wrap: true,
      color: 'Accent',
    },
    ...findingBlocks,
  ],
  actions: [
    { type: 'Action.OpenUrl', title: '📊 Latest Report', url: 'https://ci.zurabio.com/' },
    { type: 'Action.OpenUrl', title: '📅 Historical Dashboard', url: 'https://ci.zurabio.com/historical.html' },
  ],
};

const res = await fetch(TEAMS_WEBHOOK, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(adaptiveCard),
});
const body = await res.text();
if (res.ok) console.log('Teams RSS alert sent.');
else console.error('Teams failed:', res.status, body);
