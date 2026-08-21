'use strict';

function ymd(date) { return new Date(date).toISOString().slice(0, 10); }

function addBusinessDays(value, days, holidays = new Set()) {
  const date = new Date(`${ymd(value)}T00:00:00Z`);
  let remaining = days;
  while (remaining > 0) {
    date.setUTCDate(date.getUTCDate() + 1);
    const day = date.getUTCDay();
    if (day !== 0 && day !== 6 && !holidays.has(ymd(date))) remaining -= 1;
  }
  return ymd(date);
}

function settlementDate(tradeDate, holidays) { return addBusinessDays(tradeDate, 2, holidays); }

function buildSettlementLedger(trades, holidays = new Set()) {
  const byDate = {};
  for (const trade of trades || []) {
    if (trade.status !== 'FILLED' && trade.status !== 'PARTIAL') continue;
    const date = trade.settlementDate || settlementDate(trade.tradeDate, holidays);
    const row = byDate[date] || { date, buyPayable: 0, sellReceivable: 0, netPayable: 0 };
    const gross = Number(trade.filledQuantity || 0) * Number(trade.averagePrice || trade.price || 0);
    const fees = Number(trade.fee || 0);
    const tax = Number(trade.tax || 0);
    if (trade.side === 'BUY') row.buyPayable += gross + fees;
    else row.sellReceivable += gross - fees - tax;
    row.netPayable = row.buyPayable - row.sellReceivable;
    byDate[date] = row;
  }
  return Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));
}

function settlementReserve(equity, config) {
  return Math.max(Number(equity) * config.settlementReservePct, config.settlementReserveMin);
}

function availableToBuy(account, config) {
  const unsettledPayables = (account.settlements || []).reduce((sum, row) => sum + Math.max(0, Number(row.netPayable || 0)), 0);
  return Math.max(0, Number(account.bankCash || account.cash || 0)
    - unsettledPayables
    - Number(account.reservedForOrders || 0)
    - Number(account.estimatedFees || 0)
    - settlementReserve(account.equity, config));
}

function hasSettlementShortfall(account, config) {
  const reserve = settlementReserve(account.equity, config);
  let projected = Number(account.bankCash || account.cash || 0);
  for (const row of account.settlements || []) {
    projected -= Number(row.netPayable || 0);
    if (projected < reserve) return { blocked: true, date: row.date, shortfall: reserve - projected };
  }
  return { blocked: false, date: null, shortfall: 0 };
}

module.exports = { addBusinessDays, availableToBuy, buildSettlementLedger, hasSettlementShortfall, settlementDate, settlementReserve };
