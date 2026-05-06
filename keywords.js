// AND mode: findings must mention a competitor AND a keyword together.
// Set to false for OR mode (either alone qualifies — broader but noisier).
export const AND_MODE = false;

// Canonical keyword name → all aliases to search for
export const KEYWORD_ALIASES = {
  'Hidradenitis suppurativa': ['Hidradenitis suppurativa', 'HS', 'acne inversa'],
  'Systemic sclerosis':       ['Systemic sclerosis', 'scleroderma', 'SSc'],
  'Polymyalgia rheumatica':   ['Polymyalgia rheumatica', 'PMR'],
  'Giant cell arteritis':     ['Giant cell arteritis', 'GCA', 'temporal arteritis'],
  'COPD':                     ['COPD', 'chronic obstructive pulmonary disease', 'emphysema', 'chronic bronchitis'],
  'IL-33':                    ['IL-33', 'IL33', 'interleukin-33', 'interleukin 33'],
  'IL-7R':                    ['IL-7R', 'IL7R', 'interleukin-7 receptor', 'interleukin 7 receptor', 'CD127'],
  'IL-17':                    ['IL-17', 'IL17', 'interleukin-17', 'interleukin 17'],
  'BAFF':                     ['BAFF', 'Baff', 'BLyS', 'B-lymphocyte stimulator', 'TNFSF13B'],
};

// Trusted domains — findings from these score higher and are never blocked
export const TRUSTED_DOMAINS = [
  // Regulatory & government
  'sec.gov', 'clinicaltrials.gov', 'pubmed.ncbi.nlm.nih.gov', 'fda.gov', 'ema.europa.eu',
  // Newswires
  'prnewswire.com', 'globenewswire.com', 'businesswire.com', 'accesswire.com',
  // Major news
  'reuters.com', 'bloomberg.com', 'statnews.com', 'fiercebiotech.com', 'biopharmadive.com',
  'endpoints11.com', 'evaluate.com', 'nature.com', 'nejm.org', 'thelancet.com',
  // Medical/scientific
  'jamanetwork.com', 'bmj.com', 'annrheumdis.bmj.com', 'aad.org', 'eadv.org',
  // Company IR pages & main domains
  'ir.avalotx.com', 'avalotx.com',                                    // AVTX - Avalo Therapeutics
  'ir.moonlaketx.com', 'moonlaketx.com',                              // MLTX - MoonLake Immunotherapeutics
  'ir.incyte.com', 'investor.incyte.com', 'incyte.com',               // INCY - Incyte
  'ucb.com',                                                           // UCB
  'insmed.com', 'investor.insmed.com',                                 // INSM - Insmed
  'aclaristx.com', 'investor.aclaristx.com',                          // ACRS - Aclaris Therapeutics
  'anaptysbio.com', 'ir.anaptysbio.com',                              // ANAB - AnaptysBio
  'kymeratx.com', 'investors.kymeratx.com',                           // KYMR - Kymera Therapeutics
  'monterosatx.com',                                                   // GLUE - Monte Rosa Therapeutics
  'inflarx.de',                                                        // IFRX - InflaRx
  'nkartatx.com', 'ir.nkartatx.com',                                  // NKTX - Nkarta
  'xencor.com', 'investors.xencor.com',                               // XNCR - Xencor
  'kiniksa.com', 'investors.kiniksa.com',                             // KNSA - Kiniksa Pharmaceuticals
  'veratx.com', 'ir.veratx.com',                                      // VERA - Vera Therapeutics
  'vorbio.com', 'ir.vorbio.com',                                      // VOR - Vor Biopharma
  'glpg.com', 'galapagos.com',                                        // GLPG - Galapagos
  'alumis.com', 'investors.alumis.com',                               // ALMS - Alumis
  'orukatx.com', 'ir.orukatx.com',                          // ORKA - Oruka Therapeutics
  'cullinantherapeutics.com', 'investors.cullinantherapeutics.com', // CGEM - Cullinan Therapeutics
  'q32bio.com', 'ir.q32bio.com',                            // QTTB - Q32 Bio
  'candidrx.com',                                           // Candid Therapeutics (private)
  'roche.com', 'ir.roche.com',                              // Roche (frequent finding)
  'astrazeneca.com', 'ir.astrazeneca.com',                  // AZN (frequent finding)
];

