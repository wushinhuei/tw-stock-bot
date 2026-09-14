'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { fourQuarterStart, syncTop10DailyHistory } = require('../src/top10_daily_history');

class MemoryStore {
  constructor(seed = {}) { this.files = structuredClone(seed); }
  async readManifest() { return structuredClone(this.files.manifest || null); }
  async writeManifest(value) { this.files.manifest = structuredClone(value); }
  async readSymbol(symbol) { return structuredClone(this.files[symbol] || null); }
  async writeSymbol(symbol, value) { this.files[symbol] = structuredClone(value); }
}

function row(symbol, tradeDate, close = 100) {
  return { symbol, tradeDate, open: close, high: close, low: close, close, volume: 10, value: 1000, transactions: 1 };
}

test('four-quarter window is a rolling twelve-month period', () => {
  assert.equal(fourQuarterStart('2026-09-14'), '2025-09-15');
});

test('Top10 daily history backfills entrants, increments members and pauses exits', async () => {
  const store = new MemoryStore({
    manifest: { symbols: [{ symbol: '2303', name: '聯電', active: true, status: 'COMPLETE', latestTradeDate: '2026-09-11' }] },
    2330: { symbol: '2330', windowStart: '2025-09-15', rows: [row('2330', '2026-09-11')] },
    2303: { symbol: '2303', windowStart: '2025-09-15', rows: [row('2303', '2026-09-11')] }
  });
  const calls = [];
  const manifest = await syncTop10DailyHistory({
    candidates: [{ symbol: '2330', name: '台積電' }, { symbol: '2317', name: '鴻海' }],
    tradeDate: '2026-09-14',
    now: new Date('2026-09-14T14:00:00Z'),
    store,
    fetchDaily: async (symbol, start, end) => {
      calls.push({ symbol, start, end });
      return { rows: [row(symbol, end)] };
    }
  });
  assert.deepEqual(calls, [
    { symbol: '2330', start: '2026-09-12', end: '2026-09-14' },
    { symbol: '2317', start: '2025-09-15', end: '2026-09-14' }
  ]);
  assert.equal(store.files['2330'].rowCount, 2);
  assert.equal(store.files['2317'].latestTradeDate, '2026-09-14');
  assert.equal(manifest.symbols.find(item => item.symbol === '2303').status, 'PAUSED');
  assert.equal(manifest.complete, true);
});

test('Top10 daily history deduplicates dates and reports incomplete latest data', async () => {
  const store = new MemoryStore();
  const manifest = await syncTop10DailyHistory({
    candidates: [{ symbol: '2330', name: '台積電' }],
    tradeDate: '2026-09-14',
    now: new Date('2026-09-14T14:00:00Z'),
    store,
    fetchDaily: async () => ({ rows: [row('2330', '2026-09-11'), row('2330', '2026-09-11', 101)] })
  });
  assert.equal(store.files['2330'].rows.length, 1);
  assert.equal(store.files['2330'].rows[0].close, 101);
  assert.equal(manifest.complete, false);
});

test('a paused symbol resumes from the day after its last stored trade date', async () => {
  const store = new MemoryStore({
    manifest: { symbols: [{ symbol: '2303', name: '聯電', active: false, status: 'PAUSED', latestTradeDate: '2026-08-31' }] },
    2303: { symbol: '2303', name: '聯電', windowStart: '2025-09-15', rows: [row('2303', '2026-08-31')] }
  });
  const calls = [];
  const manifest = await syncTop10DailyHistory({
    candidates: [{ symbol: '2303', name: '聯電' }],
    tradeDate: '2026-09-14',
    now: new Date('2026-09-14T14:00:00Z'),
    store,
    fetchDaily: async (symbol, start, end) => {
      calls.push({ symbol, start, end });
      return { rows: [row(symbol, '2026-09-14')] };
    }
  });
  assert.deepEqual(calls, [{ symbol: '2303', start: '2026-09-01', end: '2026-09-14' }]);
  assert.equal(manifest.symbols[0].status, 'COMPLETE');
  assert.equal(store.files['2303'].rows.length, 2);
});
