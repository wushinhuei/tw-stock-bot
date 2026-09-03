'use strict';

const { spawnSync } = require('node:child_process');
const { DrivePrimaryWriter } = require('../src/drive_primary_writer');
const { POLICY } = require('../src/data_source_policy');

function runNode(script, env = process.env) {
  const result = spawnSync(process.execPath, [script], { env, encoding: 'utf8' });
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${script} failed (${result.status}): ${String(result.stderr || result.stdout || '').trim()}`);
  const text = String(result.stdout || '').trim();
  try { return JSON.parse(text); } catch { return { ok: true, raw: text }; }
}
function taipeiDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}
async function main() {
  const startedAt = new Date();
  const date = process.env.SYNC_DATE || taipeiDate(startedAt);
  const env = { ...process.env, SYNC_DATE: date };
  const results = {}, errors = {};
  for (const [key, script] of [
    ['twse', 'cloud_simulator/scripts/sync_twse_mcp_to_drive.js'],
    ['mops', 'cloud_simulator/scripts/sync_mops_mcp_to_drive.js'],
    ['yahooFinance', 'cloud_simulator/scripts/sync_yahoo_mcp_to_drive.js'],
    ['taiwanFinancialNews', 'cloud_simulator/scripts/sync_taiwan_news_mcp_to_drive.js'],
    ['growthCandidatesTop10', 'cloud_simulator/scripts/sync_growth_candidates_to_drive.js']
  ]) {
    try { results[key] = runNode(script, env); } catch (error) { errors[key] = String(error.message || error); }
  }
  const writer = new DrivePrimaryWriter({ parentFolderId: process.env.MCP_DRIVE_PARENT_FOLDER_ID || process.env.TWSE_DRIVE_PARENT_FOLDER_ID || '', folderName: process.env.MCP_DRIVE_AUDIT_FOLDER_NAME || 'MCP_DAILY_SYNC_AUDIT' });
  const ok = Object.keys(errors).length === 0;
  const audit = {
    schemaVersion: 4, generatedAt: new Date().toISOString(), date, ok, policy: POLICY,
    sourceOrder: ['TWSE_MCP_OR_MOPS_MCP', 'GOOGLE_DRIVE_CACHE', 'YAHOO_FINANCE_MCP_SUPPLEMENT', 'TAIWAN_FINANCIAL_NEWS_MCP_LICENSED_ONLY', 'OTHER_PROVIDER_ONLY_IF_PRIMARY_MISSING'],
    derivedProducts: ['GROWTH_CANDIDATES_TOP10'],
    overwriteRule: 'Yahoo Finance, media MCPs and other external providers must never overwrite official TWSE/MOPS rows', results, errors
  };
  const filename = `mcp_daily_sync_${date}.json`;
  const saved = await writer.upsertText(filename, `${JSON.stringify(audit, null, 2)}\n`);
  await writer.upsertText('manifest.json', `${JSON.stringify({ schemaVersion: 4, generatedAt: audit.generatedAt, latestDate: date, latestFile: filename, driveFileId: saved.id, ok, policyMode: POLICY.mode, sources: ['TWSE_MCP', 'MOPS_MCP', 'YAHOO_FINANCE_MCP', 'TAIWAN_FINANCIAL_NEWS_MCP'], derivedProducts: ['GROWTH_CANDIDATES_TOP10'] }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ok, date, filename, driveFileId: saved.id, results, errors }, null, 2)}\n`);
  if (!ok) process.exitCode = 1;
}
if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { runNode, taipeiDate };
