import Firecrawl from '@mendable/firecrawl-js';
import { z } from 'zod';
import fs from 'fs';
import { generateReport } from './reportGenerator.js';
import { allAliasesForPrompt, normalizeKeyword, AND_MODE, isStaleContent, scoreFindings, getPrimaryDiseaseArea } from './keywords.js';

const firecrawl = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY });

console.log('Running Firecrawl agent — this may take several minutes...');

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());

// Competitor IR pages — only these URLs are visited. No open web search.
const COMPETITOR_URLS = [
  // AVTX — Avalo Therapeutics
  'https://ir.avalotx.com/news-events-presentations/press-releases',
  'https://ir.avalotx.com/sec-filings/all-sec-filings',
  'https://ir.avalotx.com/sec-filings/quarterly-reports',
  // MLTX — MoonLake Immunotherapeutics
  'https://ir.moonlaketx.com/press-releases',
  'https://ir.moonlaketx.com/financials-filings',
  // ORKA — Oruka Therapeutics
  'https://ir.orukatx.com/news-events/press-releases',
  'https://ir.orukatx.com/financial-information/sec-filings',
  'https://ir.orukatx.com/financial-information/quarterly-results',
  // INSM — Insmed
  'https://investor.insmed.com/releases',
  'https://investor.insmed.com/sec',
  // ACRS — Aclaris Therapeutics
  'https://investor.aclaristx.com/press-releases',
  'https://investor.aclaristx.com/sec-filings',
  // ANAB — AnaptysBio
  'https://ir.anaptysbio.com/news',
  'https://ir.anaptysbio.com/sec-filings',
  // UCB
  'https://www.ucb.com/newsroom/press-releases',
  'https://www.ucb.com/investors/download-center',
  // KYMR — Kymera Therapeutics
  'https://investors.kymeratx.com/news-events/press-releases',
  'https://investors.kymeratx.com/sec-filings',
  // GLUE — Monte Rosa Therapeutics
  'https://ir.monterosatx.com/news-and-events/press-releases',
  'https://ir.monterosatx.com/financials-and-filings/sec-filings',
  // IFRX — InflaRx
  'https://www.inflarx.de/Home/Investors/Press-Releases.html',
  'https://www.inflarx.de/Home/Investors/Financial-Information.html',
  // CGEM — Cullinan Therapeutics
  'https://investors.cullinantherapeutics.com/news-releases',
  'https://investors.cullinantherapeutics.com/sec-filings',
  // NKTX — Nkarta
  'https://ir.nkartatx.com/news-releases',
  'https://ir.nkartatx.com/financial-information/sec-filings',
  // XNCR — Xencor
  'https://investors.xencor.com/press-releases',
  'https://investors.xencor.com/financials-and-filings/sec-filings',
  // KNSA — Kiniksa Pharmaceuticals
  'https://investors.kiniksa.com/news-events/press-releases',
  'https://investors.kiniksa.com/financial-information/sec-filings',
  // VERA — Vera Therapeutics
  'https://ir.veratx.com/news-events/news-releases',
  'https://ir.veratx.com/financial-information/sec-filings',
  // VOR — Vor Bio
  'https://ir.vorbio.com/news-releases',
  'https://ir.vorbio.com/sec-filings',
  // GLPG — Galapagos
  'https://www.glpg.com/press-releases/',
  'https://www.glpg.com/investors/financials/sec-filings/',
  'https://www.glpg.com/investors/financials/financial-reports/',
  // ALMS — Alumis
  'https://investors.alumis.com/news-events/news-releases',
  'https://investors.alumis.com/financials-filings/sec-filings',
  // QTTB — Q32 Bio
  'https://ir.q32bio.com/news-and-events/news-releases',
  'https://ir.q32bio.com/financial-and-filings/sec-filings',
  // INCY — Incyte
  'https://investor.incyte.com/press-releases',
  'https://investor.incyte.com/financials/sec-filings',
  'https://investor.incyte.com/financials/quarterly-results',
];

