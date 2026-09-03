'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPointInTimeRow, compareRow, near } = require('../scripts/build_q2_point_in_time_dataset');

test('near compares numeric strings and numbers', () => {
  assert.equal(near('100.0', 100), true);
  assert.equal(near(100, 101), false);
  assert.equal(near(null, 100), null);
});

test('compareRow checks TWSE MCP against Drive aliases', () => {
  const mcp = {
    open: 100, high: 105, low: 99, close: 104, volume: 123456,
    institutional: { institutionalTotalNet: 1000, foreignNet: 800, investmentTrustNet: 200 },
    margin: { marginCurrentBalance: 5000, shortCurrentBalance: 300 }
  };
  const daily = { open: '100', high: '105', low: '99', close: '104', trade_volume: '123456' };
  const flow = {
    institutional_total_net: '1000', foreign_net: '800', investment_trust_net: '200',
    margin_current_balance: '5000', short_current_balance: '300'
  };
  const result = compareRow(mcp, daily, flow);
  assert.equal(result.mismatches, 0);
  assert.ok(result.checked >= 10);
});

test('point-in-time row forbids same-session use', () => {
  const row = buildPointInTimeRow({
    tradeDate: '2026-04-01', volumeRank: 1, symbol: '2330', name: '台積電',
    open: 100, high: 105, low: 99, close: 104, volume: 123456, value: 1,
    transactions: 10, closingBid: 103.5, closingAsk: 104, pe: 20,
    institutionalAvailable: true, marginAvailable: true,
    institutional: { institutionalTotalNet: 1000 }, margin: { marginCurrentBalance: 5000 }
  }, { trade_date: '2026-04-01', stock_code: '2330', open: 100, high: 105, low: 99, close: 104, trade_volume: 123456 },
  { trade_date: '2026-04-01', stock_code: '2330', institutional_total_net: 1000, margin_current_balance: 5000 });
  assert.equal(row.sourceAvailableAt, '2026-04-01T20:30:00+08:00');
  assert.equal(row.usableFrom, 'NEXT_TRADING_SESSION');
  assert.equal(row.provenance.primary, 'TWSE_MCP_OFFICIAL');
});
