'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { probe } = require('../scripts/probe_q2_intraday_source');
const { buildStatus } = require('../scripts/q2_result_status');

test('intraday probe blocks when no strict minute archive or configured provider exists', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'q2-probe-'));
  const oldKey = process.env.SJ_API_KEY;
  const oldSecret = process.env.SJ_SEC_KEY;
  const oldProvider = process.env.Q2_INTRADAY_PROVIDER;
  delete process.env.SJ_API_KEY; delete process.env.SJ_SEC_KEY; delete process.env.Q2_INTRADAY_PROVIDER;
  try {
    const result = probe({ root });
    assert.equal(result.status, 'BLOCKED');
    assert.equal(result.policy.dailyOnlyReplayForbidden, true);
  } finally {
    if (oldKey == null) delete process.env.SJ_API_KEY; else process.env.SJ_API_KEY = oldKey;
    if (oldSecret == null) delete process.env.SJ_SEC_KEY; else process.env.SJ_SEC_KEY = oldSecret;
    if (oldProvider == null) delete process.env.Q2_INTRADAY_PROVIDER; else process.env.Q2_INTRADAY_PROVIDER = oldProvider;
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('formal Q2 status publishes an existing strict summary and never substitutes an approximation', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'q2-status-'));
  const resultDir = path.join(root, '2026Q2/result');
  fs.mkdirSync(resultDir, { recursive: true });
  fs.writeFileSync(path.join(resultDir, 'summary.json'), JSON.stringify({
    period: { start: '2026-04-01', end: '2026-06-30' }, initialCapital: 100000,
    finalEquity: 102000, returnPct: 0.02, maxDrawdownPct: -0.03, tradeCount: 10,
    winRate: 0.5, profitFactor: 1.2, restorationScore: 90, policy: { strategyFrozen: true }
  }));
  const status = buildStatus({ root, resultDir });
  assert.equal(status.status, 'COMPLETE');
  assert.equal(status.publishable, true);
  assert.equal(status.result.returnPct, 0.02);
  fs.rmSync(root, { recursive: true, force: true });
});
