'use strict';

const { MopsMcpHistory } = require('../src/mops_mcp_history');
const { DrivePrimaryWriter } = require('../src/drive_primary_writer');

function taipeiParts(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
  }).formatToParts(now).filter(part => part.type !== 'literal').map(part => [part.type, part.value]));
  return { year: Number(parts.year), month: Number(parts.month), date: `${parts.year}-${parts.month}-${parts.day}` };
}

async function main() {
  const now = new Date();
  const current = taipeiParts(now);
  const year = Number(process.env.MOPS_SYNC_YEAR || current.year);
  const asOf = process.env.MOPS_SYNC_AS_OF || `${current.date}T23:59:59+08:00`;
  const mcp = new MopsMcpHistory();
  const writer = new DrivePrimaryWriter({
    parentFolderId: process.env.MOPS_DRIVE_PARENT_FOLDER_ID || process.env.TWSE_DRIVE_PARENT_FOLDER_ID || '',
    folderName: process.env.MOPS_DRIVE_FOLDER_NAME || 'MOPS_MCP_PRIMARY'
  });

  const tools = [
    ['monthlyRevenue', 'mops_monthly_revenue'],
    ['quarterlyFinancials', 'mops_quarterly_financials'],
    ['majorMessages', 'mops_major_messages'],
    ['filingIndex', 'mops_filing_index']
  ];
  const datasets = {};
  for (const [key, tool] of tools) {
    const result = await mcp.callTool(tool, { year, asOf });
    datasets[key] = result.structuredContent;
  }

  const payload = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    asOf,
    year,
    sourcePolicy: 'MOPS_MCP_PRIMARY',
    fallbackPolicy: 'Google Drive official cache is allowed inside MOPS MCP; non-MOPS providers may only fill unavailable fields',
    datasets
  };
  const filename = `mops_primary_${current.date}.json`;
  const saved = await writer.upsertText(filename, `${JSON.stringify(payload, null, 2)}\n`);
  const counts = Object.fromEntries(Object.entries(datasets).map(([key, value]) => [key, Array.isArray(value?.rows) ? value.rows.length : 0]));
  const manifest = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    latestDate: current.date,
    asOf,
    year,
    primarySource: 'MOPS_MCP',
    latestFile: filename,
    driveFileId: saved.id,
    counts,
    fallbackPolicy: 'Only when MOPS MCP has no usable official data'
  };
  await writer.upsertText('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ok: true, date: current.date, filename, driveFileId: saved.id, counts }, null, 2)}\n`);
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { taipeiParts };
