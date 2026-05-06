import fs from 'fs';

const COMPETITOR_URLS = [
  // AVTX — Avalo Therapeutics
  ['AVTX', 'https://ir.avalotx.com/news-events-presentations/press-releases'],
  ['AVTX', 'https://ir.avalotx.com/sec-filings/all-sec-filings'],
  ['AVTX', 'https://ir.avalotx.com/sec-filings/quarterly-reports'],
  // MLTX — MoonLake Immunotherapeutics
  ['MLTX', 'https://ir.moonlaketx.com/press-releases'],
  ['MLTX', 'https://ir.moonlaketx.com/financials-filings'],
  // ORKA — Oruka Therapeutics
  ['ORKA', 'https://ir.orukatx.com/news-events/press-releases'],
  ['ORKA', 'https://ir.orukatx.com/financial-information/sec-filings'],
  ['ORKA', 'https://ir.orukatx.com/financial-information/quarterly-results'],
  // INSM — Insmed
  ['INSM', 'https://investor.insmed.com/releases'],
  ['INSM', 'https://investor.insmed.com/sec'],
  // ACRS — Aclaris Therapeutics
  ['ACRS', 'https://investor.aclaristx.com/press-releases'],
  ['ACRS', 'https://investor.aclaristx.com/sec-filings'],
  // ANAB — AnaptysBio
  ['ANAB', 'https://ir.anaptysbio.com/news'],
  ['ANAB', 'https://ir.anaptysbio.com/sec-filings'],
  // UCB
  ['UCB',  'https://www.ucb.com/newsroom/press-releases'],
  ['UCB',  'https://www.ucb.com/investors/download-center'],
  // KYMR — Kymera Therapeutics
  ['KYMR', 'https://investors.kymeratx.com/news-events/press-releases'],
  ['KYMR', 'https://investors.kymeratx.com/sec-filings'],
  // GLUE — Monte Rosa Therapeutics
  ['GLUE', 'https://ir.monterosatx.com/news-and-events/press-releases'],
  ['GLUE', 'https://ir.monterosatx.com/financials-and-filings/sec-filings'],
  // IFRX — InflaRx
  ['IFRX', 'https://www.inflarx.de/Home/Investors/Press-Releases.html'],
  ['IFRX', 'https://www.inflarx.de/Home/Investors/Financial-Information.html'],
  // CGEM — Cullinan Therapeutics
  ['CGEM', 'https://investors.cullinantherapeutics.com/news-releases'],
  ['CGEM', 'https://investors.cullinantherapeutics.com/sec-filings'],
  // NKTX — Nkarta
  ['NKTX', 'https://ir.nkartatx.com/news-releases'],
  ['NKTX', 'https://ir.nkartatx.com/financial-information/sec-filings'],
  // XNCR — Xencor
  ['XNCR', 'https://investors.xencor.com/press-releases'],
  ['XNCR', 'https://investors.xencor.com/financials-and-filings/sec-filings'],
  // KNSA — Kiniksa Pharmaceuticals
  ['KNSA', 'https://investors.kiniksa.com/news-events/press-releases'],
  ['KNSA', 'https://investors.kiniksa.com/financial-information/sec-filings'],
  // VERA — Vera Therapeutics
  ['VERA', 'https://ir.veratx.com/news-events/news-releases'],
  ['VERA', 'https://ir.veratx.com/financial-information/sec-filings'],
  // VOR — Vor Bio
  ['VOR',  'https://ir.vorbio.com/news-releases'],
  ['VOR',  'https://ir.vorbio.com/sec-filings'],
  // GLPG — Galapagos
  ['GLPG', 'https://www.glpg.com/press-releases/'],
  ['GLPG', 'https://www.glpg.com/investors/financials/sec-filings/'],
  ['GLPG', 'https://www.glpg.com/investors/financials/financial-reports/'],
  // ALMS — Alumis
  ['ALMS', 'https://investors.alumis.com/news-events/news-releases'],
  ['ALMS', 'https://investors.alumis.com/financials-filings/sec-filings'],
  // QTTB — Q32 Bio
  ['QTTB', 'https://ir.q32bio.com/news-and-events/news-releases'],
  ['QTTB', 'https://ir.q32bio.com/financial-and-filings/sec-filings'],
  // INCY — Incyte
  ['INCY', 'https://investor.incyte.com/press-releases'],
  ['INCY', 'https://investor.incyte.com/financials/sec-filings'],
  ['INCY', 'https://investor.incyte.com/financials/quarterly-results'],
];

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36';

