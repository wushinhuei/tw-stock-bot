'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { CONFIG } = require('../src/config');
const { buildUniverse } = require('../src/scanner');
const { SimulationEngine, createAccount } = require('../src/engine');
const { MemoryRepository } = require('../src/repository');
const { gradeWithMedia } = require('../src/scoring');
const { candidateRankingKey, loadHourlyCandidateRanking, selectPremiumEntryCandidates } = require('../src/run_tick_with_holdings');

function strongRow(symbol, volume) {
  const bars = Array.from({ length: 80 }, (_, i) => ({ open: 100 + i * 0.2, high: 101 + i * 0.2, low: 99 + i * 0.2, close: 100.5 + i * 0.2, volume: 1000 + i * 50 }));
  return {
    symbol, volume, market: 'TWSE', securityType: 'COMMON_STOCK', strategy: 'SWING',
    dailyBars: bars, weeklyBars: bars.slice(0, 60), quoteFresh: true,
    chipScore: 1, fundamentalScore: 1, officialNewsScore: 1, liquidityScore: 1, spreadPct: 0.001
  };
}

test('current scanner uses Top50 pool and chip-weighted Top10 ranking', () => {
  assert.equal(CONFIG.rawVolumeReviewLimit, 50);
  assert.equal(CONFIG.candidateSelectionPoolLimit, 50);
  assert.equal(CONFIG.maxCandidates, 10);
  assert.equal(CONFIG.maxOpenPositions, 5);
  assert.equal(CONFIG.minCashReservePct, 0.30);
  assert.deepEqual(CONFIG.strategyCaps, { SWING: 0.50, OVERNIGHT: 0.30, DAY_TRADE: 0.15 });
  assert.deepEqual(CONFIG.candidateSelectionWeights, { chip: 0.50, volume: 0.30, momentum: 0.20 });
  const rows = Array.from({ length: 120 }, (_, i) => strongRow(String(1100 + i), 100000 - i));
  const selected = buildUniverse(rows);
  assert.equal(selected.length, 10);
  assert.ok(selected.every(row => row.volumeRank <= 50));
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

test('new entries stop at five occupied symbols', () => {
  const candidate = { symbol: '9999', grade: 'A', score: 90, dataStatus: 'COMPLETE', blockedReasons: [] };
  const full = { account: { positions: Array.from({ length: 5 }, (_, index) => ({ symbol: String(2000 + index) })), orders: [] } };
  assert.deepEqual(selectPremiumEntryCandidates(full, [candidate]), []);
  const four = { account: { positions: full.account.positions.slice(0, 4), orders: [] } };
  assert.deepEqual(selectPremiumEntryCandidates(four, [candidate]).map(row => row.symbol), ['9999']);
});

test('candidate cache refreshes when old Top100 or Top30 policy is stored', async () => {
  const now = new Date('2026-09-09T02:15:00.000Z');
  const repository = {
    loadState: async () => ({
      candidateRanking: { rankingKey: candidateRankingKey(now), sourcePoolSize: 100, limit: 30, candidates: [{ symbol: 'OLD' }] }
    })
  };
  const result = await loadHourlyCandidateRanking(repository, { loadCandidates: async () => [{ symbol: 'NEW' }] }, now);
  assert.equal(result.refreshed, true);
  assert.equal(result.candidates[0].symbol, 'NEW');
  assert.equal(result.cache.sourcePoolSize, 50);
  assert.equal(result.cache.limit, 10);
});
