'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { isMajorInternationalEvent, newsScopeDecision, scoreTaiwanMedia } = require('../src/news');

const now = new Date('2026-09-03T12:00:00+08:00');

function media(overrides = {}) {
  return {
    source: '中央通訊社', acquisitionMethod: 'MANUAL', title: '公司接獲新訂單',
    url: 'https://example.com/a', publishedAt: '2026-09-03T09:00:00+08:00',
    eventKey: 'evt-1', sentiment: 'POSITIVE', ...overrides
  };
}

test('ordinary news outside Top100 is suppressed from alerts and scoring', () => {
  const item = media({ top100Related: false, riskLevel: 'MEDIUM' });
  assert.equal(newsScopeDecision(item).eligible, false);
  const scored = scoreTaiwanMedia([item], [], now);
  assert.equal(scored.acceptedCount, 0);
  assert.equal(scored.suppressedCount, 1);
  assert.equal(scored.modifier, 0);
});

test('Top100-related news remains eligible for corroborated scoring', () => {
  const rows = [
    media({ top100Related: true, source: '中央通訊社', url: 'https://example.com/a' }),
    media({ top100Related: true, source: '經濟日報', acquisitionMethod: 'MANUAL', url: 'https://example.com/b' })
  ];
  const scored = scoreTaiwanMedia(rows, [], now);
  assert.equal(scored.acceptedCount, 2);
  assert.ok(scored.modifier > 0);
  assert.ok(scored.evidence.some(row => row.scored && row.scope === 'TOP100_RELATED'));
});

test('major international event is eligible even when unrelated to a specific Top100 stock', () => {
  const rows = [
    media({ eventKey: 'global-war', top100Related: false, marketScope: 'GLOBAL', riskLevel: 'HIGH', title: 'Major war escalation triggers energy shock', sentiment: 'NEGATIVE', source: '中央通訊社', url: 'https://example.com/g1' }),
    media({ eventKey: 'global-war', top100Related: false, marketScope: 'GLOBAL', riskLevel: 'HIGH', title: 'Major war escalation triggers energy shock', sentiment: 'NEGATIVE', source: '經濟日報', acquisitionMethod: 'MANUAL', url: 'https://example.com/g2' })
  ];
  assert.equal(isMajorInternationalEvent(rows[0]), true);
  const scored = scoreTaiwanMedia(rows, [], now);
  assert.equal(scored.acceptedCount, 2);
  assert.ok(scored.modifier < 0);
  assert.ok(scored.evidence.some(row => row.scored && row.scope === 'GLOBAL_MAJOR_EVENT'));
});
