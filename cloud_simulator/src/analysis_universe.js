'use strict';

function normalizeCode(value) {
  const code = String(value || '').trim();
  return /^\d{4}$/.test(code) ? code : '';
}

function isListedCommonStock(codeValue, stockName = '') {
  const code = normalizeCode(codeValue);
  return Boolean(code) && !/^0/.test(code) && !/^91/.test(code) && !/-DR\b/i.test(String(stockName || ''));
}

function stockEntries(rows) {
  return (rows || [])
    .filter(row => isListedCommonStock(row.stock_code, row.stock_name))
    .map(row => [normalizeCode(row.stock_code), row]);
}

function buildAnalysisUniverseIndex(options = {}) {
  const previous = new Map(stockEntries(options.previous));
  const current = new Map(stockEntries(options.currentTop100));
  const historicalTop50 = new Set((options.historicalTop50Codes || []).map(normalizeCode).filter(code => isListedCommonStock(code)));
  for (const [code, row] of previous) if (row.historical_top50) historicalTop50.add(code);
  const pending = new Map((options.pendingBackfill || []).map(row => [normalizeCode(row.stock_code), row]).filter(item => item[0]));
  const basic = new Map((options.companyBasic || []).map(row => [normalizeCode(row.stock_code), row]).filter(item => item[0]));
  const codes = new Set([...previous.keys(), ...current.keys(), ...historicalTop50]);
  const tradeDate = options.tradeDate || '';
  const updatedAt = options.updatedAt || new Date().toISOString();
  const mopsComplete = String(options.mopsStatus || '') === 'complete' && !(options.mopsWarnings || []).length;

  return [...codes].sort().map(code => {
    const old = previous.get(code) || {};
    const quote = current.get(code) || {};
    const task = pending.get(code);
    const company = basic.get(code) || {};
    const dailyComplete = !task || task.status === 'complete';
    const missing = [];
    if (!dailyComplete) missing.push('daily_history');
    if (!company.stock_code) missing.push('company_basic');
    if (!mopsComplete) missing.push('mops_rolling');
    return {
      stock_code: code,
      stock_name: quote.stock_name || company.stock_name || old.stock_name || '',
      industry: company.industry || old.industry || '',
      listing_date: company.listing_date || old.listing_date || '',
      first_top100_date: old.first_top100_date || (current.has(code) ? tradeDate : ''),
      last_top100_date: current.has(code) ? tradeDate : (old.last_top100_date || ''),
      active_top100: current.has(code),
      retained_in_master_index: true,
      daily_update_active: current.has(code),
      current_top100_rank: current.has(code) ? Number(quote.rank || 0) : null,
      historical_top50: historicalTop50.has(code),
      daily_history_status: dailyComplete ? 'complete' : String(task.status || 'pending'),
      mops_status: company.stock_code && mopsComplete ? 'complete' : 'pending',
      analysis_ready: missing.length === 0,
      missing_datasets: missing,
      updated_at: updatedAt
    };
  });
}

function buildUniverseManifest(rows, options = {}) {
  const pending = rows.filter(row => !row.analysis_ready);
  return {
    dataset: 'TWSE_ANALYSIS_UNIVERSE',
    version: options.tradeDate || String(options.updatedAt || new Date().toISOString()).slice(0, 10),
    generated_at: options.updatedAt || new Date().toISOString(),
    definition: 'retained historical universe plus latest TWSE_TOP100; only active_top100 receives rolling updates',
    latest_successful_trade_date: options.tradeDate || '',
    symbol_count: rows.length,
    current_top100_count: rows.filter(row => row.active_top100).length,
    analysis_ready_count: rows.length - pending.length,
    pending_backfill_count: pending.length,
    pending_symbols: pending.map(row => row.stock_code),
    status: pending.length ? 'updating' : 'complete'
  };
}

module.exports = { buildAnalysisUniverseIndex, buildUniverseManifest, normalizeCode, isListedCommonStock };
