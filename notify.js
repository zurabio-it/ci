import fs from 'fs';

if (!fs.existsSync('results/latest.json')) {
  console.log('No latest.json — nothing to notify.');
  process.exit(0);
}

const data = JSON.parse(fs.readFileSync('results/latest.json', 'utf8'));
const findings = data?.data?.findings ?? data?.findings ?? [];

if (findings.length === 0) {
  console.log('No new findings — skipping Teams notification.');
  process.exit(0);
}

const runDate = new Date().toLocaleString('en-CA', { timeZone: 'America/Toronto' });
const uniqueCompetitors = [...new Set(findings.flatMap(f => f.competitors ?? []).filter(c => c !== 'Keyword matched'))];

const DASHBOARD_URL = 'https://ci.zurabio.com/';
const HISTORICAL_URL = 'https://ci.zurabio.com/historical.html';

// ── Teams ──────────────────────────────────────────────────────────────────

const TEAMS_WEBHOOK = process.env.TEAMS_WEBHOOK_URL;

if (!TEAMS_WEBHOOK) {
  console.error('TEAMS_WEBHOOK_URL not set in environment.');
  process.exit(1);
}

const topFindings = findings.slice(0, 5);

const findingBlocks = topFindings.flatMap(f => {
  const comp = (f.competitors ?? []).filter(c => c !== 'Keyword matched').join(', ') || 'Keyword match';
  const kw   = f.keywords?.length ? ` · ${f.keywords.join(', ')}` : '';
  const items = [
    { type: 'TextBlock', text: `**${comp}** — ${f.source_type || 'Unknown'}${kw}`, wrap: true, weight: 'Bolder', size: 'Small' },
    { type: 'TextBlock', text: f.summary || '', wrap: true, size: 'Small', color: 'Default' },
  ];
  if (f.source_link) {
    items.push({ type: 'TextBlock', text: `[View Source →](${f.source_link})`, wrap: true, size: 'Small', color: 'Accent' });
  }
  return [{ type: 'Container', separator: true, items }];
});

const adaptiveCard = {
  type: 'AdaptiveCard',
  $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
  version: '1.4',
  body: [
    { type: 'TextBlock', text: 'Zura Bio — Competitive Intelligence', weight: 'Bolder', size: 'Large' },
    { type: 'TextBlock', text: `**${findings.length} new finding${findings.length !== 1 ? 's' : ''}** across ${uniqueCompetitors.length} competitor${uniqueCompetitors.length !== 1 ? 's' : ''} · ${runDate}`, wrap: true, color: 'Accent' },
    ...findingBlocks,
  ],
  actions: [
    { type: 'Action.OpenUrl', title: '📊 Latest Report', url: DASHBOARD_URL },
    { type: 'Action.OpenUrl', title: '📅 Historical Dashboard', url: HISTORICAL_URL },
  ],
};

const res = await fetch(TEAMS_WEBHOOK, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(adaptiveCard)
});

const body = await res.text();
if (res.ok) {
  console.log('Teams notification sent successfully.');
} else {
  console.error('Teams failed:', res.status, body);
}

// ── Email via Resend ───────────────────────────────────────────────────────

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const ALERT_EMAIL = process.env.ALERT_EMAIL;
const ALERT_EMAIL_FROM = process.env.ALERT_EMAIL_FROM || 'onboarding@resend.dev';

