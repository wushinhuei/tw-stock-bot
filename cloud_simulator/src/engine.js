'use strict';

const { CONFIG } = require('./config');
const { fetchInvestingRss } = require('./news');
const { OrderManager } = require('./orders');
const { availableToBuy, buildSettlementLedger, hasSettlementShortfall } = require('./settlement');
const { canAddOn, entryDecision, exitDecision } = require('./strategies');

function fee(amount, config = CONFIG) { return Math.max(config.minBrokerFee, Math.round(amount * config.brokerFeeRate)); }
function tax(amount, dayTrade, config = CONFIG) { return Math.round(amount * (dayTrade ? config.dayTradeTaxRate : config.sellTaxRate)); }
function taipeiTime(date = new Date()) { return new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit', hour12: false }).format(date); }
function taipeiDate(date = new Date()) { return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(date); }

function createAccount(initialCapital = CONFIG.initialCapital) {
  return {
    initialCapital, equity: initialCapital, bankCash: initialCapital, cash: initialCapital,
    reservedForOrders: 0, estimatedFees: 0, positions: [], orders: [], trades: [], settlements: [],
    realizedPnl: 0, totalFees: 0, totalTaxes: 0, dailyNewCapital: 0, dailyTurnover: 0,
    dayStartEquity: initialCapital, weekStartEquity: initialCapital, dailyStopped: false, weeklyStopped: false
  };
}

function riskState(account, config = CONFIG) {
  const dailyReturn = account.dayStartEquity ? account.equity / account.dayStartEquity - 1 : 0;
  const weeklyReturn = account.weekStartEquity ? account.equity / account.weekStartEquity - 1 : 0;
  const settlement = hasSettlementShortfall(account, config);
  return {
    dailyReturn, weeklyReturn, settlement,
    dailyStopped: dailyReturn <= config.dailyStopPct,
    weeklyStopped: weeklyReturn <= config.weeklyStopPct,
    allowNewRisk: dailyReturn > config.dailyStopPct && weeklyReturn > config.weeklyStopPct && !settlement.blocked
  };
}

function strategyExposure(account, strategy) {
  return account.positions.filter(position => position.strategy === strategy)
    .reduce((sum, position) => sum + Number(position.marketValue || position.quantity * position.averagePrice || 0), 0);
}

function maxEntryBudget(account, strategy, config = CONFIG) {
  const capRemaining = account.equity * config.strategyCaps[strategy] - strategyExposure(account, strategy);
  const dailyRemaining = account.equity * config.dailyNewCapitalPct - account.dailyNewCapital;
  const turnoverRemaining = account.equity * config.dailyTurnoverPct - account.dailyTurnover;
  const reserveRemaining = account.bankCash - account.equity * config.minCashReservePct;
  return Math.max(0, Math.min(account.equity * config.firstEntryPct, capRemaining, dailyRemaining, turnoverRemaining, reserveRemaining, availableToBuy(account, config)));
}

function createEntryOrder(engine, candidate, strategy, context) {
  const decision = entryDecision(candidate, strategy, context, engine.config);
  if (!decision.allowed) return { order: null, reasons: decision.reasons };
  const budget = maxEntryBudget(engine.account, strategy, engine.config);
  const price = Number(candidate.askPrice || candidate.price || 0);
  const quantity = Math.min(999, Math.floor((budget - engine.config.minBrokerFee) / price));
  if (quantity <= 0) return { order: null, reasons: ['可用資金不足'] };
  const order = engine.orderManager.create({
    tradeDate: context.date, strategy, symbol: candidate.symbol, side: 'BUY', quantity, price,
    signalTimestamp: context.signalTimestamp, reason: `${strategy} A級進場`
  }, engine.account.orders);
  if (order) {
    engine.account.orders.push(order);
    engine.account.reservedForOrders += quantity * price + fee(quantity * price, engine.config);
  }
  return { order, reasons: order ? [] : ['重複訊號已存在'] };
}

class SimulationEngine {
  constructor(options = {}) {
    this.config = options.config || CONFIG;
    this.repository = options.repository;
    this.account = options.account || createAccount(this.config.initialCapital);
    this.orderManager = new OrderManager(this.config);
    this.news = [];
  }

  async restore() {
    const stored = this.repository ? await this.repository.loadState() : {};
    if (stored && stored.account) this.account = stored.account;
    return this.account;
  }

  async refreshNews(fetchImpl = fetch) {
    const result = await fetchInvestingRss(this.config.investingRssUrls, fetchImpl);
    this.news = result.items;
    if (this.repository && result.items.length) await this.repository.saveNews(result.items);
    return result;
  }

  processCandidates(candidates, context) {
    const risk = riskState(this.account, this.config);
    this.account.dailyStopped = risk.dailyStopped;
    this.account.weeklyStopped = risk.weeklyStopped;
    if (!risk.allowNewRisk) return [];
    const created = [];
    for (const candidate of candidates.filter(row => row.grade === 'A').sort((a, b) => b.score - a.score)) {
      const strategy = candidate.strategy;
      if (!strategy) continue;
      const held = this.account.positions.find(position => position.symbol === candidate.symbol);
      if (held) {
        if (held.strategy !== strategy || !canAddOn(held, candidate, this.account, this.config)) continue;
        if (this.account.orders.some(order => order.symbol === candidate.symbol && order.side === 'BUY' && ['NEW', 'OPEN', 'PARTIAL', 'CANCEL_PENDING'].includes(order.status))) continue;
        const price = Number(candidate.askPrice || candidate.price || 0);
        const budget = Math.min(this.account.equity * this.config.addOnPct, maxEntryBudget(this.account, strategy, this.config));
        const quantity = Math.min(999, Math.floor((budget - this.config.minBrokerFee) / price));
        if (quantity > 0) {
          const order = this.orderManager.create({
            tradeDate: context.date, strategy, symbol: candidate.symbol, side: 'BUY', quantity, price,
            signalTimestamp: context.signalTimestamp, reason: `${strategy} 一次策略加碼`
          }, this.account.orders);
          if (order) {
            this.account.orders.push(order);
            this.account.reservedForOrders += quantity * price + fee(quantity * price, this.config);
            created.push(order);
          }
        }
        continue;
      }
      const result = createEntryOrder(this, candidate, strategy, {
        ...context, dailyStopped: risk.dailyStopped, weeklyStopped: risk.weeklyStopped,
        sameSymbolStrategy: null
      });
      if (result.order) created.push(result.order);
    }
    return created;
  }

  processQuotes(quotes, candidates, context) {
    this.account.orders = this.account.orders.map(order => {
      const matched = this.orderManager.match(order, quotes[order.symbol]);
      if (matched.filledQuantity > order.filledQuantity) this.recordFill(order, matched);
      return matched;
    });
    for (const position of [...this.account.positions]) {
      const candidate = candidates.find(row => row.symbol === position.symbol);
      if (!candidate) continue;
      position.marketValue = position.quantity * Number(candidate.bidPrice || candidate.price);
      position.highestPrice = Math.max(Number(position.highestPrice || 0), Number(candidate.price || 0));
      const exit = exitDecision(position, candidate, context, this.config);
      if (exit.exit && !this.account.orders.some(order => order.symbol === position.symbol && order.side === 'SELL' && ['NEW', 'OPEN', 'PARTIAL'].includes(order.status))) {
        const quantity = exit.partial ? Math.max(1, Math.floor(position.quantity / 2)) : position.quantity;
        const order = this.orderManager.create({
          tradeDate: context.date, strategy: position.strategy, symbol: position.symbol, side: 'SELL', quantity,
          price: Number(candidate.bidPrice || candidate.price), signalTimestamp: context.signalTimestamp,
          reason: exit.reason, emergencyExit: exit.emergency
        }, this.account.orders);
        if (order) this.account.orders.push(order);
      }
      if (canAddOn(position, candidate, this.account, this.config)) position.addOnEligible = true;
    }
    this.markToMarket(quotes);
  }

  recordFill(previous, filled) {
    const delta = filled.filledQuantity - previous.filledQuantity;
    const gross = delta * filled.averagePrice;
    const tradeFee = fee(gross, this.config);
    const tradeTax = filled.side === 'SELL' ? tax(gross, filled.strategy === 'DAY_TRADE', this.config) : 0;
    this.account.totalFees += tradeFee;
    this.account.totalTaxes += tradeTax;
    this.account.dailyTurnover += gross;
    if (filled.side === 'BUY') {
      this.account.dailyNewCapital += gross + tradeFee;
      this.account.reservedForOrders = Math.max(0, this.account.reservedForOrders - gross - tradeFee);
      const position = this.account.positions.find(row => row.symbol === filled.symbol);
      if (position) {
        const total = position.quantity + delta;
        position.averagePrice = (position.averagePrice * position.quantity + gross + tradeFee) / total;
        position.quantity = total;
        position.lastEntryPrice = filled.averagePrice;
        position.addOnCount += 1;
      } else {
        this.account.positions.push({
          symbol: filled.symbol, strategy: filled.strategy, quantity: delta,
          averagePrice: (gross + tradeFee) / delta, lastEntryPrice: filled.averagePrice,
          stopPrice: filled.strategy === 'SWING' ? filled.averagePrice * 0.94 : filled.averagePrice * (filled.strategy === 'OVERNIGHT' ? 0.98 : 0.99),
          highestPrice: filled.averagePrice, holdingDays: 0, addOnCount: 0, partialTaken: false
        });
      }
    } else {
      const position = this.account.positions.find(row => row.symbol === filled.symbol);
      if (position) {
        position.quantity -= delta;
        const cost = position.averagePrice * delta;
        this.account.realizedPnl += gross - tradeFee - tradeTax - cost;
        if (filled.reason && filled.reason.includes('+8%')) position.partialTaken = true;
        if (position.quantity <= 0) this.account.positions = this.account.positions.filter(row => row !== position);
      }
    }
    this.account.trades.push({
      tradeDate: filled.tradeDate, symbol: filled.symbol, strategy: filled.strategy, side: filled.side,
      status: filled.status, filledQuantity: delta, averagePrice: filled.averagePrice, fee: tradeFee, tax: tradeTax,
      reason: filled.reason, orderId: filled.id
    });
    this.account.settlements = buildSettlementLedger(this.account.trades);
  }

  markToMarket(quotes) {
    const marketValue = this.account.positions.reduce((sum, position) => {
      const quote = quotes[position.symbol];
      return sum + position.quantity * Number(quote ? quote.bidPrice : position.averagePrice);
    }, 0);
    const unsettledNet = (this.account.settlements || []).reduce((sum, row) => sum + Number(row.netPayable || 0), 0);
    // T+2 前銀行餘額不動；應付款扣除、應收款加回，避免買進後重複計入資產。
    this.account.equity = this.account.bankCash - unsettledNet + marketValue;
  }

  dashboard(candidates = []) {
    const risk = riskState(this.account, this.config);
    const positions = this.account.positions.map(position => ({
      ...position, shares: position.quantity, avgCost: position.averagePrice,
      totalCost: position.quantity * position.averagePrice, name: position.name || position.symbol,
      targetPrice: position.strategy === 'SWING' ? position.averagePrice * 1.08 : position.averagePrice * (position.strategy === 'OVERNIGHT' ? 1.03 : 1.015)
    }));
    const trades = this.account.trades.map(trade => ({
      ...trade, date: trade.tradeDate, action: trade.side, shares: trade.filledQuantity,
      price: trade.averagePrice, name: trade.name || trade.symbol, pnl: trade.pnl || 0
    }));
    return {
      ok: true, source: 'google-cloud-simulator', generatedAt: new Date().toISOString(),
      schedule: { pollMs: this.config.marketPollMs, sessionStart: this.config.sessionStart, sessionEnd: this.config.sessionEnd },
      account: this.account, candidates, internationalNews: this.news.slice(0, 30), risk,
      scenario: [{
        date: taipeiDate(), source: 'google-cloud-simulator', candidates,
        internationalNews: this.news.slice(0, 30), market: { mode: risk.allowNewRisk ? 'NORMAL' : 'DEFENSIVE' }
      }],
      simulation: {
        initialCapital: this.account.initialCapital, cash: this.account.bankCash,
        positions, trades, daily: this.account.daily || [],
        finalEquity: this.account.equity, realizedPnl: this.account.realizedPnl,
        totalReturn: this.account.equity / this.account.initialCapital - 1, maxDrawdown: this.account.maxDrawdown || 0,
        totalFees: this.account.totalFees, totalTaxes: this.account.totalTaxes,
        dailyStopped: risk.dailyStopped, weeklyLimited: risk.weeklyStopped
      }
    };
  }
}

module.exports = { SimulationEngine, createAccount, createEntryOrder, fee, maxEntryBudget, riskState, strategyExposure, taipeiDate, taipeiTime, tax };
