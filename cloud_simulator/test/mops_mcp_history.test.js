'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { MopsMcpHistory, filterAvailable, filterBySymbol } = require('../src/mops_mcp_history');

test('MOPS MCP exposes read-only historical tools', () => {
  const service = new MopsMcpHistory({ drive: {} });
  const names = service.tools().map(tool => tool.name);
  assert.deepEqual(names, [
    'mops_monthly_revenue',
    'mops_quarterly_financials',
    'mops_major_messages',
    'mops_filing_index'
  ]);
});

test('MOPS MCP filters by symbol and point-in-time availability', () => {
  const rows = [
    { stock_code: '2330', available_from: '2026-05-12T18:30:00+08:00' },
    { stock_code: '2330', available_from: '2026-05-13T08:30:00+08:00' },
    { stock_code: '2317', available_from: '2026-05-12T10:00:00+08:00' }
  ];
  assert.equal(filterBySymbol(rows, '2330').length, 2);
  assert.equal(filterAvailable(filterBySymbol(rows, '2330'), '2026-05-13T08:00:00+08:00').length, 1);
});

test('MOPS MCP callTool returns structured official cached rows', async () => {
  const drive = {
    async mopsRows(dataset, year) {
      assert.equal(dataset, 'monthlyRevenue');
      assert.equal(year, 2026);
      return [{ stock_code: '2330', available_from: '2026-05-10T18:00:00+08:00', value: 1 }];
    }
  };
  const service = new MopsMcpHistory({ drive });
  const result = await service.callTool('mops_monthly_revenue', { year: 2026, symbol: '2330', asOf: '2026-05-11T09:00:00+08:00' });
  assert.equal(result.structuredContent.provider, 'MOPS_MCP');
  assert.equal(result.structuredContent.rows.length, 1);
});