// Source type quality tiers — used in confidence scoring
export const SOURCE_TYPE_SCORES = {
  'sec 8-k': 30, 'sec filing': 30,
  'press release': 25, 'news release': 25,
  'pubmed': 25, 'scientific publication': 25, 'clinical trial': 25,
  'conference abstract': 20, 'scientific presentation': 20, 'conference': 20,
  'news article': 15, 'news': 15, 'market analysis': 10,
  'analyst update': 10, 'financial report': 10,
};

// Score a finding 0–100
export function scoreFindings(finding) {
  let score = 0;
  const domain = (finding.source_domain ?? '').toLowerCase();
  const sourceType = (finding.source_type ?? '').toLowerCase();
  const today = new Date().toISOString().slice(0, 10);
  const pubDate = finding.publication_date?.slice(0, 10) ?? '';

  // Domain trust (up to 40 pts)
  if (TRUSTED_DOMAINS.some(d => domain.includes(d))) score += 40;
  else if (BLOCKED_DOMAINS.some(d => domain.includes(d))) score -= 20;
  else score += 15; // unknown domain — neutral

  // Source type quality (up to 30 pts)
  const typeScore = Object.entries(SOURCE_TYPE_SCORES).find(([k]) => sourceType.includes(k))?.[1] ?? 5;
  score += typeScore;

  // Date recency (up to 20 pts)
  if (pubDate === today) score += 20;
  else if (pubDate >= today.slice(0, 7)) score += 10;

  // Both competitor AND keyword matched (10 pts bonus)
  const hasCompetitor = (finding.competitors ?? []).some(c => c !== 'Keyword matched');
  const hasKeyword = (finding.keywords ?? []).length > 0;
  if (hasCompetitor && hasKeyword) score += 10;

  return Math.max(0, Math.min(100, score));
}

// Source types that are considered low quality — filtered out in post-processing
export const BLOCKED_SOURCE_TYPES = [
  'blog', 'opinion', 'commentary', 'editorial', 'sponsored', 'advertorial', 'review post',
];

// Domains known to surface stale or low-quality content
export const BLOCKED_DOMAINS = [
  'seekingalpha.com', 'fool.com', 'benzinga.com', 'tipranks.com',
  'gurufocus.com', 'stockanalysis.com', 'simply wall st', 'simplywall.st',
  'stocktitan.net', 'investing.com', 'marketwatch.com', 'finance.yahoo.com',
  'markets.businessinsider.com', 'thestreet.com', 'investorplace.com',
  'prnewswire.com.com', 'globenewswire.com.com',
  'ajmc.com', 'managedhealthcareexecutive.com', 'pharmacytimes.com',
];

// Source types that must come directly from a trusted domain (competitor IR, newswire, or regulator).
// Aggregator republications of these are filtered out.
export const PRIMARY_ONLY_SOURCE_TYPES = [
  'press release', 'news release', 'sec filing', 'sec 8-k', 'financial report',
  'quarterly results', 'earnings', 'annual report',
];

// Summary phrases that indicate the article is recapping old events, not reporting new ones
export const STALE_PHRASES = [
  'last month', 'last year', 'last quarter', 'earlier this year', 'previously announced',
  'as previously reported', 'months ago', 'years ago', 'back in 20', 'announced in 20',
  'reported in 20', 'in a prior', 'retrospective',
  'analyses from the phase', 'data from the phase', 'results from the phase',
  'post-hoc', 'post hoc', 'subgroup analysis',
];

