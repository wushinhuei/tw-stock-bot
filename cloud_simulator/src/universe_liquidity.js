'use strict';

function finite(value) {
  const out = Number(value);
  return Number.isFinite(out) ? out : null;
}

function median(values) {
  const rows = values.map(finite).filter(value => value !== null).sort((a, b) => a - b);
  if (!rows.length) return null;
  const middle = Math.floor(rows.length / 2);
  return rows.length % 2 ? rows[middle] : (rows[middle - 1] + rows[middle]) / 2;
}

function percentileRanks(rows, getter) {
  const ranked = rows.map((row, index) => ({ index, value: finite(getter(row)) ?? 0 }))
    .sort((a, b) => a.value - b.value || a.index - b.index);
  const out = Array(rows.length).fill(0);
  const denominator = Math.max(1, ranked.length - 1);
  ranked.forEach((item, rank) => { out[item.index] = rank / denominator; });
  return out;
}

function isEligibleListedCommonStock(row) {
  const symbol = String(row.symbol || row.code || '').trim();
  const name = String(row.name || '').trim();
  const market = String(row.market || 'TWSE').toUpperCase();
  const type = String(row.securityType || 'COMMON_STOCK').toUpperCase();
  return market === 'TWSE'
    && type === 'COMMON_STOCK'
    && /^\d{4}$/.test(symbol)
    && !/^0/.test(symbol)
    && !/^91/.test(symbol)
    && !/(ETF|ETN|DR|特別股|受益|權證)/i.test(name)
    && !row.tradingSuspended
    && !row.alteredTradingMethod
    && !row.dispositionActive;
}

function summarizeLiquidity(row) {
  const history = Array.isArray(row.history) && row.history.length ? row.history.slice(-20) : [row];
  const valid = history.filter(item => (finite(item.volume) ?? 0) > 0 && (finite(item.tradeValue) ?? finite(item.value) ?? 0) > 0);
  const volumes = valid.map(item => finite(item.volume));
  const values = valid.map(item => finite(item.tradeValue) ?? finite(item.value));
  const transactions = valid.map(item => finite(item.transactions));
  const volumeMedian20 = median(volumes) ?? finite(row.volume) ?? 0;
  const valueMedian20 = median(values) ?? finite(row.tradeValue) ?? finite(row.value) ?? 0;
  const transactionMedian20 = median(transactions) ?? finite(row.transactions) ?? 0;
  const volumeMedian5 = median(volumes.slice(-5)) ?? volumeMedian20;
  const activeRatio = Math.min(1, valid.length / Math.min(20, Math.max(1, history.length)));
  const deviations = volumes.map(value => Math.abs(value - volumeMedian20));
  const relativeMad = volumeMedian20 > 0 ? (median(deviations) || 0) / volumeMedian20 : 1;
  const stability = Math.max(0, Math.min(1, activeRatio * (1 - Math.min(1, relativeMad))));
  const shares = finite(row.sharesOutstanding);
  const turnover = shares && shares > 0 ? (finite(row.volume) || 0) / shares : null;
  const turnoverHistory = shares && shares > 0 ? volumes.map(value => value / shares) : [];
  return {
    currentVolume: finite(row.volume) || 0,
    currentValue: finite(row.tradeValue) ?? finite(row.value) ?? 0,
    currentTransactions: finite(row.transactions) || 0,
    volumeMedian20, valueMedian20, transactionMedian20, volumeMedian5,
    activeDays: valid.length, stability, turnover,
    turnoverMedian20: median(turnoverHistory)
  };
}

function scoreMotherPool(inputRows, options = {}) {
  const minimumActiveDays = Number(options.minimumActiveDays || 0);
  const rows = inputRows.filter(isEligibleListedCommonStock).map(row => ({ ...row, liquidityMetrics: summarizeLiquidity(row) }))
    .filter(row => row.liquidityMetrics.activeDays >= minimumActiveDays);
  const measures = {
    currentVolume: percentileRanks(rows, row => row.liquidityMetrics.currentVolume),
    volumeMedian20: percentileRanks(rows, row => row.liquidityMetrics.volumeMedian20),
    valueMedian20: percentileRanks(rows, row => row.liquidityMetrics.valueMedian20),
    currentValue: percentileRanks(rows, row => row.liquidityMetrics.currentValue),
    transactions: percentileRanks(rows, row => row.liquidityMetrics.currentTransactions)
  };
  rows.forEach((row, index) => {
    const m = row.liquidityMetrics;
    row.liquidityScore = Math.round(10000 * (0.25 * measures.currentVolume[index] + 0.25 * measures.volumeMedian20[index]
      + 0.25 * measures.valueMedian20[index] + 0.10 * measures.currentValue[index]
      + 0.10 * m.stability + 0.05 * measures.transactions[index])) / 100;
    const volumeAcceleration = Math.min(5, m.currentVolume / Math.max(1, m.volumeMedian20)) / 5;
    const valueAcceleration = Math.min(5, m.currentValue / Math.max(1, m.valueMedian20)) / 5;
    const shortTrend = Math.min(3, m.volumeMedian5 / Math.max(1, m.volumeMedian20)) / 3;
    const turnoverAcceleration = m.turnover !== null && m.turnoverMedian20
      ? Math.min(5, m.turnover / m.turnoverMedian20) / 5 : 0.5;
    const transactionAcceleration = Math.min(5, m.currentTransactions / Math.max(1, m.transactionMedian20)) / 5;
    row.emergingScore = Math.round(10000 * (0.30 * volumeAcceleration + 0.25 * valueAcceleration
      + 0.20 * shortTrend + 0.15 * turnoverAcceleration + 0.10 * transactionAcceleration)) / 100;
  });
  const coreLimit = options.coreLimit ?? 40;
  const emergingLimit = options.emergingLimit ?? 10;
  const core = rows.slice().sort((a, b) => b.liquidityScore - a.liquidityScore || b.liquidityMetrics.currentVolume - a.liquidityMetrics.currentVolume)
    .slice(0, coreLimit).map(row => ({ ...row, motherPoolTier: 'CORE' }));
  const coreSymbols = new Set(core.map(row => String(row.symbol || row.code)));
  const emerging = rows.filter(row => !coreSymbols.has(String(row.symbol || row.code)))
    .sort((a, b) => b.emergingScore - a.emergingScore || b.liquidityScore - a.liquidityScore)
    .slice(0, emergingLimit).map(row => ({ ...row, motherPoolTier: 'EMERGING' }));
  return [...core, ...emerging].map((row, index) => ({ ...row, motherPoolRank: index + 1 }));
}

module.exports = { isEligibleListedCommonStock, median, percentileRanks, scoreMotherPool, summarizeLiquidity };
