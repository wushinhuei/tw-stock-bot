'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { aggregateStockBars, handleMcpMessage, stockDaily } = require('../src/twse_mcp_history');

function mockFetch(payloads) {
  let index = 0;
  return async () => ({
    ok: true,
    status: 200,
    async json() { return payloads[Math.min(index++, payloads.length - 1)]; }
  });
}

test('MCP tools/list exposes TWSE historical read-only tools', async () => {
  const response = await handleMcpMessage({ jsonrpc: '2.0', id: 1, method: 'tools/list', params: {} });
  assert.equal(response.result.tools.some(tool => tool.name === 'twse_stock_daily'), true);
  assert.equal(response.result.tools.some(tool => tool.name === 'twse_stock_weekly'), true);
  assert.equal(response.result.tools.some(tool => tool.name === 'twse_stock_monthly'), true);
  assert.equal(response.result.tools.some(tool => tool.name === 'twse_stock_quarterly'), true);
  assert.equal(response.result.tools.some(tool => tool.name === 'twse_market_daily'), true);
  assert.equal(response.result.tools.some(tool => tool.name === 'twse_institutional_daily'), true);
  assert.equal(response.result.tools.some(tool => tool.name === 'twse_margin_daily'), true);
});

test('weekly and monthly bars aggregate official daily OHLCV consistently', () => {
  const rows = [
    { tradeDate: '2026-03-30', symbol: '2330', open: 100, high: 105, low: 99, close: 104, volume: 10, value: 1000, transactions: 2 },
    { tradeDate: '2026-03-31', symbol: '2330', open: 104, high: 108, low: 103, close: 107, volume: 20, value: 2100, transactions: 3 },
    { tradeDate: '2026-04-01', symbol: '2330', open: 107, high: 109, low: 101, close: 102, volume: 30, value: 3100, transactions: 4 },
    { tradeDate: '2026-04-06', symbol: '2330', open: 103, high: 110, low: 102, close: 109, volume: 40, value: 4200, transactions: 5 }
  ];
  const weekly = aggregateStockBars(rows, 'week');
  assert.deepEqual(weekly.map(row => row.periodStart), ['2026-03-30', '2026-04-06']);
  assert.deepEqual(weekly[0], {
    periodStart: '2026-03-30', periodEnd: '2026-04-01', tradeDate: '2026-04-01', symbol: '2330',
    open: 100, high: 109, low: 99, close: 102, volume: 60, value: 6200, transactions: 9, tradingDays: 3
  });
  const monthly = aggregateStockBars(rows, 'month');
  assert.equal(monthly[0].periodStart, '2026-03-01');
  assert.equal(monthly[0].open, 100);
  assert.equal(monthly[0].close, 107);
  assert.equal(monthly[0].volume, 30);
  assert.equal(monthly[1].periodStart, '2026-04-01');
  assert.equal(monthly[1].high, 110);
  const quarterly = aggregateStockBars(rows, 'quarter');
  assert.equal(quarterly.length, 2);
  assert.equal(quarterly[0].periodStart, '2026-01-01');
  assert.equal(quarterly[0].close, 107);
  assert.equal(quarterly[1].periodStart, '2026-04-01');
  assert.equal(quarterly[1].close, 109);
});

test('stockDaily converts ROC dates and filters requested period', async () => {
  const payload = {
    stat: 'OK',
    fields: ['日期', '成交股數', '成交金額', '開盤價', '最高價', '最低價', '收盤價', '漲跌價差', '成交筆數'],
    data: [
      ['115/04/01', '10,000', '1,000,000', '100', '105', '99', '104', '+4', '500'],
      ['115/04/02', '12,000', '1,260,000', '104', '107', '103', '105', '+1', '600']
    ]
  };
  const result = await stockDaily('2330.TW', '2026-04-02', '2026-04-02', { fetchImpl: mockFetch([payload]) });
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].tradeDate, '2026-04-02');
  assert.equal(result.rows[0].symbol, '2330');
  assert.equal(result.rows[0].close, 105);
});

test('TWSE requests retry transient network failures', async () => {
  let attempts = 0;
  const payload = { stat: 'OK', fields: [], data: [] };
  const result = await stockDaily('2330', '2026-04-01', '2026-04-01', {
    retries: 2,
    retryDelayMs: 0,
    fetchImpl: async () => {
      attempts += 1;
      if (attempts === 1) throw new TypeError('fetch failed');
      return { ok: true, status: 200, async json() { return payload; } };
    }
  });
  assert.equal(attempts, 2);
  assert.equal(result.rows.length, 0);
});

test('MCP tools/call returns structured TWSE result', async () => {
  const payload = {
    stat: 'OK',
    fields: ['日期', '成交股數', '成交金額', '開盤價', '最高價', '最低價', '收盤價', '漲跌價差', '成交筆數'],
    data: [['115/04/01', '10,000', '1,000,000', '100', '105', '99', '104', '+4', '500']]
  };
  const response = await handleMcpMessage({
    jsonrpc: '2.0', id: 2, method: 'tools/call',
    params: { name: 'twse_stock_daily', arguments: { symbol: '2330', start: '2026-04-01', end: '2026-04-01' } }
  }, { fetchImpl: mockFetch([payload]) });
  assert.equal(response.result.isError, false);
  assert.equal(response.result.structuredContent.rows[0].close, 104);

  for (const name of ['twse_stock_weekly', 'twse_stock_monthly', 'twse_stock_quarterly']) {
    const aggregateResponse = await handleMcpMessage({
      jsonrpc: '2.0', id: name, method: 'tools/call',
      params: { name, arguments: { symbol: '2330', start: '2026-04-01', end: '2026-04-01' } }
    }, { fetchImpl: mockFetch([payload]) });
    assert.equal(aggregateResponse.result.isError, false);
    assert.equal(aggregateResponse.result.structuredContent.rows[0].close, 104);
    assert.equal(aggregateResponse.result.structuredContent.rows[0].tradingDays, 1);
  }
});
