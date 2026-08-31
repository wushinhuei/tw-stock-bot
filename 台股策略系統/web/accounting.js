(function (root, factory) {
  'use strict';
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.TWStockAccounting = api;
})(typeof window !== 'undefined' ? window : null, function () {
  'use strict';

  function finiteNumber(value) {
    const out = Number(value);
    return Number.isFinite(out) ? out : null;
  }

  function positionMarketValue(position, quotePrice) {
    const shares = Math.max(0, finiteNumber(position?.shares ?? position?.quantity) || 0);
    const quote = finiteNumber(quotePrice);
    if (quote !== null && quote > 0) return shares * quote;

    const stored = finiteNumber(position?.marketValue);
    if (stored !== null && stored > 0) return stored;

    const cost = finiteNumber(position?.avgCost ?? position?.averagePrice);
    return shares * Math.max(0, cost || 0);
  }

  function storedPositionValue(positions) {
    return (Array.isArray(positions) ? positions : [])
      .reduce((sum, position) => sum + positionMarketValue(position, null), 0);
  }

  function economicCash(result) {
    const reportedEquity = finiteNumber(result && result.finalEquity);
    if (reportedEquity !== null) return reportedEquity - storedPositionValue(result.positions);
    return finiteNumber(result && result.cash) || 0;
  }

  function markToMarket(result, currentPositionValue) {
    const cash = economicCash(result || {});
    const positionValue = finiteNumber(currentPositionValue) || 0;
    const initialCapital = finiteNumber(result && result.initialCapital) || 0;
    const finalEquity = cash + positionValue;
    return {
      cash,
      positionValue,
      finalEquity,
      totalReturn: initialCapital ? finalEquity / initialCapital - 1 : 0,
    };
  }

  return { economicCash, markToMarket, positionMarketValue, storedPositionValue };
});
