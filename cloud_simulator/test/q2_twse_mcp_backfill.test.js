'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  auditTradingDay,
  buildTop100,
  isListedCommonStock,
  weekdaysBetween
} = require('../scripts/backfill_q2_twse_mcp');

test('listed common-stock filter excludes ETF-like 00xx symbols and invalid rows', () => {
  assert.equal(isListedCommonStock({ symbol: '2330', volume: 1000, close: 100 }), true);
  assert.equal(isListedCommonStock({ symbol: '0050', volume: 1000, close: 100 }), false);
  assert.equal(isListedCommonStock({ symbol: '2330', volume: 0, close: 100 }), false);
  assert.equal(isListedCommonStock({ symbol: '2330', volume: 1000, close: null }), false);
});

test('buildTop100 ranks official daily rows by traded volume', () => {
  const rows = [
    { symbol: '2330', name: 'A', volume: 100, close: 10 },
    { symbol: '2317', name: 'B', volume: 300, close: 20 },
    { symbol: '2454', name: 'C', volume: 200, close: 30 },
    { symbol: '0050', name: 'ETF', volume: 9999, close: 40 }
  ];
  const result = buildTop100(rows, 2);
  assert.deepEqual(result.map(row => row.symbol), ['2317', '2454']);
  assert.deepEqual(result.map(row => row.volumeRank), [1, 2]);
});

test('auditTradingDay reports institutional and margin availability separately', () => {
  const bundle = {
    date: '2026-04-01',
    market: { rows: [
      { symbol: '2330', name: '台積電', volume: 200, close: 100, open: 99, high: 101, low: 98 },
      { symbol: '2317', name: '鴻海', volume: 100, close: 50, open: 49, high: 51, low: 48 }
    ] },
    institutional: { status: 'OK', rows: [{ symbol: '2330', institutionalTotalNet: 10 }] },
    margin: { status: 'OK', rows: [{ symbol: '2317', marginCurrentBalance: 20 }] }
  };
  const audit = auditTradingDay(bundle);
  assert.deepEqual(audit.missingInstitutional, ['2317']);
  assert.deepEqual(audit.missingMargin, ['2330']);
  assert.equal(audit.rows[0].institutionalAvailable, true);
  assert.equal(audit.rows[0].marginAvailable, false);
});

test('weekdaysBetween excludes weekends', () => {
  assert.deepEqual(weekdaysBetween('2026-04-03', '2026-04-06'), ['2026-04-03', '2026-04-06']);
});
