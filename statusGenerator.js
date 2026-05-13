import fs from 'fs';

const RUN_LOG_FILE = 'results/run-log.json';

const now = new Date();
const timestamp = now.toISOString();
const hasFindings = fs.existsSync('results/latest.json');
let findingsCount = 0;
let competitors = [];

if (hasFindings) {
  const data = JSON.parse(fs.readFileSync('results/latest.json', 'utf8'));
  const findings = data?.data?.findings ?? data?.findings ?? [];
  findingsCount = findings.length;
  competitors = [...new Set(findings.flatMap(f => f.competitors ?? []).filter(c => c !== 'Keyword matched'))];
}

// Load and update run log
const log = fs.existsSync(RUN_LOG_FILE)
  ? JSON.parse(fs.readFileSync(RUN_LOG_FILE, 'utf8'))
  : [];

const jobStatus = (process.env.JOB_STATUS ?? 'success').toLowerCase();
const runStatus = jobStatus === 'failure' ? 'failed' : jobStatus === 'cancelled' ? 'cancelled' : hasFindings ? 'findings' : 'clean';
log.unshift({ timestamp, status: runStatus, findings: findingsCount, competitors });
const trimmed = log.slice(0, 200);
fs.writeFileSync(RUN_LOG_FILE, JSON.stringify(trimmed, null, 2));

// Stats for display
const last24h = trimmed.filter(r => new Date(r.timestamp) > new Date(Date.now() - 86400000));
const runsToday = last24h.length;
const findingsToday = last24h.reduce((s, r) => s + r.findings, 0);
const lastFinding = trimmed.find(r => r.status === 'findings');

function fmtTime(iso) {
  return new Date(iso).toLocaleString('en-CA', { timeZone: 'America/Toronto', dateStyle: 'medium', timeStyle: 'short' });
}

function statusBadge(run) {
  if (run.status === 'findings') return `<span class="badge badge-findings">${run.findings} finding${run.findings !== 1 ? 's' : ''}</span>`;
  if (run.status === 'failed') return `<span class="badge badge-failed">Failed</span>`;
  if (run.status === 'cancelled') return `<span class="badge badge-cancelled">Cancelled</span>`;
  return `<span class="badge badge-clean">Clean</span>`;
}

const rows = trimmed.slice(0, 50).map(run => `
  <tr class="${run.status === 'findings' ? 'row-findings' : run.status === 'failed' ? 'row-failed' : ''}">
    <td>${fmtTime(run.timestamp)}</td>
    <td>${statusBadge(run)}</td>
    <td class="competitors">${run.competitors?.join(', ') || '—'}</td>
    <td>${run.status === 'findings' ? `<a href="historical.html">View →</a>` : ''}</td>
  </tr>`).join('');

const currentStatus = hasFindings
  ? `<div class="status-indicator status-findings">● ${findingsCount} new finding${findingsCount !== 1 ? 's' : ''} found</div>`
  : `<div class="status-indicator status-clean">● Last run: clean</div>`;

