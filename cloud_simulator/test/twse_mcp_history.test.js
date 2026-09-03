'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { handleMcpMessage, stockDaily } = require('../src/twse_mcp_history');

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
  assert.equal(response.result.tools.some(tool => tool.name === 'twse_market_daily'), true);
  assert.equal(response.result.tools.some(tool => tool.name === 'twse_institutional_daily'), true);
  assert.equal(response.result.tools.some(tool => tool.name === 'twse_margin_daily'), true);
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
});
