'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { verify: verifyStrategyLock } = require('../scripts/verify_q2_strategy_lock');

function readJson(filePath) {
  if (!fs.existsSync(filePath)) return null;
  try { return JSON.parse(fs.readFileSync(filePath, 'utf8')); }
  catch { return null; }
}
function readJsonl(filePath) {
  if (!fs.existsSync(filePath)) return [];
  return fs.readFileSync(filePath, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}
function unique(values) { return [...new Set(values)]; }
function finiteFactor(row, paths) {
  for (const name of paths) {
    const value = name.split('.').reduce((obj, key) => obj?.[key], row);
    if (value !== '' && value != null && Number.isFinite(Number(value))) return true;
  }
  return false;
}

function auditQ2BacktestReadiness(options = {}) {
  const root = path.resolve(options.root || 'data/backtest');
  const twseDir = path.resolve(options.twseDir || path.join(root, 'twse-q2-mcp'));
  const pitDir = path.resolve(options.pitDir || path.join(root, 'q2-point-in-time'));
  const mopsDir = path.resolve(options.mopsDir || path.join(root, 'q2-mops-point-in-time'));
  const intradayDir = path.resolve(options.intradayDir || path.join(root, '2026Q2/intraday'));
  const warmupDir = path.resolve(options.warmupDir || path.join(root, '2026Q2/twse-daily-warmup'));

  const twseManifest = readJson(path.join(twseDir, 'manifest.json'));
  const pitManifest = readJson(path.join(pitDir, 'manifest.json'));
  const mopsManifest = readJson(path.join(mopsDir, 'manifest.json'));
  const factorManifest = readJson(path.join(mopsDir, 'historical_factors_manifest.json'));
  const intradayManifest = readJson(path.join(intradayDir, 'manifest.json'));
  const warmupManifest = readJson(path.join(warmupDir, 'manifest.json'));
  const factorFile = path.join(mopsDir, 'q2_pit_with_factors.jsonl');
  const baseFile = path.join(mopsDir, 'q2_pit_with_mops.jsonl');
  const pitRows = readJsonl(fs.existsSync(factorFile) ? factorFile : baseFile);
  const strategyLock = verifyStrategyLock(options.repoRoot || process.cwd());

  const tradingDates = unique(pitRows.map(row => row.tradeDate)).sort();
  const symbols = unique(pitRows.map(row => String(row.symbol))).sort();
  const countsByDate = new Map();
  for (const row of pitRows) countsByDate.set(row.tradeDate, (countsByDate.get(row.tradeDate) || 0) + 1);
  const top100Complete = tradingDates.length > 0 && tradingDates.every(date => countsByDate.get(date) === 100);
  const institutionalComplete = pitRows.length > 0 && pitRows.every(row => row.availability?.institutional !== false);
  const mopsAvailability = pitRows.length ? pitRows.reduce((sum, row) => sum + (
    row.mopsAvailability?.monthlyRevenue
    && row.mopsAvailability?.quarterlyFinancials
    && row.mopsAvailability?.majorMessagesQueryable !== false ? 1 : 0
  ), 0) / pitRows.length : 0;

  const completeFactors = pitRows.filter(row => row.historicalFactors?.complete === true
    && finiteFactor(row, ['historicalFactors.fundamentalScore'])
    && finiteFactor(row, ['historicalFactors.officialNewsScore']));
  const factorCoverage = pitRows.length ? completeFactors.length / pitRows.length : 0;
  const factorQuality = completeFactors.length
    ? completeFactors.reduce((sum, row) => sum + Number(row.historicalFactors?.reconstructionQuality || 0), 0) / completeFactors.length : 0;
  const factorMaterializationComplete = Boolean(factorManifest?.status === 'COMPLETE'
    && Number(factorManifest?.blockerRows || 0) === 0 && factorCoverage === 1 && factorQuality >= 0.75);

  const completeWarmupSymbols = new Set(warmupManifest?.completeSymbols || []);
  const warmupCoverage = symbols.length ? symbols.filter(symbol => completeWarmupSymbols.has(symbol)).length / symbols.length : 0;
  const warmupFilesComplete = symbols.length > 0 && symbols.every(symbol => fs.existsSync(path.join(warmupDir, `${symbol}.json`)));
  const completeIntradaySymbols = new Set(intradayManifest?.completeSymbols || []);
  const intradayCoverage = symbols.length ? symbols.filter(symbol => completeIntradaySymbols.has(symbol)).length / symbols.length : 0;
  const intradayFilesComplete = symbols.length > 0 && symbols.every(symbol => ['1m', '5m', '15m'].every(interval => fs.existsSync(path.join(intradayDir, interval, `${symbol}.csv.gz`))));

  const gates = {
    strategyFrozen: strategyLock.passed,
    twseDownloaded: Boolean(twseManifest && Number(twseManifest.tradingDayCount || 0) > 0 && Number(twseManifest.requestFailureCount || 0) === 0),
    top100PointInTime: Boolean(pitManifest?.pointInTime?.enabled && pitManifest?.pointInTime?.sameSessionUseForbidden && top100Complete),
    institutionalComplete,
    mopsPointInTime: Boolean(mopsManifest?.pointInTimeRule && mopsAvailability >= 0.98),
    historicalFactorsComplete: factorMaterializationComplete,
    dailyWarmupComplete: Boolean(warmupManifest?.status === 'complete' && warmupCoverage === 1 && warmupFilesComplete),
    intradayComplete: Boolean(intradayManifest?.status === 'complete' && intradayCoverage === 1 && intradayFilesComplete),
    futureLeakageForbidden: Boolean(pitManifest?.pointInTime?.sameSessionUseForbidden
      && /No future|only MOPS records/i.test(String(mopsManifest?.pointInTimeRule || ''))
      && /forbidden/i.test(String(intradayManifest?.policy?.futureLeakage || '')))
  };

  const restorationScore = Math.round(((gates.strategyFrozen ? 5 : 0)
    + (gates.twseDownloaded ? 10 : 0)
    + (gates.top100PointInTime ? 10 : 0)
    + (gates.institutionalComplete ? 10 : 0)
    + Math.min(1, mopsAvailability) * 10
    + Math.min(1, factorCoverage) * Math.min(1, factorQuality) * 15
    + Math.min(1, warmupCoverage) * 10
    + Math.min(1, intradayCoverage) * 20
    + (gates.futureLeakageForbidden ? 10 : 0)) * 10) / 10;

  const blockers = Object.entries(gates).filter(([, passed]) => !passed).map(([name]) => name);
  return {
    generatedAt: new Date().toISOString(),
    period: { start: '2026-04-01', end: '2026-06-30' },
    policy: {
      strategyFrozen: strategyLock.passed,
      lockedAtCommit: strategyLock.lockedAtCommit,
      predictionForbidden: true,
      futureLeakageForbidden: true,
      dataSource: 'TWSE_MCP_PRIMARY',
      factorMaterialization: 'explicit historical values preferred; deterministic MOPS point-in-time reconstruction accepted at 0.75 fidelity',
      resultMustNotBePublishedWhenStrictGateFails: true
    },
    counts: {
      tradingDays: tradingDates.length,
      pointInTimeRows: pitRows.length,
      symbols: symbols.length,
      mopsAvailabilityPct: Math.round(mopsAvailability * 10000) / 100,
      historicalFactorCoveragePct: Math.round(factorCoverage * 10000) / 100,
      historicalFactorQualityPct: Math.round(factorQuality * 10000) / 100,
      historicalFactorBlockers: Number(factorManifest?.blockerRows || 0),
      dailyWarmupCoveragePct: Math.round(warmupCoverage * 10000) / 100,
      intradayCoveragePct: Math.round(intradayCoverage * 10000) / 100
    },
    strategyLock: { passed: strategyLock.passed, changedFiles: strategyLock.changedFiles },
    gates,
    blockers,
    restorationScore,
    targetReached: restorationScore >= 85 && blockers.length === 0,
    interpretation: 'restorationScore measures historical replay fidelity, not future-profit probability.'
  };
}

module.exports = { auditQ2BacktestReadiness, readJson, readJsonl };
