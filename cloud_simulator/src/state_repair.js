'use strict';

const { buildSettlementLedger } = require('./settlement');

function tradeSide(trade) {
  const value = String(trade.side || trade.action || '').toUpperCase();
  if (value === '買進') return 'BUY';
  if (value === '賣出') return 'SELL';
  return value;
}

function tradeQuantity(trade) {
  return Number(trade.filledQuantity || trade.shares || trade.quantity || 0);
}

function tradePrice(trade) {
  return Number(trade.averagePrice ?? trade.price ?? 0);
}

function replayTrades(trades, existingPositions = []) {
  const positions = new Map();
  let realizedPnl = 0;

  for (const trade of trades) {
    if (!['FILLED', 'PARTIAL'].includes(String(trade.status || 'FILLED').toUpperCase())) continue;
    const side = tradeSide(trade);
    const quantity = tradeQuantity(trade);
    const price = tradePrice(trade);
    if (!['BUY', 'SELL'].includes(side) || quantity <= 0) continue;
    if (!Number.isFinite(price) || price <= 0) throw new Error(`Invalid remaining trade price: ${trade.symbol} ${side} ${price}`);

    const fee = Number(trade.fee || 0);
    const tax = Number(trade.tax || 0);
    const gross = quantity * price;
    const current = positions.get(trade.symbol);
    if (side === 'BUY') {
      const totalCost = (current ? current.totalCost : 0) + gross + fee;
      const totalQuantity = (current ? current.quantity : 0) + quantity;
      positions.set(trade.symbol, {
        symbol: trade.symbol,
        strategy: trade.strategy || current?.strategy || 'SWING',
        quantity: totalQuantity,
        totalCost,
        averagePrice: totalCost / totalQuantity,
        lastEntryPrice: price,
        firstEntryPrice: current?.firstEntryPrice || price,
        highestEntryPrice: Math.max(current?.highestEntryPrice || 0, price),
        buyFillCount: (current?.buyFillCount || 0) + 1,
      });
      continue;
    }

    if (!current || current.quantity < quantity) throw new Error(`Sell exceeds reconstructed position: ${trade.symbol}`);
    const cost = current.averagePrice * quantity;
    realizedPnl += gross - fee - tax - cost;
    current.quantity -= quantity;
    current.totalCost -= cost;
    if (current.quantity <= 0) positions.delete(trade.symbol);
  }

  const existingBySymbol = new Map(existingPositions.map(position => [position.symbol, position]));
  return {
    realizedPnl,
    positions: [...positions.values()].map(rebuilt => {
      const existing = existingBySymbol.get(rebuilt.symbol) || {};
      const marketValue = Number(existing.marketValue);
      return {
        ...existing,
        symbol: rebuilt.symbol,
        strategy: rebuilt.strategy,
        quantity: rebuilt.quantity,
        averagePrice: rebuilt.averagePrice,
        lastEntryPrice: rebuilt.lastEntryPrice,
        stopPrice: Number(existing.stopPrice) > 0
          ? Number(existing.stopPrice)
          : rebuilt.firstEntryPrice * (rebuilt.strategy === 'SWING' ? 0.94 : rebuilt.strategy === 'OVERNIGHT' ? 0.98 : 0.99),
        highestPrice: Math.max(Number(existing.highestPrice || 0), rebuilt.highestEntryPrice),
        holdingDays: Number(existing.holdingDays || 0),
        addOnCount: Math.max(Number(existing.addOnCount || 0), rebuilt.buyFillCount - 1),
        partialTaken: Boolean(existing.partialTaken),
        marketValue: Number.isFinite(marketValue) && marketValue > 0 ? marketValue : rebuilt.totalCost,
      };
    }),
  };
}

function repairZeroPriceSellState(account, options = {}) {
  const symbol = String(options.symbol || '3037');
  const expectedCount = Number(options.expectedCount || 1);
  const source = structuredClone(account || {});
  const trades = Array.isArray(source.trades) ? source.trades : [];
  const invalidTrades = trades.filter(trade => (
    String(trade.symbol) === symbol
    && tradeSide(trade) === 'SELL'
    && ['FILLED', 'PARTIAL'].includes(String(trade.status || 'FILLED').toUpperCase())
    && tradePrice(trade) <= 0
  ));
  if (invalidTrades.length !== expectedCount) {
    throw new Error(`Expected ${expectedCount} invalid ${symbol} sell trade, found ${invalidTrades.length}`);
  }

  const invalidOrderIds = new Set(invalidTrades.map(trade => trade.orderId).filter(Boolean));
  const validTrades = trades.filter(trade => !invalidTrades.includes(trade));
  const replayed = replayTrades(validTrades, source.positions || []);
  const settlements = buildSettlementLedger(validTrades);
  const unsettledNet = settlements.reduce((sum, row) => sum + Number(row.netPayable || 0), 0);
  const bankCash = Number(source.bankCash ?? source.initialCapital ?? 0);
  const cash = bankCash - unsettledNet;
  const positionValue = replayed.positions.reduce((sum, position) => sum + Number(position.marketValue || 0), 0);
  const equity = cash + positionValue;
  const dayStartEquity = Number(source.dayStartEquity || source.initialCapital || equity);
  const weekStartEquity = Number(source.weekStartEquity || source.initialCapital || equity);
  const dailyStopped = dayStartEquity > 0 && equity / dayStartEquity - 1 <= Number(options.dailyStopPct ?? -0.02);
  const weeklyStopped = weekStartEquity > 0 && equity / weekStartEquity - 1 <= Number(options.weeklyStopPct ?? -0.05);

  const repaired = {
    ...source,
    cash,
    equity,
    positions: replayed.positions,
    trades: validTrades,
    orders: (source.orders || []).filter(order => !invalidOrderIds.has(order.id)),
    settlements,
    realizedPnl: replayed.realizedPnl,
    totalFees: validTrades.reduce((sum, trade) => sum + Number(trade.fee || 0), 0),
    totalTaxes: validTrades.reduce((sum, trade) => sum + Number(trade.tax || 0), 0),
    dailyStopped,
    weeklyStopped,
    weeklyLimited: weeklyStopped,
  };

  return {
    account: repaired,
    audit: {
      symbol,
      removedTrades: invalidTrades.map(trade => ({
        orderId: trade.orderId || null,
        tradeDate: trade.tradeDate || trade.date || null,
        quantity: tradeQuantity(trade),
        price: tradePrice(trade),
      })),
      before: {
        equity: Number(source.equity || 0),
        realizedPnl: Number(source.realizedPnl || 0),
        tradeCount: trades.length,
        positionCount: (source.positions || []).length,
      },
      after: {
        equity,
        cash,
        realizedPnl: repaired.realizedPnl,
        tradeCount: validTrades.length,
        positionCount: repaired.positions.length,
        restoredPosition: repaired.positions.find(position => position.symbol === symbol) || null,
      },
    },
  };
}

module.exports = { repairZeroPriceSellState, replayTrades, tradePrice, tradeQuantity, tradeSide };
