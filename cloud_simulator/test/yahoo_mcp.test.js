'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TOOLS, callTool } = require('../src/yahoo_mcp');
const { POLICY, yahooPrimary } = require('../src/data_source_policy');
const { DEFAULT_SYMBOLS, configuredSymbols } = require('../scripts/sync_yahoo_mcp_to_drive');

test('Yahoo Finance MCP exposes read-only supplemental tools', () => {
  assert.deepEqual(TOOLS.map(tool => tool.name), ['yahoo_chart', 'yahoo_supplemental_history']);
  assert.equal(POLICY.supplementalMarketPrimary, 'YAHOO_FINANCE_MCP');
  assert.equal(POLICY.yahooFinanceMcpSupplementalOnly, true);
  assert.equal(POLICY.externalProviderMayOverwriteOfficial, false);
  assert.ok(POLICY.fallbackOrder.indexOf('YAHOO_FINANCE_MCP') > POLICY.fallbackOrder.indexOf('GOOGLE_DRIVE_CACHE'));
});

test('Yahoo MCP chart adapter normalizes bars without becoming authoritative', async () => {
  const fetchImpl = async () => ({
    ok: true,
    async json() {
      return {
        chart: {
          error: null,
          result: [{
            timestamp: [1700000000],
            indicators: { quote: [{ open: [10], high: [11], low: [9], close: [10.5], volume: [1000] }] },
            events: {}
          }]
        }
      };
    }
  });
  const result = await callTool('yahoo_chart', { symbol: '^GSPC', range: '1d', interval: '1d' }, { fetchImpl, attempts: 1, baseDelayMs: 0 });
  assert.equal(result.dataSource, 'YAHOO_FINANCE_MCP');
  assert.equal(result.official, false);
  assert.equal(result.supplementalOnly, true);
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].close, 10.5);
});

test('Yahoo Finance MCP daily sync has conservative global-market defaults and supports explicit symbols', () => {
  assert.ok(DEFAULT_SYMBOLS.includes('^GSPC'));
  assert.ok(DEFAULT_SYMBOLS.includes('^SOX'));
  const previous = process.env.YAHOO_MCP_SYMBOLS;
  process.env.YAHOO_MCP_SYMBOLS = '2330.TW,AAPL,2330.TW';
  try { assert.deepEqual(configuredSymbols(), ['2330.TW', 'AAPL']); }
  finally {
    if (previous == null) delete process.env.YAHOO_MCP_SYMBOLS;
    else process.env.YAHOO_MCP_SYMBOLS = previous;
  }
});

test('Yahoo primary helper returns a clearly non-official error envelope on failure', async () => {
  const result = await yahooPrimary('yahoo_chart', { symbol: '^GSPC' }, {
    yahoo: { attempts: 1, baseDelayMs: 0, fetchImpl: async () => { throw new Error('offline'); } }
  });
  assert.equal(result.status, 'ERROR');
  assert.equal(result.dataSource, 'YAHOO_FINANCE_MCP');
  assert.equal(result.official, false);
  assert.equal(result.supplementalOnly, true);
});
