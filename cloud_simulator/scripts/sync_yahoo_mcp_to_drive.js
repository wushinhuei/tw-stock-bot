'use strict';

const { callTool } = require('../src/yahoo_mcp');
const { DrivePrimaryWriter } = require('../src/drive_primary_writer');

const DEFAULT_SYMBOLS = Object.freeze(['^GSPC', '^IXIC', '^DJI', '^SOX', '^VIX', 'TWD=X', 'CL=F', 'GC=F']);

function taipeiDate(now = new Date()) {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit'
  }).format(now);
}

function configuredSymbols() {
  const raw = String(process.env.YAHOO_MCP_SYMBOLS || '').trim();
  const symbols = raw ? raw.split(',').map(value => value.trim()).filter(Boolean) : [...DEFAULT_SYMBOLS];
  return [...new Set(symbols)];
}

async function main() {
  const date = process.env.SYNC_DATE || taipeiDate();
  const symbols = configuredSymbols();
  const writer = new DrivePrimaryWriter({
    parentFolderId: process.env.YAHOO_DRIVE_PARENT_FOLDER_ID || process.env.MCP_DRIVE_PARENT_FOLDER_ID || process.env.TWSE_DRIVE_PARENT_FOLDER_ID || '',
    folderName: process.env.YAHOO_DRIVE_FOLDER_NAME || 'YAHOO_FINANCE_MCP_SUPPLEMENT'
  });

  const results = {};
  const errors = {};
  for (const symbol of symbols) {
    try {
      results[symbol] = await callTool('yahoo_chart', {
        symbol,
        range: process.env.YAHOO_MCP_DAILY_RANGE || '1y',
        interval: '1d'
      });
    } catch (error) {
      errors[symbol] = String(error.message || error);
    }
  }

  const payload = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    date,
    sourcePolicy: 'YAHOO_FINANCE_MCP_SUPPLEMENT_ONLY',
    authoritative: false,
    overwriteRule: 'Yahoo Finance MCP must never overwrite official TWSE/MOPS rows',
    symbols,
    results,
    errors
  };

  const filename = `yahoo_mcp_${date}.json`;
  const saved = await writer.upsertText(filename, `${JSON.stringify(payload, null, 2)}\n`);
  await writer.upsertText('manifest.json', `${JSON.stringify({
    schemaVersion: 1,
    generatedAt: payload.generatedAt,
    latestDate: date,
    latestFile: filename,
    driveFileId: saved.id,
    primarySource: 'YAHOO_FINANCE_MCP',
    supplementalOnly: true,
    symbolCount: symbols.length,
    successCount: Object.keys(results).length,
    errorCount: Object.keys(errors).length
  }, null, 2)}\n`);

  process.stdout.write(`${JSON.stringify({
    ok: Object.keys(errors).length === 0,
    date,
    filename,
    driveFileId: saved.id,
    successCount: Object.keys(results).length,
    errorCount: Object.keys(errors).length,
    errors
  }, null, 2)}\n`);
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { DEFAULT_SYMBOLS, configuredSymbols, taipeiDate };
