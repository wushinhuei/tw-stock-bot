'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  MopsMcpHistory, conservativeMonthlyAvailability, conservativeQuarterAvailability,
  factsFromRaw, mergeQuarterStatements
} = require('../src/mops_mcp_history');

test('MOPS public fallback uses conservative availability dates', () => {
  assert.equal(conservativeMonthlyAvailability(2026, 4), '2026-05-11T00:00:00+08:00');
  assert.equal(conservativeQuarterAvailability(2025, 4), '2026-04-01T00:00:00+08:00');
  assert.equal(conservativeQuarterAvailability(2026, 1), '2026-05-16T00:00:00+08:00');
});

test('MOPS public statement rows map Chinese financial fields into frozen factor facts', () => {
  const facts = factsFromRaw({
    '營業收入': '1,000', '營業利益（損失）': '120', '本期淨利（淨損）': '80',
    '資產總計': '5,000', '負債總計': '2,000', '營業活動之淨現金流入（流出）': '90'
  });
  const values = Object.fromEntries(facts.map(item => [item.metric, item.value]));
  assert.deepEqual(values, {
    revenue: 1000, operating_income: 120, net_income: 80,
    assets: 5000, liabilities: 2000, operating_cash_flow: 90
  });
});

test('MOPS quarterly public fallback merges statements by symbol and quarter', () => {
  const rows = mergeQuarterStatements(2026, 1, [[
    { stock_code: '2330', stock_name: '台積電', source_url: 'https://mops.twse.com.tw/a', raw: { '營業收入': '1000' } }
  ], [
    { stock_code: '2330', stock_name: '台積電', source_url: 'https://mops.twse.com.tw/b', raw: { '資產總計': '5000', '負債總計': '2000' } }
  ], [
    { stock_code: '2330', stock_name: '台積電', source_url: 'https://mops.twse.com.tw/c', raw: { '營業活動之淨現金流入（流出）': '90' } }
  ]]);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].available_from, '2026-05-16T00:00:00+08:00');
  assert.ok(rows[0].facts.some(item => item.metric === 'assets' && item.value === 5000));
});

test('MOPS MCP falls back to official public query when Drive ADC is unavailable', async () => {
  const calls = [];
  const drive = { async mopsRows() { throw new Error('Could not load default credentials'); } };
  const client = {
    async query(dataset, year, part) {
      calls.push([dataset, year, part]);
      if (dataset === 'majorMessages') return [{ stock_code: '2330', available_from: '2026-04-02T10:00:00+08:00', raw: { 主旨: '測試' } }];
      if (dataset === 'monthlyRevenue' && part === 4) return [{ stock_code: '2330', fiscal_year: 2026, month: 4, available_from: '', raw: { '當月營收': '100' } }];
      return [];
    }
  };
  const mcp = new MopsMcpHistory({ drive, client });
  const messages = await mcp.majorMessages({ year: 2026, symbol: '2330', asOf: '2026-04-03T08:59:59+08:00' });
  assert.equal(messages.source, 'MOPS_PUBLIC_OFFICIAL_FALLBACK');
  assert.equal(messages.rows.length, 1);
  const revenue = await mcp.monthlyRevenue({ year: 2026, symbol: '2330', asOf: '2026-05-12T08:59:59+08:00' });
  assert.equal(revenue.rows.length, 1);
  assert.equal(revenue.rows[0].available_from, '2026-05-11T00:00:00+08:00');
  assert.ok(calls.some(([dataset]) => dataset === 'majorMessages'));
});
