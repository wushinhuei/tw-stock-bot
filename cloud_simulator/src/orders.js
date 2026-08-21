'use strict';

const crypto = require('node:crypto');

const ACTIVE = new Set(['NEW', 'OPEN', 'PARTIAL', 'CANCEL_PENDING']);

function orderKey(order) {
  return [order.tradeDate, order.strategy, order.symbol, order.signalTimestamp, order.side].join('|');
}

class OrderManager {
  constructor(config) { this.config = config; }

  create(input, existing = []) {
    const order = {
      id: crypto.randomUUID(), type: 'LIMIT', timeInForce: 'ROD', status: 'NEW',
      filledQuantity: 0, repriceCount: 0, createdAt: new Date().toISOString(), ...input
    };
    order.idempotencyKey = orderKey(order);
    if (existing.some(item => ACTIVE.has(item.status) && item.idempotencyKey === order.idempotencyKey)) return null;
    if (order.quantity < 1 || order.quantity > 999) throw new Error('盤中零股數量必須為 1–999 股');
    return order;
  }

  requestCancel(order, reason) {
    if (!ACTIVE.has(order.status) || order.status === 'CANCEL_PENDING') return order;
    return { ...order, status: 'CANCEL_PENDING', cancelReason: reason, cancelRequestedAt: new Date().toISOString() };
  }

  confirmCancel(order) {
    if (order.status !== 'CANCEL_PENDING') throw new Error('替代委託前必須先確認抽單');
    return { ...order, status: 'CANCELLED', cancelledAt: new Date().toISOString() };
  }

  replacement(cancelled, price, signalTimestamp) {
    if (cancelled.status !== 'CANCELLED') throw new Error('舊單未撤銷，不得重新掛價');
    const remaining = cancelled.quantity - cancelled.filledQuantity;
    if (remaining <= 0) return null;
    const emergency = Boolean(cancelled.emergencyExit);
    if (!emergency && cancelled.repriceCount >= this.config.maxReprices) return null;
    return this.create({
      tradeDate: cancelled.tradeDate, strategy: cancelled.strategy, symbol: cancelled.symbol,
      side: cancelled.side, quantity: remaining, price, signalTimestamp,
      parentOrderId: cancelled.id, repriceCount: cancelled.repriceCount + 1,
      emergencyExit: emergency
    }, []);
  }

  match(order, quote) {
    if (!['NEW', 'OPEN', 'PARTIAL'].includes(order.status)) return order;
    if (!quote || !quote.timestamp || new Date(quote.timestamp) <= new Date(order.createdAt)) return order;
    const marketPrice = order.side === 'BUY' ? Number(quote.askPrice) : Number(quote.bidPrice);
    const crosses = order.side === 'BUY' ? Number(order.price) >= marketPrice : Number(order.price) <= marketPrice;
    if (!crosses || !Number.isFinite(marketPrice)) return { ...order, status: order.filledQuantity ? 'PARTIAL' : 'OPEN' };
    const available = Math.max(0, Number(quote.availableQuantity || 0));
    const fill = Math.min(order.quantity - order.filledQuantity, available);
    if (!fill) return { ...order, status: order.filledQuantity ? 'PARTIAL' : 'OPEN' };
    const filledQuantity = order.filledQuantity + fill;
    const previousValue = Number(order.averagePrice || 0) * order.filledQuantity;
    return {
      ...order, filledQuantity,
      averagePrice: (previousValue + marketPrice * fill) / filledQuantity,
      status: filledQuantity === order.quantity ? 'FILLED' : 'PARTIAL',
      updatedAt: new Date().toISOString()
    };
  }
}

module.exports = { ACTIVE, OrderManager, orderKey };