export function isStaleContent(finding) {
  const sourceType = (finding.source_type ?? '').toLowerCase();
  const domain = (finding.source_domain ?? '').toLowerCase();
  const summary = (finding.summary ?? '').toLowerCase();

  if (BLOCKED_SOURCE_TYPES.some(t => sourceType.includes(t))) return true;
  if (BLOCKED_DOMAINS.some(d => domain.includes(d))) return true;
  if (STALE_PHRASES.some(p => summary.includes(p))) return true;

  // Press releases, SEC filings, and financial results must come from a trusted
  // domain (competitor IR page, official newswire, or regulator). Aggregator
  // republications are discarded.
  const isPrimaryType = PRIMARY_ONLY_SOURCE_TYPES.some(t => sourceType.includes(t));
  const isTrusted = TRUSTED_DOMAINS.some(d => domain.includes(d));
  if (isPrimaryType && !isTrusted) return true;

  // ClinicalTrials.gov updates with no competitor match are generic trials
  // unrelated to Zura Bio's competitive landscape — drop them.
  const hasNoCompetitor = (finding.competitors ?? []).every(c => c === 'Keyword matched');
  if (domain.includes('clinicaltrials.gov') && hasNoCompetitor) return true;

  // Drop findings whose source link is a generic index page rather than a
  // specific article — signals the agent hallucinated content it couldn't source.
  const link = (finding.source_link ?? '').toLowerCase().replace(/\/$/, '');
  const GENERIC_PAGE_PATTERNS = [
    /\/press-releases?$/, /\/news(-releases?)?$/, /\/newsroom$/, /\/news-events?$/,
    /\/investor-relations?$/, /\/ir$/, /\/events?$/, /\/presentations?$/,
    /\/pipeline$/, /\/about$/, /\/home$/, /\/(index|default)(\.html?)?$/,
  ];
  if (GENERIC_PAGE_PATTERNS.some(p => p.test(link))) return true;

  // Drop findings whose summary is raw scraped page content rather than a real
  // summary — happens when the agent pulls navigation, contact, or footer text.
  const RAW_PAGE_SIGNALS = [
    'skip to main navigation', 'skip to content', 'impressum', 'privacy policy',
    'contact us', 'cookie policy', '#### ', '### ', 'loading...', 'javascript',
    'enable javascript', 'this page requires', '[linkedin]', '[facebook]', '[twitter]',
  ];
  if (RAW_PAGE_SIGNALS.some(s => summary.includes(s))) return true;

  // Drop findings with very short or empty summaries — nothing useful to show.
  if ((finding.summary ?? '').trim().length < 30) return true;

  return false;
}

// Build flat list of all aliases for the prompt
export const allAliasesForPrompt = Object.entries(KEYWORD_ALIASES)
  .map(([canonical, aliases]) => `${canonical} (also: ${aliases.slice(1).join(', ')})`)
  .join('; ');

// Normalize a keyword string returned by Firecrawl to its canonical name
export function normalizeKeyword(raw) {
  if (!raw) return raw;
  const lower = raw.toLowerCase().trim();
  for (const [canonical, aliases] of Object.entries(KEYWORD_ALIASES)) {
    if (aliases.some(a => lower.includes(a.toLowerCase()))) return canonical;
  }
  return raw;
}

const DISEASE_NAME_MAP = {
  'Hidradenitis suppurativa': 'HS',
  'Systemic sclerosis': 'SSc',
  'Polymyalgia rheumatica': 'PMR/GCA',
  'Giant cell arteritis': 'PMR/GCA',
};

const MECHANISM_AREA_MAP = {
  'IL-7R': 'SSc',
  'BAFF': 'SSc',
};

export function getPrimaryDiseaseArea(keywords) {
  for (const kw of keywords) {
    if (DISEASE_NAME_MAP[kw]) return DISEASE_NAME_MAP[kw];
  }
  for (const kw of keywords) {
    if (MECHANISM_AREA_MAP[kw]) return MECHANISM_AREA_MAP[kw];
  }
  return 'Other';
}

export const DISEASE_AREAS = ['HS', 'SSc', 'PMR/GCA', 'Other'];

export const DISEASE_AREA_META = {
  'HS':      { label: 'Hidradenitis Suppurativa (HS)', color: '#7c3aed' },
  'SSc':     { label: 'Systemic Sclerosis (SSc)',      color: '#2563eb' },
  'PMR/GCA': { label: 'PMR / Giant Cell Arteritis',    color: '#ea580c' },
  'Other':   { label: 'Other',                         color: '#6b7280' },
};