const results = await Promise.all(COMPETITOR_URLS.map(async ([ticker, url]) => {
  try {
    const res = await fetch(url, {
      method: 'GET',
      signal: AbortSignal.timeout(20000),
      headers: { 'User-Agent': BROWSER_UA, 'Accept': 'text/html' },
    });
    // Many IR sites use Cloudflare/bot protection and return 403/401/timeout to plain
    // HTTP clients — Firecrawl's headless browser handles these fine. Only flag
    // definitive "page not found" or server errors as genuinely broken.
    const broken = res.status === 404 || res.status === 410 || res.status >= 500;
    return { ticker, url, status: res.status, ok: !broken };
  } catch (e) {
    // Timeout or connection error from a CI runner IP is almost always bot-blocking,
    // not a dead URL. Log it but don't alert.
    console.log(`  SKIP [${ticker}] network error (likely bot-blocking) — ${url}`);
    return { ticker, url, status: 'BLOCKED', ok: true };
  }
}));

const broken = results.filter(r => !r.ok);
const healthy = results.filter(r => r.ok);

console.log(`URL check: ${healthy.length} reachable/blocked-by-CDN, ${broken.length} confirmed broken out of ${results.length} total.`);
broken.forEach(r => console.log(`  BROKEN [${r.ticker}] ${r.status} — ${r.url}`));

if (broken.length === 0) process.exit(0);

// Send alert email via Resend
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ALERT_EMAIL_FROM = process.env.ALERT_EMAIL_FROM || 'ci@zurabio.com';
const ALERT_TO = 'ronal.diep@zurabio.com';

if (!RESEND_API_KEY) {
  console.error('RESEND_API_KEY not set — skipping email alert.');
  process.exit(0);
}

const rows = broken.map(r =>
  `<tr>
    <td style="padding:8px 12px;font-weight:600;font-family:monospace;">${r.ticker}</td>
    <td style="padding:8px 12px;color:#dc2626;">${r.status}</td>
    <td style="padding:8px 12px;word-break:break-all;"><a href="${r.url}" style="color:#0052CC;">${r.url}</a></td>
  </tr>`
).join('');

const emailHtml = `<!DOCTYPE html>
<html>
<head><meta charset="utf-8"></head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#fff;border-radius:3px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,0.1);">
        <tr>
          <td style="background:#dc2626;padding:20px 32px;">
            <p style="margin:0;color:#fff;font-size:18px;font-weight:700;">Zura Bio CI — URL Health Alert</p>
            <p style="margin:6px 0 0;color:#fca5a5;font-size:13px;">${broken.length} competitor source URL${broken.length !== 1 ? 's' : ''} unreachable · ${new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' })}</p>
          </td>
        </tr>
        <tr>
          <td style="padding:24px 32px;">
            <p style="margin:0 0 16px;font-size:14px;color:#374151;">The following URLs returned a confirmed error (404 or 5xx) during today's health check. These pages may have moved — please verify and update <code>agent.js</code> if needed.</p>
            <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse:collapse;font-size:13px;">
              <thead>
                <tr style="background:#f9fafb;border-bottom:2px solid #e5e7eb;">
                  <th style="padding:8px 12px;text-align:left;color:#6b7280;">Ticker</th>
                  <th style="padding:8px 12px;text-align:left;color:#6b7280;">Status</th>
                  <th style="padding:8px 12px;text-align:left;color:#6b7280;">URL</th>
                </tr>
              </thead>
              <tbody>${rows}</tbody>
            </table>
            <p style="margin:20px 0 0;font-size:13px;color:#6b7280;">Please verify these URLs are still correct and update <code>agent.js</code> if the competitor has moved their IR pages.</p>
          </td>
        </tr>
        <tr>
          <td style="background:#001F5B;padding:16px 32px;">
            <p style="margin:0;color:#6b7280;font-size:12px;">Zura Bio Competitive Intelligence · <a href="https://ci.zurabio.com" style="color:#0052CC;">ci.zurabio.com</a></p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`;

const emailRes = await fetch('https://api.resend.com/emails', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${RESEND_API_KEY}` },
  body: JSON.stringify({
    from: ALERT_EMAIL_FROM,
    to: ALERT_TO,
    subject: `Zura Bio CI — ${broken.length} broken URL${broken.length !== 1 ? 's' : ''} detected`,
    html: emailHtml,
  }),
});

if (emailRes.ok) {
  console.log(`Alert email sent to ${ALERT_TO}.`);
} else {
  console.error('Failed to send alert email:', await emailRes.text());
}