const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="300">
  <title>Zura Bio CI — Status</title>
  <link href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;600;700&family=Lato:wght@400;700&display=swap" rel="stylesheet">
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Lato', Arial, sans-serif; background: #f4f6f9; color: #1e293b; min-height: 100vh; }

    .header { background: #fff; border-bottom: 3px solid #0052CC; padding: 20px 32px; display: flex; align-items: center; justify-content: space-between; }
    .header img { height: 36px; }
    .header-right { text-align: right; }
    .header-label { font-size: 11px; font-weight: 700; letter-spacing: 0.1em; text-transform: uppercase; color: #888; }
    .header-links { margin-top: 4px; }
    .header-links a { color: #0052CC; font-size: 13px; font-weight: 600; text-decoration: none; margin-left: 16px; }

    .container { max-width: 960px; margin: 0 auto; padding: 32px 24px; }

    .stats-row { display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 28px; }
    .stat-card { background: #fff; border-radius: 8px; padding: 20px 24px; box-shadow: 0 1px 4px rgba(0,0,0,0.08); }
    .stat-value { font-family: 'Poppins', sans-serif; font-size: 28px; font-weight: 700; color: #0052CC; }
    .stat-label { font-size: 12px; color: #888; margin-top: 2px; text-transform: uppercase; letter-spacing: 0.05em; }

    .status-indicator { font-family: 'Poppins', sans-serif; font-size: 15px; font-weight: 600; padding: 12px 20px; border-radius: 8px; margin-bottom: 24px; }
    .status-clean { background: #f0fdf4; color: #16a34a; }
    .status-findings { background: #eff6ff; color: #0052CC; }

    .section-title { font-family: 'Poppins', sans-serif; font-size: 14px; font-weight: 600; color: #374151; margin-bottom: 12px; text-transform: uppercase; letter-spacing: 0.06em; }

    table { width: 100%; border-collapse: collapse; background: #fff; border-radius: 8px; overflow: hidden; box-shadow: 0 1px 4px rgba(0,0,0,0.08); font-size: 13px; }
    thead tr { background: #f8fafc; border-bottom: 2px solid #e2e8f0; }
    th { padding: 10px 16px; text-align: left; font-size: 11px; font-weight: 700; color: #888; text-transform: uppercase; letter-spacing: 0.06em; }
    td { padding: 10px 16px; border-bottom: 1px solid #f1f5f9; color: #374151; }
    tr:last-child td { border-bottom: none; }
    tr.row-findings td { background: #fafcff; }
    .competitors { color: #888; font-size: 12px; }
    td a { color: #0052CC; text-decoration: none; font-weight: 600; font-size: 12px; }

    .badge { display: inline-block; padding: 2px 10px; border-radius: 999px; font-size: 11px; font-weight: 700; }
    .badge-clean { background: #f0fdf4; color: #16a34a; }
    .badge-findings { background: #eff6ff; color: #0052CC; }
    .badge-failed { background: #fef2f2; color: #dc2626; }
    .badge-cancelled { background: #f9fafb; color: #9ca3af; }
    tr.row-failed td { background: #fff8f8; }

    .footer { text-align: center; padding: 24px; color: #aaa; font-size: 12px; }
    .footer span { color: #ccc; margin: 0 8px; }
  </style>
</head>
<body>

<div class="header">
  <img src="https://zurabio.com/wp-content/uploads/zurabio-logo.png" alt="Zura Bio">
  <div class="header-right">
    <div class="header-label">Competitive Intelligence · Run Status</div>
    <div class="header-links">
      <a href="index.html">Latest Report</a>
      <a href="historical.html">Historical</a>
    </div>
  </div>
</div>

<div class="container">

  ${currentStatus}

  <div class="stats-row">
    <div class="stat-card">
      <div class="stat-value">${runsToday}</div>
      <div class="stat-label">Runs in last 24 hours</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${findingsToday}</div>
      <div class="stat-label">Findings in last 24 hours</div>
    </div>
    <div class="stat-card">
      <div class="stat-value">${lastFinding ? fmtTime(lastFinding.timestamp).split(',')[0] : '—'}</div>
      <div class="stat-label">Last finding date</div>
    </div>
  </div>

  <div class="section-title">Recent Runs</div>
  <table>
    <thead>
      <tr>
        <th>Time (ET)</th>
        <th>Status</th>
        <th>Competitors</th>
        <th></th>
      </tr>
    </thead>
    <tbody>${rows}</tbody>
  </table>

</div>

<div class="footer">
  Zura Bio Competitive Intelligence <span>·</span> Auto-refreshes every 5 minutes <span>·</span> Last updated ${fmtTime(timestamp)}
</div>

</body>
</html>`;

fs.writeFileSync('results/status.html', html);
console.log(`Status page updated — ${runsToday} runs today, ${findingsToday} findings.`);
