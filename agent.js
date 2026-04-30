import Firecrawl from '@mendable/firecrawl-js';
import { z } from 'zod';
import fs from 'fs';
import { generateReport } from './reportGenerator.js';
import { allAliasesForPrompt, normalizeKeyword, AND_MODE, isStaleContent, scoreFindings, getPrimaryDiseaseArea } from './keywords.js';

const firecrawl = new Firecrawl({ apiKey: process.env.FIRECRAWL_API_KEY });

console.log('Running Firecrawl agent — this may take several minutes...');

const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());

const result = await firecrawl.agent({
  maxCredits: 15000,
  prompt: `Today is ${today}. Search for news, press releases, SEC 8-K filings, corporate presentations, scientific publications from PubMed, and clinical trial updates from clinicaltrials.gov published TODAY or within the last 24 hours.

Competitors to monitor: AVTX, MLTX, ORKA, INSM, ACRS, ANAB, UCB, KYMR, GLUE, IFRX, CGEM, NKTX, Candid, XNCR, KNSA, VERA, VOR, GLPG, ALMS, QTTB, INCY.

Keywords and synonyms to monitor: ${allAliasesForPrompt}.

${AND_MODE
  ? 'IMPORTANT: Only include findings where BOTH a competitor AND a keyword appear together in the same article. Do not include articles that mention only a competitor with no keyword, or only a keyword with no competitor.'
  : 'Include findings that mention at least one competitor OR at least one keyword.'}

IMPORTANT: For each finding, list ALL competitors and ALL keywords mentioned in that article as arrays — not just the first one found.

SOURCE QUALITY: Only include primary sources — press releases, SEC filings, PubMed publications, ClinicalTrials.gov updates, company investor relations pages, and established newswires (Reuters, Bloomberg, PR Newswire, GlobeNewswire, Business Wire). Exclude blog posts, opinion pieces, editorials, sponsored content, and articles that primarily recap or reference events that occurred before ${today}.

Only include articles published on or after ${today}. For each finding provide a summary, the exact publication date, and the source link.`,
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

// Filter stale and low-quality sources
const qualityFindings = allFindings.filter(f => !isStaleContent(f));
const staleDropped = allFindings.length - qualityFindings.length;
if (staleDropped > 0) console.log(`Quality filter dropped ${staleDropped} stale/low-quality finding(s).`);

// Enforce AND logic in post-processing as a safety net
const filteredFindings = AND_MODE
  ? qualityFindings.filter(f => f.competitors[0] !== 'Keyword matched' && f.keywords.length)
  : qualityFindings;

const andDropped = allFindings.length - filteredFindings.length;
if (AND_MODE && andDropped > 0)
  console.log(`AND filter dropped ${andDropped} finding(s) missing a competitor or keyword.`);

// Deduplicate by URL — only report findings we haven't seen before
const seenFile = 'seen_links.json';
const seenLinks = new Set(
  fs.existsSync(seenFile) ? JSON.parse(fs.readFileSync(seenFile, 'utf8')) : []
);

const newFindings = filteredFindings.filter(f => f.source_link && !seenLinks.has(f.source_link));
newFindings.forEach(f => seenLinks.add(f.source_link));
fs.writeFileSync(seenFile, JSON.stringify([...seenLinks], null, 2));

const skipped = filteredFindings.length - newFindings.length;
console.log(`All findings: ${allFindings.length} | After AND filter: ${filteredFindings.length} | New: ${newFindings.length} | Already seen: ${skipped}`);

const timestamp = new Date().toISOString().replace(/[:.]/g, '-');

if (newFindings.length === 0) {
  console.log('No findings from the last 24 hours — skipping report and notification.');
  fs.rmSync('results/latest.json', { force: true });
  process.exit(0);
}

const newResult = { ...result, data: { ...result.data, findings: newFindings } };
fs.writeFileSync('results/latest.json', JSON.stringify(newResult, null, 2));

generateReport(newResult.data, timestamp);
console.log(`Report saved to results/report_${timestamp}.html`);
console.log(`Open results/report_latest.html to view the dashboard.`);
