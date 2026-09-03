'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { auditQ2BacktestReadiness } = require('../src/q2_backtest_readiness');
const { probe } = require('./probe_q2_intraday_source');

function readJson(file) {
  if (!fs.existsSync(file)) return null;
  try { return JSON.parse(fs.readFileSync(file, 'utf8')); } catch { return null; }
}
function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}

function blockerCodeFor(readiness, intraday) {
  const gates = readiness?.gates || {};
  const upstreamBlocked = [
    'twseDownloaded', 'top100PointInTime', 'institutionalComplete',
    'mopsPointInTime', 'historicalFactorsComplete', 'dailyWarmupComplete'
  ].some(name => gates[name] === false);
  const intradayBlocked = intraday?.status === 'BLOCKED';
  if (upstreamBlocked && intradayBlocked) return 'BLOCKED_MULTIPLE_DATA_SOURCES';
  if (upstreamBlocked) return 'BLOCKED_UPSTREAM_DATA_INCOMPLETE';
  if (intradayBlocked) return 'BLOCKED_INTRADAY_DATA_UNAVAILABLE';
  return 'BLOCKED_STRICT_READINESS_GATE';
}

function buildStatus(options = {}) {
  const root = path.resolve(options.root || process.env.Q2_BACKTEST_ROOT || 'data/backtest');
  const resultDir = path.resolve(options.resultDir || process.env.Q2_REPLAY_OUTPUT || path.join(root, '2026Q2/result'));
  const summary = readJson(path.join(resultDir, 'summary.json'));
  if (summary && Number.isFinite(Number(summary.returnPct))) {
    return {
      generatedAt: new Date().toISOString(),
      status: 'COMPLETE',
      publishable: true,
      period: summary.period,
      result: {
        initialCapital: summary.initialCapital,
        finalEquity: summary.finalEquity,
        returnPct: summary.returnPct,
        maxDrawdownPct: summary.maxDrawdownPct,
        tradeCount: summary.tradeCount,
        winRate: summary.winRate,
        profitFactor: summary.profitFactor,
        restorationScore: summary.restorationScore
      },
      policy: summary.policy
    };
  }

  let readiness;
  try { readiness = auditQ2BacktestReadiness({ root }); }
  catch (error) { readiness = { targetReached: false, blockers: ['READINESS_ARTIFACTS_NOT_COMPLETE'], error: String(error.message || error) }; }
  const intraday = probe({ root });
  const blockers = [...new Set([...(readiness.blockers || []), ...(intraday.status === 'BLOCKED' ? ['intradayHistoricalDataUnavailable'] : [])])];
  return {
    generatedAt: new Date().toISOString(),
    status: 'BLOCKED',
    publishable: false,
    period: { start: '2026-04-01', end: '2026-06-30' },
    result: null,
    blockerCode: blockerCodeFor(readiness, intraday),
    blockers,
    readiness,
    intraday,
    policy: {
      marketData: 'TWSE_MCP_PRIMARY',
      fundamentalsAndAnnouncements: 'MOPS_MCP_PRIMARY',
      googleDrive: 'official cache and persistence',
      strategyFrozen: true,
      futureLeakageForbidden: true,
      dailyOnlyApproximationMayNotBePublishedAsStrictQ2Return: true
    }
  };
}

function main() {
  const root = path.resolve(process.env.Q2_BACKTEST_ROOT || 'data/backtest');
  const status = buildStatus({ root });
  const output = path.resolve(process.env.Q2_STATUS_OUTPUT || path.join(root, '2026Q2/result/status.json'));
  writeJson(output, status);
  process.stdout.write(`${JSON.stringify(status, null, 2)}\n`);
  if (!status.publishable) process.exitCode = 2;
}

if (require.main === module) main();
module.exports = { blockerCodeFor, buildStatus, readJson, writeJson };