const result = await firecrawl.agent({
  maxCredits: 15000,
  urls: COMPETITOR_URLS,
  strictConstrainToURLs: true,
  prompt: `Today is ${today}. You are monitoring competitor activity for a biotech company. Visit each of the provided URLs and extract any press releases, SEC filings, financial reports, or quarterly results published TODAY (${today}) or yesterday.

Competitors to monitor: AVTX, MLTX, ORKA, INSM, ACRS, ANAB, UCB, KYMR, GLUE, IFRX, CGEM, NKTX, XNCR, KNSA, VERA, VOR, GLPG, ALMS, QTTB, INCY.

Keywords and synonyms to monitor: ${allAliasesForPrompt}.

IMPORTANT: Only extract articles that are genuinely new (published ${today} or the day before). Do not include older articles. For each finding, extract the exact URL of the specific article — not the listing page URL.

For each finding list ALL competitors and ALL keywords mentioned.`,
  schema: z.object({
    competitors: z.array(z.object({
      value: z.string(),
      value_citation: z.string()
    })),
    keywords: z.array(z.object({
      value: z.string(),
      value_citation: z.string()
    })),
    findings: z.array(z.object({
      source_type: z.string(),
      source_type_citation: z.string(),
      competitors: z.array(z.string()),
      competitors_citation: z.string(),
      keywords: z.array(z.string()),
      keywords_citation: z.string(),
      summary: z.string(),
      summary_citation: z.string(),
      publication_date: z.string(),
      publication_date_citation: z.string(),
      source_link: z.string(),
      source_link_citation: z.string(),
      source_domain: z.string(),
      source_domain_citation: z.string()
    }))
  }),
  model: 'spark-1-mini',
});

fs.mkdirSync('results', { recursive: true });
fs.writeFileSync(`results/data_${new Date().toISOString().replace(/[:.]/g, '-')}.json`, JSON.stringify(result, null, 2));

if (result.status === 'failed' || !result.success) {
  console.error(`Agent failed: ${result.error ?? 'unknown error'}`);
  console.error('This is usually a Firecrawl timeout or rate limit — the daily scheduler will retry tomorrow.');
  fs.rmSync('results/latest.json', { force: true });
  process.exit(1);
}

const allFindings = (result.data?.findings ?? []).map(f => ({
  ...f,
  keywords: (f.keywords ?? []).map(normalizeKeyword).filter(Boolean),
  competitors: (f.competitors ?? []).map(c => c?.trim()).filter(Boolean),
})).map(f => ({
  ...f,
  competitors: f.competitors.length ? f.competitors : ['Keyword matched'],
  disease_area: getPrimaryDiseaseArea(f.keywords),
  confidence: scoreFindings(f),
}));

// URL-check all source URLs — drops findings with invented or redirected-to-error URLs.
// Uses GET+redirect:follow so res.url reflects the final destination after any redirects,
// catching cases where a plausible-looking URL silently lands on an error page (e.g. IFRX
// returning /Home/ErrorPages/404.html with HTTP 200).
const secPattern = /^https?:\/\/(?:www\.)?sec\.gov\/Archives\/edgar\/data\/(\d+)/i;
const ERROR_URL_PATTERNS = [
  '/errorpages/', '/404', '/not-found', '/notfound', '/error-page',
  'page-not-found', '?error=', '/errors/', '/error.html', '/404.html',
];
const urlCheckResults = await Promise.all(allFindings.map(async f => {
  const url = f.source_link;
  if (!url) return true;
  try {
    const res = await fetch(url, { method: 'GET', redirect: 'follow', signal: AbortSignal.timeout(10000) });
    // Cloudflare/bot-protection returns 403/401 — Firecrawl's browser can still access
    // the page, so we can't verify the URL but shouldn't drop it.
    if (res.status === 403 || res.status === 401) return true;
    if (!res.ok) {
      const secMatch = url.match(secPattern);
      if (secMatch) {
        f.source_link = `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${secMatch[1]}&type=8-K&dateb=&owner=include&count=10`;
        return true;
      }
      return false;
    }
    // 200 OK — check if redirected to an error page (e.g. IFRX /Home/ErrorPages/404.html)
    const finalUrl = (res.url ?? '').toLowerCase();
    if (ERROR_URL_PATTERNS.some(p => finalUrl.includes(p))) {
      console.log(`  Redirect-to-error dropped: ${url} → ${res.url}`);
      return false;
    }
    return true;
  } catch {
    // Timeout or connection error = bot-blocking, not a dead URL
    return true;
  }
}));
const urlValidated = allFindings.filter((_, i) => urlCheckResults[i]);
const urlDropped = allFindings.length - urlValidated.length;
if (urlDropped > 0) console.log(`URL check dropped ${urlDropped} finding(s) with broken source links.`);

