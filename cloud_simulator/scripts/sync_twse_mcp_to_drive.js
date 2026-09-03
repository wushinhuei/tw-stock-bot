'use strict';

const { callTool } = require('../src/twse_mcp_history');
const { DrivePrimaryWriter } = require('../src/drive_primary_writer');

function taipeiDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

async function main() {
  const date = process.env.SYNC_DATE || taipeiDate();
  const writer = new DrivePrimaryWriter();
  const [market, institutional, margin] = await Promise.all([
    callTool('twse_market_daily', { date }),
    callTool('twse_institutional_daily', { date }),
    callTool('twse_margin_daily', { date })
  ]);

  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    tradeDate: date,
    sourcePolicy: 'TWSE_MCP_PRIMARY',
    fallbackUsed: false,
    market,
    institutional,
    margin
  };

  const filename = `twse_primary_${date}.json`;
  const saved = await writer.upsertText(filename, `${JSON.stringify(payload, null, 2)}\n`);
  const manifest = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    latestTradeDate: date,
    primarySource: 'TWSE_MCP',
    fallbackPolicy: 'Only when TWSE MCP has no usable data',
    latestFile: filename,
    driveFileId: saved.id
  };
  await writer.upsertText('manifest.json', `${JSON.stringify(manifest, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ok: true, date, filename, driveFileId: saved.id }, null, 2)}\n`);
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { taipeiDate };
