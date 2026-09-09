'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { buildAnalysisUniverseIndex, buildUniverseManifest, isListedCommonStock } = require('../src/analysis_universe');

test('analysis universe is the unique union of retained history and current TOP50', () => {
  const rows = buildAnalysisUniverseIndex({
    tradeDate: '2026-08-28', updatedAt: '2026-08-28T13:00:00.000Z',
    historicalTop50Codes: ['2330', '2317'],
    currentTop50: [
      { stock_code: '2317', stock_name: '鴻海', rank: 2 },
      { stock_code: '2603', stock_name: '長榮', rank: 50 },
      { stock_code: '2603', stock_name: '長榮', rank: 50 }
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
  assert.equal(rows.find(row => row.stock_code === '2330').active_top50, false);
  assert.equal(rows.find(row => row.stock_code === '2330').daily_update_active, false);
  assert.equal(rows.find(row => row.stock_code === '2330').retained_in_master_index, true);
});

test('analysis universe accepts listed common stocks and rejects ETFs and DRs', () => {
  assert.equal(isListedCommonStock('2330', '台積電'), true);
  assert.equal(isListedCommonStock('9802', '鈺齊-KY'), true);
  assert.equal(isListedCommonStock('0050', '元大台灣50'), false);
  assert.equal(isListedCommonStock('9103', '美德醫療-DR'), false);
  const rows = buildAnalysisUniverseIndex({
    tradeDate: '2026-08-28',
    currentTop50: [
      { stock_code: '2330', stock_name: '台積電', rank: 1 },
      { stock_code: '0050', stock_name: '元大台灣50', rank: 2 },
      { stock_code: '9103', stock_name: '美德醫療-DR', rank: 3 }
    ],
    companyBasic: [{ stock_code: '2330', stock_name: '台積電' }],
    mopsStatus: 'complete'
  });
  assert.deepEqual(rows.map(row => row.stock_code), ['2330']);
});

test('legacy TOP100 input is compatibility-only and activates at most rank 50', () => {
  const currentTop100 = Array.from({ length: 60 }, (_, index) => ({
    stock_code: String(2000 + index), stock_name: `測試${index + 1}`, rank: index + 1
  }));
  const companyBasic = currentTop100.map(row => ({ stock_code: row.stock_code, stock_name: row.stock_name }));
  const rows = buildAnalysisUniverseIndex({ tradeDate: '2026-09-09', currentTop100, companyBasic, mopsStatus: 'complete' });
  assert.equal(rows.filter(row => row.active_top50).length, 50);
  assert.equal(rows.some(row => row.current_top50_rank > 50), false);
});

test('new Top50 symbol remains blocked until its backfill completes', () => {
  const base = {
    tradeDate: '2026-08-28', currentTop50: [{ stock_code: '2603', stock_name: '長榮', rank: 50 }],
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
    { stock_code: '2330', active_top50: true, analysis_ready: true },
    { stock_code: '2603', active_top50: true, analysis_ready: false }
  ];
  const manifest = buildUniverseManifest(rows, { tradeDate: '2026-08-28', updatedAt: '2026-08-28T13:00:00.000Z' });
  assert.equal(manifest.symbol_count, 2);
  assert.equal(manifest.current_top50_count, 2);
  assert.equal(manifest.analysis_ready_count, 1);
  assert.deepEqual(manifest.pending_symbols, ['2603']);
  assert.equal(manifest.status, 'updating');
  assert.match(manifest.definition, /only active_top50 receives rolling updates/);
});
