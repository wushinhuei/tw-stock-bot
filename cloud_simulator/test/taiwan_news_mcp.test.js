'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { TaiwanNewsMcp, normalizeItem, validateConfiguredEndpoint, SOURCES } = require('../src/taiwan_news_mcp');

test('Taiwan financial news MCP exposes Economic Daily and Commercial Times as licensed sources', () => {
  assert.equal(SOURCES.UDN_ECONOMIC_DAILY.source, '經濟日報');
  assert.equal(SOURCES.CTEE.source, '工商時報');
  assert.equal(validateConfiguredEndpoint('CTEE', '').enabled, false);
});

test('Taiwan financial news MCP suppresses ordinary news outside Top100', async () => {
  const service = new TaiwanNewsMcp({
    udnEndpoint: 'https://licensed.example.test/udn',
    fetchImpl: async () => ({ ok: true, json: async () => ({ items: [{ title: '一般產業消息', url: 'https://money.udn.com/a', publishedAt: '2026-09-03T08:00:00+08:00', top100Related: false }] }) })
  });
  const result = (await service.callTool('taiwan_financial_news', { source: 'UDN_ECONOMIC_DAILY' })).structuredContent;
  assert.equal(result.rows.length, 0);
});

test('Taiwan financial news MCP keeps Top100-related news metadata', async () => {
  const service = new TaiwanNewsMcp({
    cteeEndpoint: 'https://licensed.example.test/ctee',
    fetchImpl: async () => ({ ok: true, json: async () => ({ items: [{ title: '2330 接單展望改善', url: 'https://ctee.com.tw/a', publishedAt: '2026-09-03T08:00:00+08:00', top100Related: true, relatedSymbols: ['2330'] }] }) })
  });
  const result = (await service.callTool('taiwan_financial_news', { source: 'CTEE' })).structuredContent;
  assert.equal(result.rows.length, 1);
  assert.equal(result.rows[0].source, '工商時報');
  assert.equal(result.rows[0].reason, 'TOP100_RELATED');
});

test('Taiwan financial news MCP keeps major global events even without a stock symbol', () => {
  const item = normalizeItem({ title: 'Fed emergency rate hike after global financial shock', url: 'https://money.udn.com/global', publishedAt: '2026-09-03T08:00:00+08:00', marketScope: 'GLOBAL' }, SOURCES.UDN_ECONOMIC_DAILY);
  assert.equal(item.eligible, true);
  assert.equal(item.reason, 'GLOBAL_MAJOR_EVENT');
});
