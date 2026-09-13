'use strict';

const { Storage } = require('@google-cloud/storage');
const { DriveHistorySource } = require('../src/drive_history');
const { DrivePrimaryWriter } = require('../src/drive_primary_writer');
const { latestMarketSnapshot } = require('../src/mcp_market');

function taipeiDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
function latestDateOf(manifest) {
  return String(
    manifest?.latestTradeDate ||
    manifest?.latestDate ||
    manifest?.latest_successful_trade_date ||
    manifest?.last_update?.latest_date ||
    manifest?.last_update?.latestTradeDate ||
    manifest?.last_update?.latest_successful_trade_date ||
    manifest?.end ||
    ''
  ).slice(0, 10) || null;
}
async function readFolderManifest(parentFolderId, folderName) {
  const writer = new DrivePrimaryWriter({ parentFolderId, folderName });
  return JSON.parse(await writer.readText('manifest.json'));
}
async function safeCheck(name, fn, blocking = true) {
  try { const detail = await fn(); return { name, ok: detail?.ok !== false, blocking, ...detail }; }
  catch (error) { return { name, ok: false, blocking, error: String(error.message || error) }; }
}

async function buildReport(options = {}) {
  const now = options.now || new Date();
  const today = taipeiDate(now);
  const root = process.env.MCP_DRIVE_PARENT_FOLDER_ID || process.env.TWSE_DRIVE_PARENT_FOLDER_ID || '';
  const mopsParent = process.env.MOPS_DRIVE_PARENT_FOLDER_ID || root;
  const history = new DriveHistorySource();
  const checks = [];

  checks.push(await safeCheck('twseMcpTop50', async () => {
    const snapshot = await latestMarketSnapshot(now);
    return { ok: snapshot.rows.length >= 50, latestDate: snapshot.date, rowCount: snapshot.rows.length, source: snapshot.source, status: snapshot.rows.length >= 50 ? 'complete' : 'incomplete' };
  }));

  for (const dataset of ['stockDaily', 'marketFlow', 'top50']) {
    checks.push(await safeCheck(dataset, async () => {
      const manifest = await history.manifest(dataset);
      return { ok: true, latestDate: latestDateOf(manifest), status: manifest.status || manifest.last_update?.status || 'complete' };
    }, false));
  }
  checks.push(await safeCheck('mopsRollingOfficial', async () => {
    const manifest = await history.mopsManifest();
    return { ok: manifest.status === 'complete', latestDate: latestDateOf(manifest), status: manifest.status };
  }, false));
  checks.push(await safeCheck('mcpDailyAuditArchive', async () => {
    const manifest = await readFolderManifest(root, process.env.MCP_DRIVE_AUDIT_FOLDER_NAME || 'MCP_DAILY_SYNC_AUDIT');
    return { ok: manifest.ok === true && manifest.latestDate === today, latestDate: manifest.latestDate, status: manifest.ok ? 'complete' : 'failed' };
  }, false));
  checks.push(await safeCheck('mopsDailySync', async () => {
    const manifest = await readFolderManifest(mopsParent, process.env.MOPS_DRIVE_FOLDER_NAME || 'MOPS_MCP_PRIMARY');
    const counts = manifest.counts || {};
    const hasCore = Number(counts.monthlyRevenue || 0) > 0 && Number(counts.quarterlyFinancials || 0) > 0;
    return { ok: manifest.latestDate === today && hasCore, latestDate: manifest.latestDate, counts, status: hasCore ? 'complete' : 'incomplete' };
  }, false));

  const marketDates = checks.filter(x => ['stockDaily','marketFlow','top50'].includes(x.name) && x.ok && x.latestDate).map(x => x.latestDate);
  const latestCompleteTradeDate = marketDates.length ? marketDates.slice().sort().at(-1) : null;
  const marketAligned = marketDates.length === 3 && new Set(marketDates).size === 1;
  checks.push({ name: 'marketDateAlignment', blocking: false, ok: marketAligned, latestDate: latestCompleteTradeDate, dates: marketDates, status: marketAligned ? 'complete' : 'mismatch' });

  const failures = checks.filter(x => x.blocking && !x.ok);
  return {
    schemaVersion: 2, generatedAt: now.toISOString(), checkedForDate: today,
    status: failures.length ? 'PARTIAL' : 'COMPLETE', ok: failures.length === 0, latestCompleteTradeDate,
    gatePolicy: 'MCP_MARKET_AND_AUDIT_ONLY; NEWS_AND_MOPS_20Q_ARE_NON_BLOCKING_ARCHIVES',
    checks, failedChecks: failures.map(x => x.name)
  };
}

async function persistReport(report) {
  const bucketName = String(process.env.GCS_BUCKET || '').trim();
  if (!bucketName) throw new Error('GCS_BUCKET is required');
  await new Storage().bucket(bucketName).file('public/data_health.json').save(`${JSON.stringify(report, null, 2)}\n`, { contentType: 'application/json; charset=utf-8', metadata: { cacheControl: 'no-store' }, resumable: false });

  // GCS is the authoritative persistence target for Cloud Run. A Google Drive
  // copy is optional because service accounts cannot reliably create folders in
  // a consumer My Drive. Enable the mirror explicitly only in an environment
  // where the runtime identity has a writable Shared Drive or delegated OAuth.
  if (String(process.env.DATA_HEALTH_DRIVE_MIRROR || '').trim() !== '1') return;

  try {
    const writer = new DrivePrimaryWriter({ parentFolderId: process.env.MCP_DRIVE_PARENT_FOLDER_ID || process.env.TWSE_DRIVE_PARENT_FOLDER_ID || '', folderName: process.env.DATA_HEALTH_DRIVE_FOLDER_NAME || 'DATA_HEALTH_AUDIT' });
    const date = report.checkedForDate;
    await writer.upsertText(`data_health_${date}.json`, `${JSON.stringify(report, null, 2)}\n`);
    await writer.upsertText('manifest.json', `${JSON.stringify({ schemaVersion: 1, generatedAt: report.generatedAt, latestDate: date, status: report.status, ok: report.ok, latestCompleteTradeDate: report.latestCompleteTradeDate, failedChecks: report.failedChecks }, null, 2)}\n`);
  } catch (error) {
    console.warn(JSON.stringify({ event: 'data-health-drive-mirror-failed', error: String(error.message || error) }));
  }
}
async function main() { const report = await buildReport(); await persistReport(report); process.stdout.write(`${JSON.stringify(report, null, 2)}\n`); if (!report.ok) process.exitCode = 2; }
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { buildReport, latestDateOf, persistReport, readFolderManifest, taipeiDate };
