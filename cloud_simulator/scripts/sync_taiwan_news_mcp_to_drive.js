'use strict';

const { TaiwanNewsMcp } = require('../src/taiwan_news_mcp');
const { DrivePrimaryWriter } = require('../src/drive_primary_writer');

function taipeiDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
}

async function main() {
  const now = new Date();
  const date = process.env.SYNC_DATE || taipeiDate(now);
  const service = new TaiwanNewsMcp();
  const result = (await service.callTool('taiwan_financial_news', { source: 'ALL' })).structuredContent;
  const writer = new DrivePrimaryWriter({
    parentFolderId: process.env.MCP_DRIVE_PARENT_FOLDER_ID || process.env.TWSE_DRIVE_PARENT_FOLDER_ID || '',
    folderName: process.env.TAIWAN_NEWS_DRIVE_FOLDER_NAME || 'TAIWAN_FINANCIAL_NEWS_MCP'
  });
  const payload = {
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    date,
    sourcePolicy: 'TAIWAN_FINANCIAL_NEWS_MCP_LICENSED_ONLY',
    scoringScope: 'TOP100_RELATED_OR_GLOBAL_MAJOR_ONLY',
    rows: result.rows || [],
    sources: result.sources || [],
    errors: result.errors || []
  };
  const filename = `taiwan_financial_news_${date}.json`;
  const saved = await writer.upsertText(filename, `${JSON.stringify(payload, null, 2)}\n`);
  await writer.upsertText('manifest.json', `${JSON.stringify({
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    latestDate: date,
    latestFile: filename,
    driveFileId: saved.id,
    rowCount: payload.rows.length,
    configuredSources: payload.sources.filter(row => row.status !== 'NOT_CONFIGURED').map(row => row.source),
    policy: payload.sourcePolicy
  }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ok: true, date, filename, driveFileId: saved.id, rowCount: payload.rows.length, sources: payload.sources, errors: payload.errors }, null, 2)}\n`);
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { taipeiDate };
