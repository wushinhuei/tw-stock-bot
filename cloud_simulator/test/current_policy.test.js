'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CONFIG } = require('../src/config');
const { buildUniverse } = require('../src/scanner');
const { SimulationEngine, createAccount } = require('../src/engine');
const { MemoryRepository } = require('../src/repository');
const { gradeWithMedia } = require('../src/scoring');

function strongRow(symbol, volume) {
  const bars = Array.from({ length: 80 }, (_, i) => ({ open: 100 + i * 0.2, high: 101 + i * 0.2, low: 99 + i * 0.2, close: 100.5 + i * 0.2, volume: 1000 + i * 50 }));
  return {
    symbol, volume, market: 'TWSE', securityType: 'COMMON_STOCK', strategy: 'SWING',
    dailyBars: bars, weeklyBars: bars.slice(0, 60), quoteFresh: true,
    chipScore: 1, fundamentalScore: 1, officialNewsScore: 1, liquidityScore: 1, spreadPct: 0.001
  };
}

test('current scanner uses Top100 pool and four-factor Top30 ranking', () => {
  assert.equal(CONFIG.rawVolumeReviewLimit, 100);
  assert.equal(CONFIG.candidateSelectionPoolLimit, 100);
  assert.equal(CONFIG.maxCandidates, 30);
  assert.deepEqual(CONFIG.candidateSelectionWeights, { chip: 0.30, technical: 0.30, fundamental: 0.25, news: 0.15 });
  const rows = Array.from({ length: 120 }, (_, i) => strongRow(String(1100 + i), 100000 - i));
  const selected = buildUniverse(rows);
  assert.equal(selected.length, 30);
  assert.ok(selected.every(row => row.volumeRank <= 100));
});

test('current engine admits A only and rejects legacy B trial entry', () => {
  const engine = new SimulationEngine({ config: CONFIG, repository: new MemoryRepository(), account: createAccount(100000) });
  engine.processCandidates([{ symbol: '2330', grade: 'B', score: 79, strategy: 'SWING', price: 100, askPrice: 100, dataStatus: 'COMPLETE', blockedReasons: [] }],
    { date: '2026-08-25', time: '10:00', signalTimestamp: 'b-entry', marketMode: 'NORMAL' });
  assert.equal(engine.account.orders.length, 0);
});

test('media modifier never promotes a sub-A base score into A', () => {
  assert.notEqual(gradeWithMedia(81, 79, false), 'A');
  assert.equal(gradeWithMedia(81, 80, false), 'A');
});
