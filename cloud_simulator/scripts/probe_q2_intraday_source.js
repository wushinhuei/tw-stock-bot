'use strict';

const fs = require('node:fs');
const path = require('node:path');

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}

function probe(options = {}) {
  const root = path.resolve(options.root || process.env.Q2_BACKTEST_ROOT || 'data/backtest');
  const intradayRoot = path.resolve(options.intradayRoot || path.join(root, '2026Q2/intraday'));
  const manifest = readJson(path.join(intradayRoot, 'manifest.json'));
  const existingComplete = Boolean(manifest?.status === 'complete' && Array.isArray(manifest?.completeSymbols) && manifest.completeSymbols.length > 0);
  const shioajiConfigured = Boolean(process.env.SJ_API_KEY && process.env.SJ_SEC_KEY);
  const configuredProvider = String(process.env.Q2_INTRADAY_PROVIDER || '').trim().toUpperCase();

  let status = 'BLOCKED';
  let selectedSource = null;
  let reason = 'NO_STRICT_HISTORICAL_INTRADAY_SOURCE_AVAILABLE';
  if (existingComplete) {
    status = 'READY';
    selectedSource = manifest.provider || manifest.source || 'EXISTING_INTRADAY_ARCHIVE';
    reason = 'COMPLETE_INTRADAY_MANIFEST_PRESENT';
  } else if (shioajiConfigured) {
    status = 'ACQUISITION_CONFIGURED';
    selectedSource = 'SHIOAJI';
    reason = 'TWSE_MCP_HAS_NO_PUBLIC_PER_STOCK_MINUTE_HISTORY_AND_SHIOAJI_CREDENTIALS_ARE_CONFIGURED';
  } else if (configuredProvider) {
    status = 'ACQUISITION_CONFIGURED';
    selectedSource = configuredProvider;
    reason = 'EXPLICIT_INTRADAY_PROVIDER_CONFIGURED';
  }

  return {
    generatedAt: new Date().toISOString(),
    period: { start: '2026-04-01', end: '2026-06-30' },
    status,
    selectedSource,
    reason,
    policy: {
      marketPrimary: 'TWSE_MCP',
      fallbackAllowedOnlyForDataTypeUnavailableFromTwse: true,
      dailyOnlyReplayForbidden: true,
      publishReturnWhenBlocked: false
    },
    evidence: {
      intradayManifestPresent: Boolean(manifest),
      intradayManifestStatus: manifest?.status || null,
      completeSymbolCount: Array.isArray(manifest?.completeSymbols) ? manifest.completeSymbols.length : 0,
      shioajiCredentialsConfigured: shioajiConfigured,
      explicitProviderConfigured: Boolean(configuredProvider)
    }
  };
}

function main() {
  const report = probe();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.status === 'BLOCKED') process.exitCode = 2;
}

if (require.main === module) main();
module.exports = { probe, readJson };
