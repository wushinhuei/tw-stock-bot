'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { rankGrowthCandidates, scoreNews } = require('../src/growth_candidates');

function revenue(symbol, month, yoy) {
  return { symbol, fiscal_year: 2026, month, raw: { '去年同月增減(%)': yoy, '當月營收': 1000 + month } };
}
function financial(symbol, values = {}) {
  const facts = Object.entries({ net_income: 100, operating_income: 120, operating_cash_flow: 90, assets: 1000, liabilities: 350, ...values })
    .map(([metric, value]) => ({ metric, value, end_date: '2026-06-30' }));
  return { symbol, facts };
}
function media(source, symbol, eventKey, sentiment = 'POSITIVE') {
  return { source, relatedSymbols: [symbol], eventKey, sentiment, title: sentiment === 'POSITIVE' ? '公司取得新訂單並擴產' : '公司下修展望', publishedAt: '2026-09-01T08:00:00+08:00' };
}

test('single media source does not affect high-growth news score', () => {
  const base = scoreNews([]).score;
  const scored = scoreNews([media('經濟日報', '2330', 'e1')]);
  assert.equal(scored.score, base);
  assert.equal(scored.verifiedEvents, 0);
  assert.equal(scored.evidence[0].reason, 'SINGLE_SOURCE_UNVERIFIED');
});

test('two independent sources corroborating same event can affect growth score', () => {
  const scored = scoreNews([media('經濟日報', '2330', 'e1'), media('工商時報', '2330', 'e1')]);
  assert.equal(scored.verifiedEvents, 1);
  assert.ok(scored.score > 15);
});

test('official MOPS event counts as verified without second media source', () => {
  const scored = scoreNews([{ source: 'MOPS_OFFICIAL', relatedSymbols: ['2330'], eventKey: 'm1', title: '取得重大訂單', publishedAt: '2026-09-01T08:00:00+08:00' }]);
  assert.equal(scored.verifiedEvents, 1);
  assert.ok(scored.score > 15);
});

test('ranking prefers stronger fundamentals and corroborated news', () => {
  const monthlyRevenue = [
    revenue('1111', 8, 42), revenue('1111', 7, 25),
    revenue('2222', 8, 8), revenue('2222', 7, 7)
  ];
  const quarterlyFinancials = [financial('1111'), financial('2222', { liabilities: 800 })];
  const news = [media('經濟日報', '1111', 'g1'), media('工商時報', '1111', 'g1')];
  const ranked = rankGrowthCandidates({ monthlyRevenue, quarterlyFinancials, news, limit: 10 });
  assert.equal(ranked[0].symbol, '1111');
  assert.equal(ranked.length, 2);
  assert.ok(ranked[0].confidence >= ranked[1].confidence);
});

test('hard risk caps a candidate even with strong growth evidence', () => {
  const monthlyRevenue = [revenue('3333', 8, 50), revenue('3333', 7, 30)];
  const quarterlyFinancials = [financial('3333')];
  const officialEvents = [{ source: 'MOPS_OFFICIAL', relatedSymbols: ['3333'], eventKey: 'risk', title: '公司停止交易並有重大不確定事項', publishedAt: '2026-09-01T08:00:00+08:00' }];
  const ranked = rankGrowthCandidates({ monthlyRevenue, quarterlyFinancials, officialEvents });
  assert.equal(ranked[0].hardRisk, true);
  assert.ok(ranked[0].score <= 45);
});
