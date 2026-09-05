'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  CORE_METRICS, activeTop100Symbols, metricCoverage, normalizeQuarterlyRows
} = require('../scripts/backfill_mops_20q_to_drive');

function flow(metric, value, start, end) {
  return { metric, value, start_date: start, end_date: end, instant: '', concept: metric, context_ref: `${metric}:${start}:${end}`, unit: metric === 'eps' ? 'TWD/shares' : 'TWD' };
}

function instant(metric, value, date) {
  return { metric, value, start_date: '', end_date: '', instant: date, concept: metric, context_ref: `${metric}:${date}`, unit: 'TWD' };
}

test('MOPS 20Q universe includes only active current TOP100 and supports bounded trial symbols', () => {
  const rows = [
    { stock_code: '2330', active_top100: true },
    { stock_code: '2317', active_top100: false, historical_top50: true },
    { stock_code: '2303', active_top100: true },
    { stock_code: '0050', active_top100: true }
  ];
  assert.deepEqual(activeTop100Symbols(rows), ['2303', '2330']);
  assert.deepEqual(activeTop100Symbols(rows, { requestedSymbols: ['2330', '2317'] }), ['2330']);
  assert.deepEqual(activeTop100Symbols(rows, { limit: 1 }), ['2303']);
});

test('MOPS 20Q validates all fourteen required fundamental metrics', () => {
  assert.equal(CORE_METRICS.length, 14);
  assert.ok(CORE_METRICS.includes('noncurrent_liabilities'));
  assert.ok(CORE_METRICS.includes('operating_expenses'));
});

test('MOPS 20Q distinguishes direct quarter, cumulative YTD difference and instant values', () => {
  const instantMetrics = ['assets', 'liabilities', 'equity', 'cash', 'current_assets', 'current_liabilities', 'noncurrent_liabilities'];
  const q1Facts = [
    flow('revenue', 100, '2025-01-01', '2025-03-31'),
    flow('operating_income', 20, '2025-01-01', '2025-03-31'),
    flow('net_income', 15, '2025-01-01', '2025-03-31'),
    flow('eps', 1.5, '2025-01-01', '2025-03-31'),
    flow('operating_cash_flow', 30, '2025-01-01', '2025-03-31'),
    flow('capital_expenditure', 10, '2025-01-01', '2025-03-31'),
    flow('operating_expenses', 40, '2025-01-01', '2025-03-31'),
    ...instantMetrics.map((metric, index) => instant(metric, 1000 + index, '2025-03-31'))
  ];
  const q2Facts = [
    flow('revenue', 260, '2025-01-01', '2025-06-30'),
    flow('operating_income', 55, '2025-01-01', '2025-06-30'),
    flow('net_income', 42, '2025-01-01', '2025-06-30'),
    flow('eps', 4.2, '2025-01-01', '2025-06-30'),
    flow('operating_cash_flow', 75, '2025-01-01', '2025-06-30'),
    flow('capital_expenditure', 28, '2025-01-01', '2025-06-30'),
    flow('operating_expenses', 95, '2025-01-01', '2025-06-30'),
    ...instantMetrics.map((metric, index) => instant(metric, 1100 + index, '2025-06-30'))
  ];
  const q3Facts = [
    flow('revenue', 170, '2025-07-01', '2025-09-30'),
    flow('revenue', 430, '2025-01-01', '2025-09-30'),
    ...instantMetrics.map((metric, index) => instant(metric, 1200 + index, '2025-09-30'))
  ];
  const rows = normalizeQuarterlyRows([
    { stock_code: '2330', fiscal_year: 2025, quarter: 1, facts: q1Facts },
    { stock_code: '2330', fiscal_year: 2025, quarter: 2, facts: q2Facts },
    { stock_code: '2330', fiscal_year: 2025, quarter: 3, facts: q3Facts }
  ]);
  assert.equal(rows[0].normalized_metrics.revenue.value, 100);
  assert.equal(rows[0].normalized_metrics.revenue.basis, 'Q1_EQUALS_YTD');
  assert.equal(rows[1].normalized_metrics.revenue.value, 160);
  assert.equal(rows[1].normalized_metrics.revenue.basis, 'DERIVED_FROM_YTD_DIFFERENCE');
  assert.equal(rows[2].normalized_metrics.revenue.value, 170);
  assert.equal(rows[2].normalized_metrics.revenue.basis, 'DIRECT_SINGLE_QUARTER');
  assert.equal(rows[1].normalized_metrics.assets.value, 1100);
  assert.equal(rows[1].normalized_metrics.assets.basis, 'INSTANT');
  assert.equal(metricCoverage([rows[0]]).revenue.ratio, 1);
  assert.equal(rows[0].metric_validation_ok, true);
  assert.ok(rows[2].missing_core_metrics.includes('operating_income'));
});