if (RESEND_API_KEY && ALERT_EMAIL) {
  const emailHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600;700&family=Lato:wght@400;700&display=swap" rel="stylesheet">
</head>
<body style="margin:0;padding:0;background:#f4f4f4;font-family:'Lato',Arial,sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f4f4f4;padding:32px 0;">
    <tr><td align="center">
      <table width="600" cellpadding="0" cellspacing="0" style="background:#ffffff;border-radius:3px;overflow:hidden;box-shadow:0px 9px 20px 2px rgba(0,0,0,0.12);">

        <!-- Header -->
        <tr>
          <td style="background:#ffffff;padding:28px 32px;border-bottom:3px solid #0052CC;">
            <img src="https://zurabio.com/wp-content/uploads/zurabio-logo.png" alt="Zura Bio" height="40" style="display:block;height:40px;width:auto;">
            <p style="margin:14px 0 0;color:#666666;font-family:'Lato',Arial,sans-serif;font-size:11px;font-weight:700;letter-spacing:0.1em;text-transform:uppercase;">Competitive Intelligence · Daily Briefing</p>
          </td>
        </tr>

        <!-- Summary bar -->
        <tr>
          <td style="background:#0052CC;padding:14px 32px;">
            <p style="margin:0;color:#ffffff;font-family:'Poppins',Arial,sans-serif;font-size:14px;font-weight:600;">
              ${findings.length} new finding${findings.length !== 1 ? 's' : ''} &nbsp;·&nbsp; ${uniqueCompetitors.length} competitor${uniqueCompetitors.length !== 1 ? 's' : ''} &nbsp;·&nbsp; ${runDate}
            </p>
          </td>
        </tr>

        <!-- Dashboard links -->
        <tr>
          <td style="padding:24px 32px 8px;">
            <p style="margin:0 0 14px;font-family:'Lato',Arial,sans-serif;font-size:13px;color:#666666;">
              Competitors: <strong style="color:#000000;">${uniqueCompetitors.slice(0, 6).join(', ')}${uniqueCompetitors.length > 6 ? ` +${uniqueCompetitors.length - 6} more` : ''}</strong>
            </p>
            <p style="margin:0;">
              <a href="${HISTORICAL_URL}" style="color:#0052CC;font-family:'Poppins',Arial,sans-serif;font-size:14px;font-weight:700;text-decoration:none;">📅 Historical Dashboard</a>
            </p>
          </td>
        </tr>

        <!-- Divider -->
        <tr><td style="padding:20px 32px 0;"><hr style="border:none;border-top:2px solid #f4f4f4;margin:0;"></td></tr>

        <!-- Findings -->
        ${findings.slice(0, 10).map((f, i) => `
        <tr>
          <td style="padding:20px 32px${i < Math.min(findings.length, 10) - 1 ? ';border-bottom:1px solid #f4f4f4' : ''};">
            <table width="100%" cellpadding="0" cellspacing="0">
              <tr>
                <td>
                  <span style="display:inline-block;background:#0052CC;color:#ffffff;font-family:'Poppins',Arial,sans-serif;font-size:10px;font-weight:600;padding:3px 8px;border-radius:3px;text-transform:uppercase;letter-spacing:0.06em;">${(f.competitors ?? []).filter(c => c !== 'Keyword matched').join(', ') || 'Keyword match'}</span>
                  ${f.keywords?.length ? `<span style="display:inline-block;background:#f4f4f4;color:#32373C;font-family:'Lato',Arial,sans-serif;font-size:10px;font-weight:700;padding:3px 8px;border-radius:3px;margin-left:6px;text-transform:uppercase;">${f.keywords.join(', ')}</span>` : ''}
                  <span style="display:inline-block;color:#999999;font-family:'Lato',Arial,sans-serif;font-size:10px;padding:3px 8px;border-radius:3px;margin-left:4px;border:1px solid #e0e0e0;">${f.source_type || 'Unknown'}</span>
                </td>
              </tr>
              <tr>
                <td style="padding-top:10px;color:#32373C;font-family:'Lato',Arial,sans-serif;font-size:14px;line-height:1.65;">${f.summary || ''}</td>
              </tr>
              <tr>
                <td style="padding-top:10px;">
                  ${f.source_link ? `<a href="${f.source_link}" style="color:#0052CC;font-family:'Poppins',Arial,sans-serif;font-size:12px;text-decoration:none;font-weight:600;">View Source →</a>` : ''}
                  <span style="color:#999999;font-family:'Lato',Arial,sans-serif;font-size:12px;margin-left:12px;">${f.publication_date || ''}</span>
                </td>
              </tr>
            </table>
          </td>
        </tr>`).join('')}

        ${findings.length > 10 ? `
        <tr>
          <td style="padding:16px 32px 24px;text-align:center;">
            <a href="${DASHBOARD_URL}" style="color:#0052CC;font-family:'Poppins',Arial,sans-serif;font-size:13px;font-weight:600;text-decoration:none;">View all ${findings.length} findings →</a>
          </td>
        </tr>` : ''}

        <!-- Footer -->
        <tr>
          <td style="background:#001F5B;padding:20px 32px;">
            <p style="margin:0;color:#666666;font-family:'Lato',Arial,sans-serif;font-size:12px;">
              Zura Bio Competitive Intelligence &nbsp;·&nbsp;
              <a href="${DASHBOARD_URL}" style="color:#0052CC;text-decoration:none;">ci.zurabio.com</a>
            </p>
          </td>
        </tr>

      </table>
    </td></tr>
  </table>
</body>
</html>`;

  const emailRes = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${RESEND_API_KEY}`
    },
    body: JSON.stringify({
      from: ALERT_EMAIL_FROM,
      to: ALERT_EMAIL,
      subject: `Zura Bio CI — ${findings.length} new finding${findings.length !== 1 ? 's' : ''} · ${new Date().toLocaleDateString('en-CA')}`,
      html: emailHtml
    })
  });

  const emailBody = await emailRes.json();
  if (emailRes.ok) {
    console.log('Email notification sent successfully.');
  } else {
    console.error('Email failed:', emailBody);
  }
}