// Drop findings older than 2 days or with future publish dates (hallucination signal)
const cutoff = new Date();
cutoff.setDate(cutoff.getDate() - 2);
const cutoffStr = cutoff.toISOString().slice(0, 10);
const dateFiltered = urlValidated.filter(f => {
  const pub = (f.publication_date ?? '').slice(0, 10);
  if (!pub) return true;
  if (pub > today) { console.log(`  Future date dropped: ${pub} — ${f.source_link}`); return false; }
  return pub >= cutoffStr;
});
const dateDropped = urlValidated.length - dateFiltered.length;
if (dateDropped > 0) console.log(`Date filter dropped ${dateDropped} finding(s) (too old or future-dated).`);

// Cross-check the summary dateline against the extracted publication_date.
// Press releases open with "City, Month D, YYYY–" — if that date is older than
// the cutoff, the agent hallucinated a newer publication_date and the finding
// should be dropped regardless of what publication_date says.
const MONTH_NAMES = 'January|February|March|April|May|June|July|August|September|October|November|December';
const DATELINE_RE = new RegExp(
  `(?:^|\\n)[\\w][\\w ,]+,\\s+(${MONTH_NAMES})\\s+(\\d{1,2}),\\s+(20\\d{2})\\s*[\\u2013\\u2014-]`, 'i'
);
const MONTH_IDX = { january:0,february:1,march:2,april:3,may:4,june:5,july:6,august:7,september:8,october:9,november:10,december:11 };
const datelineFiltered = dateFiltered.filter(f => {
  const m = DATELINE_RE.exec(f.summary ?? '');
  if (!m) return true;
  const datelineDate = new Date(+m[3], MONTH_IDX[m[1].toLowerCase()], +m[2]).toISOString().slice(0, 10);
  if (datelineDate < cutoffStr) {
    console.log(`  Dateline-date dropped: summary says ${datelineDate} (cutoff ${cutoffStr}) — ${f.source_link}`);
    return false;
  }
  return true;
});
const datelineDropped = dateFiltered.length - datelineFiltered.length;
if (datelineDropped > 0) console.log(`Dateline check dropped ${datelineDropped} finding(s) with hallucinated publication dates.`);

// Filter stale and low-quality sources
const qualityFindings = datelineFiltered.filter(f => !isStaleContent(f));
const staleDropped = datelineFiltered.length - qualityFindings.length;
if (staleDropped > 0) console.log(`Quality filter dropped ${staleDropped} stale/low-quality finding(s).`);

// Enforce AND logic
const filteredFindings = AND_MODE
  ? qualityFindings.filter(f => f.competitors[0] !== 'Keyword matched' && f.keywords.length)
  : qualityFindings;

// Deduplicate by URL
const seenFile = 'seen_links.json';
const seenLinks = new Set(
  fs.existsSync(seenFile) ? JSON.parse(fs.readFileSync(seenFile, 'utf8')) : []
);

const newFindings = filteredFindings.filter(f => f.source_link && !seenLinks.has(f.source_link));
newFindings.forEach(f => seenLinks.add(f.source_link));
fs.writeFileSync(seenFile, JSON.stringify([...seenLinks], null, 2));

const skipped = filteredFindings.length - newFindings.length;
console.log(`All findings: ${allFindings.length} | URL validated: ${urlValidated.length} | Date filtered: ${dateFiltered.length} | Dateline checked: ${datelineFiltered.length} | New: ${newFindings.length} | Already seen: ${skipped}`);

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

if (newFindings.length === 0) {
  console.log('No new findings — skipping report and notification.');
  fs.rmSync('results/latest.json', { force: true });
  process.exit(0);
}

const newResult = { ...result, data: { ...result.data, findings: newFindings } };
fs.writeFileSync('results/latest.json', JSON.stringify(newResult, null, 2));

generateReport(newResult.data, timestamp);
console.log(`Report saved to results/report_${timestamp}.html`);
console.log(`Open results/report_latest.html to view the dashboard.`);
