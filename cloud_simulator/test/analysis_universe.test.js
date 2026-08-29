'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAnalysisUniverseIndex, buildUniverseManifest } = require('../src/analysis_universe');

test('analysis universe is the unique union of historical TOP50 and current TOP100', () => {
  const rows = buildAnalysisUniverseIndex({
    tradeDate: '2026-08-28', updatedAt: '2026-08-28T13:00:00.000Z',
    historicalTop50Codes: ['2330', '2317'],
    currentTop100: [
      { stock_code: '2317', stock_name: '鴻海', rank: 2 },
      { stock_code: '2603', stock_name: '長榮', rank: 51 },
      { stock_code: '2603', stock_name: '長榮', rank: 51 }
    ],
    companyBasic: [
      { stock_code: '2330', stock_name: '台積電' },
      { stock_code: '2317', stock_name: '鴻海' },
      { stock_code: '2603', stock_name: '長榮' }
    ],
    mopsStatus: 'complete'
  });
  assert.deepEqual(rows.map(row => row.stock_code), ['2317', '2330', '2603']);
  assert.equal(rows.find(row => row.stock_code === '2603').historical_top50, false);
  assert.equal(rows.find(row => row.stock_code === '2330').active_top100, false);
});

test('new rank 51-100 symbol remains blocked until its backfill completes', () => {
  const base = {
    tradeDate: '2026-08-28', currentTop100: [{ stock_code: '2603', stock_name: '長榮', rank: 51 }],
    companyBasic: [{ stock_code: '2603', stock_name: '長榮' }], mopsStatus: 'complete'
  };
  const pending = buildAnalysisUniverseIndex({ ...base, pendingBackfill: [{ stock_code: '2603', status: 'running' }] });
  assert.equal(pending[0].analysis_ready, false);
  assert.deepEqual(pending[0].missing_datasets, ['daily_history']);
  const complete = buildAnalysisUniverseIndex({ ...base, pendingBackfill: [{ stock_code: '2603', status: 'complete' }] });
  assert.equal(complete[0].analysis_ready, true);
});

test('universe manifest reports readiness and pending symbols', () => {
  const rows = [
    { stock_code: '2330', active_top100: true, analysis_ready: true },
    { stock_code: '2603', active_top100: true, analysis_ready: false }
  ];
  const manifest = buildUniverseManifest(rows, { tradeDate: '2026-08-28', updatedAt: '2026-08-28T13:00:00.000Z' });
  assert.equal(manifest.symbol_count, 2);
  assert.equal(manifest.current_top100_count, 2);
  assert.equal(manifest.analysis_ready_count, 1);
  assert.deepEqual(manifest.pending_symbols, ['2603']);
  assert.equal(manifest.status, 'updating');
});
