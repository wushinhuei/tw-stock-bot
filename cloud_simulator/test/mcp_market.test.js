'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { latestMarketSnapshot, listedCommonStock, mcpLiveQuotes } = require('../src/mcp_market');

test('MCP Top50 source excludes ETF and DR without Drive state', async () => {
  const callTwse = async (tool) => {
    if (tool === 'twse_market_daily') return { rows: [
      { tradeDate: '2026-09-11', symbol: '0050', name: '元大台灣50', volume: 999, close: 50 },
      { tradeDate: '2026-09-11', symbol: '9110', name: '測試-DR', volume: 998, close: 5 },
      { tradeDate: '2026-09-11', symbol: '2330', name: '台積電', volume: 997, close: 1200 }
    ] };
    return { rows: [] };
  };
  const snapshot = await latestMarketSnapshot(new Date('2026-09-11T08:00:00Z'), { callTwse });
  assert.deepEqual(snapshot.rows.map(row => row.symbol), ['2330']);
  assert.equal(listedCommonStock({ symbol: '0050', name: '元大台灣50' }), false);
  assert.equal(snapshot.rows[0].metrics.marketDataSource, 'TWSE_MCP');
});

test('live quote uses TWSE MIS first and Yahoo MCP only for missing symbols', async () => {
  const yahooCalls = [];
  const quotes = await mcpLiveQuotes(['2330', '2303'], {
    callLive: async () => ({ quotes: { '2330': { symbol: '2330', price: 100, bidPrice: 99.5, askPrice: 100, timestamp: '2026-09-11T10:00:00+08:00', provider: 'TWSE MIS' } } }),
    callYahoo: async (_tool, args) => { yahooCalls.push(args.symbol); return { rows: [{ close: 50, timestamp: '2026-09-11T09:59:00+08:00' }] }; }
  });
  assert.equal(quotes['2330'].provider, 'TWSE MIS');
  assert.equal(quotes['2303'].provider, 'Yahoo Finance MCP');
  assert.deepEqual(yahooCalls, ['2303.TW']);
});
