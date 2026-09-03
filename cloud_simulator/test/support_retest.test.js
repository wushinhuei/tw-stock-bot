'use strict';

const assert = require('node:assert/strict');
const test = require('node:test');
const { breakoutRetest, supportResistance } = require('../src/indicators');
const { timeframeScore } = require('../src/scoring');

function bar(close, high = close + 0.5, low = close - 0.5, volume = 1000) {
  return { open: close - 0.2, high, low, close, volume };
}

test('breakout retest confirms only after former resistance is tested and held', () => {
  const base = Array.from({ length: 25 }, (_, index) => bar(98 + index * 0.04, 100, 97.5 + index * 0.04));
  const rows = [
    ...base,
    bar(102, 103, 100.8, 1800),
    bar(101.2, 102, 100.4, 1200),
    bar(103, 104, 101.8, 1500),
  ];
  const result = breakoutRetest(rows, 20, 5, 0.015);
  assert.equal(result.breakout, true);
  assert.equal(result.retestConfirmed, true);
  assert.equal(result.breakoutLevel, 100);
});

test('breakout without a retest is not treated as confirmed', () => {
  const base = Array.from({ length: 25 }, (_, index) => bar(98 + index * 0.04, 100, 97.5 + index * 0.04));
  const rows = [
    ...base,
    bar(102, 103, 101.8, 1800),
    bar(103, 104, 102.2, 1500),
  ];
  const result = breakoutRetest(rows, 20, 5, 0.015);
  assert.equal(result.breakout, true);
  assert.equal(result.retestConfirmed, false);
});

test('technical score exposes support resistance and retest metrics', () => {
  const base = Array.from({ length: 55 }, (_, index) => bar(90 + index * 0.18, 100, 89.5 + index * 0.18, 1000 + index * 10));
  const rows = [
    ...base,
    bar(102, 103, 100.8, 2000),
    bar(101.1, 102, 100.3, 1300),
    bar(103, 104, 101.8, 1600),
  ];
  const result = timeframeScore(rows, 18);
  assert.equal(typeof result.metrics.support, 'number');
  assert.equal(typeof result.metrics.resistance, 'number');
  assert.equal(result.metrics.breakoutRetestConfirmed, true);
  assert.ok(result.reasons.includes('突破壓力後回測守穩'));
});
