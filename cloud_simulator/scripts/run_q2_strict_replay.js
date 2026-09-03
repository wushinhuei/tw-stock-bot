'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { runStrictReplay } = require('../src/q2_strict_replay');
const { verify: verifyStrategyLock } = require('./verify_q2_strategy_lock');

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
}
function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, rows.map(row => JSON.stringify(row)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
}

function main() {
  const lock = verifyStrategyLock(process.cwd());
  if (!lock.passed) throw new Error(`Q2 strategy lock failed: ${lock.changedFiles.join(', ')}`);
  const result = runStrictReplay({
    root: process.env.Q2_BACKTEST_ROOT || 'data/backtest',
    slippagePct: Number(process.env.Q2_REPLAY_SLIPPAGE_PCT || 0.0015)
  });
  const output = path.resolve(process.env.Q2_REPLAY_OUTPUT || 'data/backtest/2026Q2/result');
  writeJson(path.join(output, 'summary.json'), { ...result, tradeLog: undefined, equityCurve: undefined });
  writeJsonl(path.join(output, 'trades.jsonl'), result.tradeLog || []);
  writeJsonl(path.join(output, 'equity_curve.jsonl'), result.equityCurve || []);
  process.stdout.write(`${JSON.stringify({
    status: 'COMPLETE', period: result.period, initialCapital: result.initialCapital,
    finalEquity: result.finalEquity, returnPct: result.returnPct, maxDrawdownPct: result.maxDrawdownPct,
    tradeCount: result.tradeCount, winRate: result.winRate, profitFactor: result.profitFactor,
    restorationScore: result.restorationScore, output
  }, null, 2)}\n`);
}

if (require.main === module) {
  try { main(); }
  catch (error) {
    process.stderr.write(`${JSON.stringify({
      status: 'BLOCKED', code: error.code || 'Q2_REPLAY_ERROR', error: String(error.message || error),
      readiness: error.readiness || null, factorBlockers: error.factorBlockers || null
    }, null, 2)}\n`);
    process.exitCode = 2;
  }
}
