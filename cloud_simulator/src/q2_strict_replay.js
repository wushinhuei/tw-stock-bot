'use strict';

const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { CONFIG } = require('./config');
const { scoreCandidate } = require('./scoring');
const { candidateSelectionScore } = require('./scanner');
const { entryDecision, exitDecision, canAddOn } = require('./strategies');
const { auditQ2BacktestReadiness } = require('./q2_backtest_readiness');

function parseCsv(text) {
  const lines = String(text || '').trim().split(/\r?\n/);
  if (!lines.length) return [];
  const header = lines.shift().split(',');
  return lines.filter(Boolean).map(line => {
    const cells = line.split(',');
    return Object.fromEntries(header.map((name, index) => [name, cells[index] ?? '']));
  });
}

function loadGzipBars(file) {
  if (!fs.existsSync(file)) return [];
  return parseCsv(zlib.gunzipSync(fs.readFileSync(file)).toString('utf8')).map(row => ({
    symbol: row.symbol,
    timestamp: row.timestamp,
    tradeDate: row.trade_date,
    open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close),
    volume: Number(row.volume || 0), amount: row.amount === '' ? null : Number(row.amount)
  })).filter(row => Number.isFinite(row.close) && row.close > 0);
}

function readJsonl(file) {
  return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line));
}

function minuteOf(timestamp) {
  const match = String(timestamp).match(/T(\d{2}):(\d{2})/);
  return match ? Number(match[1]) * 60 + Number(match[2]) : null;
}

function hhmm(total) {
  return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`;
}

function priorDailyBars(allRows, symbol, tradeDate, limit = 180) {
  return allRows.filter(row => row.symbol === symbol && row.tradeDate < tradeDate)
    .sort((a, b) => a.tradeDate.localeCompare(b.tradeDate))
    .slice(-limit)
    .map(row => ({ ...row.market, tradeDate: row.tradeDate }));
}

function weeklyBars(daily) {
  const groups = new Map();
  for (const row of daily) {
    const d = new Date(`${row.tradeDate}T00:00:00Z`);
    const day = d.getUTCDay() || 7;
    d.setUTCDate(d.getUTCDate() - day + 1);
    const key = d.toISOString().slice(0, 10);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([tradeDate, rows]) => ({
    tradeDate,
    open: rows[0].open,
    high: Math.max(...rows.map(row => Number(row.high))),
    low: Math.min(...rows.map(row => Number(row.low))),
    close: rows.at(-1).close,
    volume: rows.reduce((sum, row) => sum + Number(row.volume || 0), 0)
  }));
}

function cumulativeVolume(oneMinute, asOfMinute) {
  return oneMinute.reduce((sum, bar) => minuteOf(bar.timestamp) <= asOfMinute ? sum + Number(bar.volume || 0) : sum, 0);
}

function factorNumber(row, names) {
  for (const name of names) {
    const value = name.split('.').reduce((obj, key) => obj?.[key], row);
    const number = Number(value);
    if (Number.isFinite(number)) return number;
  }
  return null;
}

function historicalFactors(row) {
  const fundamentalScore = factorNumber(row, [
    'historicalFactors.fundamentalScore', 'fundamentalScore', 'mops.fundamentalScore', 'components.fundamental'
  ]);
  const officialNewsScore = factorNumber(row, [
    'historicalFactors.officialNewsScore', 'officialNewsScore', 'mops.officialNewsScore', 'components.officialNews'
  ]);
  const liquidityScore = factorNumber(row, [
    'historicalFactors.liquidityScore', 'liquidityScore'
  ]);
  return {
    fundamentalScore: fundamentalScore == null ? null : (fundamentalScore > 1 ? fundamentalScore / 10 : fundamentalScore),
    officialNewsScore: officialNewsScore == null ? null : (officialNewsScore > 1 ? officialNewsScore / 15 : officialNewsScore),
    liquidityScore: liquidityScore == null ? 1 : liquidityScore
  };
}

function chipSignals(row) {
  const institutional = row.institutional || {};
  const margin = row.margin || {};
  const marginPrevious = Number(margin.marginPreviousBalance);
  const marginCurrent = Number(margin.marginCurrentBalance);
  const shortPrevious = Number(margin.shortPreviousBalance);
  const shortCurrent = Number(margin.shortCurrentBalance);
  return {
    source: 'TWSE_MCP_POINT_IN_TIME',
    institutional: {
      totalNet: Number(institutional.institutionalTotalNet || 0),
      foreignNet: Number(institutional.foreignNet || 0),
      trustNet: Number(institutional.investmentTrustNet || 0),
      dealerNet: Number(institutional.dealerNet || 0)
    },
    marginChangeRatio: Number.isFinite(marginPrevious) && marginPrevious !== 0 ? (marginCurrent - marginPrevious) / Math.abs(marginPrevious) : null,
    shortChangeRatio: Number.isFinite(shortPrevious) && shortPrevious !== 0 ? (shortCurrent - shortPrevious) / Math.abs(shortPrevious) : null
  };
}

function quoteFromBar(bar, slippagePct = 0.0015) {
  const mid = Number(bar.close);
  return {
    symbol: bar.symbol,
    price: mid,
    bidPrice: mid * (1 - slippagePct),
    askPrice: mid * (1 + slippagePct),
    availableQuantity: 999,
    timestamp: bar.timestamp,
    provider: 'HISTORICAL_INTRADAY_CONSERVATIVE_EXECUTION'
  };
}

function makeCandidate(row, bars, quote, asOfMinute) {
  const factors = historicalFactors(row);
  if (factors.fundamentalScore == null || factors.officialNewsScore == null) {
    return { blocked: true, reason: 'HISTORICAL_FACTOR_NOT_MATERIALIZED' };
  }
  const dailyBars = bars.dailyBars;
  const input = {
    symbol: row.symbol,
    name: row.name,
    market: 'TWSE', securityType: 'COMMON_STOCK', strategy: 'SWING',
    volume: cumulativeVolume(bars.oneMinuteToday, asOfMinute),
    bars15m: bars.bars15m,
    dailyBars,
    weeklyBars: weeklyBars(dailyBars),
    chipSignals: chipSignals(row),
    fundamentalScore: factors.fundamentalScore,
    officialNewsScore: factors.officialNewsScore,
    liquidityScore: factors.liquidityScore,
    quoteFresh: true,
    spreadPct: (quote.askPrice - quote.bidPrice) / ((quote.askPrice + quote.bidPrice) / 2),
    bidPrice: quote.bidPrice, askPrice: quote.askPrice, price: quote.price,
    timestamp: quote.timestamp, scoringTime: quote.timestamp,
    blockedReasons: [], officialRiskBlocked: false
  };
  return { ...input, ...scoreCandidate(input), dataStatus: 'COMPLETE' };
}

function maxDrawdown(curve) {
  let peak = -Infinity;
  let max = 0;
  for (const row of curve) {
    peak = Math.max(peak, row.equity);
    if (peak > 0) max = Math.min(max, row.equity / peak - 1);
  }
  return max;
}

function runStrictReplay(options = {}) {
  const root = path.resolve(options.root || 'data/backtest');
  const readiness = auditQ2BacktestReadiness({ root });
  if (!readiness.targetReached) {
    const error = new Error(`Q2 strict replay blocked: ${readiness.blockers.join(', ')}`);
    error.code = 'Q2_NOT_READY';
    error.readiness = readiness;
    throw error;
  }

  const pitRows = readJsonl(path.join(root, 'q2-mops-point-in-time', 'q2_pit_with_mops.jsonl'));
  const intradayRoot = path.join(root, '2026Q2', 'intraday');
  const symbols = [...new Set(pitRows.map(row => String(row.symbol)))];
  const intraday = new Map(symbols.map(symbol => [symbol, {
    one: loadGzipBars(path.join(intradayRoot, '1m', `${symbol}.csv.gz`)),
    five: loadGzipBars(path.join(intradayRoot, '5m', `${symbol}.csv.gz`)),
    fifteen: loadGzipBars(path.join(intradayRoot, '15m', `${symbol}.csv.gz`))
  }]));

  const account = {
    initialCapital: CONFIG.initialCapital,
    cash: CONFIG.initialCapital,
    positions: [], trades: [], realizedPnl: 0, fees: 0, taxes: 0,
    dailyNewCapital: 0, dailyTurnover: 0
  };
  const curve = [];
  const factorBlockers = new Set();
  const dates = [...new Set(pitRows.map(row => row.tradeDate))].sort();

  for (const tradeDate of dates) {
    account.dailyNewCapital = 0;
    account.dailyTurnover = 0;
    const rows = pitRows.filter(row => row.tradeDate === tradeDate);
    for (let minute = 9 * 60 + 15; minute <= 13 * 60 + 15; minute += 15) {
      const time = hhmm(minute);
      const scored = [];
      const quotes = new Map();
      for (const row of rows) {
        const source = intraday.get(String(row.symbol));
        const oneMinuteToday = source.one.filter(bar => bar.tradeDate === tradeDate && minuteOf(bar.timestamp) <= minute);
        const fifteenToday = source.fifteen.filter(bar => bar.tradeDate === tradeDate && minuteOf(bar.timestamp) <= minute);
        if (!oneMinuteToday.length || fifteenToday.length < 20) continue;
        const quoteBar = oneMinuteToday.at(-1);
        const quote = quoteFromBar(quoteBar, options.slippagePct ?? 0.0015);
        quotes.set(String(row.symbol), quote);
        const candidate = makeCandidate(row, {
          oneMinuteToday,
          bars15m: source.fifteen.filter(bar => bar.timestamp <= quote.timestamp).slice(-80),
          dailyBars: priorDailyBars(pitRows, String(row.symbol), tradeDate, 180)
        }, quote, minute);
        if (candidate.blocked) { factorBlockers.add(`${tradeDate}|${row.symbol}|${candidate.reason}`); continue; }
        scored.push(candidate);
      }

      // Reconstruct the hourly Top100 from volume known at the replay timestamp; never use final daily volume.
      const top100 = scored.sort((a, b) => Number(b.volume) - Number(a.volume)).slice(0, CONFIG.candidateSelectionPoolLimit);
      const top30 = top100.map(row => ({ ...row, selectionScore: candidateSelectionScore(row) }))
        .sort((a, b) => b.selectionScore.total - a.selectionScore.total)
        .slice(0, CONFIG.maxCandidates);

      for (const position of [...account.positions]) {
        const candidate = top30.find(row => row.symbol === position.symbol) || scored.find(row => row.symbol === position.symbol);
        if (!candidate) continue;
        const exit = exitDecision(position, candidate, { date: tradeDate, time }, CONFIG);
        if (!exit.exit) continue;
        const quote = quotes.get(position.symbol);
        const quantity = exit.partial ? Math.max(1, Math.floor(position.quantity / 2)) : position.quantity;
        const gross = quantity * quote.bidPrice;
        const fee = Math.max(CONFIG.minBrokerFee, Math.round(gross * CONFIG.brokerFeeRate));
        const tax = Math.round(gross * CONFIG.sellTaxRate);
        const pnl = gross - fee - tax - position.averagePrice * quantity;
        account.cash += gross - fee - tax;
        account.realizedPnl += pnl; account.fees += fee; account.taxes += tax;
        account.trades.push({ tradeDate, time, symbol: position.symbol, side: 'SELL', quantity, price: quote.bidPrice, fee, tax, pnl, reason: exit.reason });
        position.quantity -= quantity;
        if (exit.partial) position.partialTaken = true;
        if (position.quantity <= 0) account.positions = account.positions.filter(item => item !== position);
      }

      const occupied = () => account.positions.length;
      for (const candidate of top30.filter(row => row.grade === 'A').sort((a, b) => b.score - a.score)) {
        const held = account.positions.find(position => position.symbol === candidate.symbol);
        const equity = account.cash + account.positions.reduce((sum, p) => sum + p.quantity * (quotes.get(p.symbol)?.bidPrice || p.averagePrice), 0);
        if (held) {
          if (!canAddOn(held, candidate, { equity }, CONFIG)) continue;
          const budget = Math.min(equity * CONFIG.addOnPct, account.cash - equity * CONFIG.minCashReservePct);
          const qty = Math.min(999, Math.floor((budget - CONFIG.minBrokerFee) / candidate.askPrice));
          if (qty <= 0) continue;
          const gross = qty * candidate.askPrice;
          const fee = Math.max(CONFIG.minBrokerFee, Math.round(gross * CONFIG.brokerFeeRate));
          if (gross + fee > account.cash) continue;
          const totalQty = held.quantity + qty;
          held.averagePrice = (held.averagePrice * held.quantity + gross + fee) / totalQty;
          held.quantity = totalQty; held.lastEntryPrice = candidate.askPrice; held.addOnCount += 1;
          account.cash -= gross + fee; account.fees += fee;
          account.trades.push({ tradeDate, time, symbol: candidate.symbol, side: 'BUY', quantity: qty, price: candidate.askPrice, fee, tax: 0, pnl: null, reason: 'SWING 一次策略加碼' });
          continue;
        }
        if (occupied() >= 5) continue;
        const decision = entryDecision(candidate, 'SWING', { date: tradeDate, time, marketMode: 'NORMAL', dailyStopped: false, weeklyStopped: false, sameSymbolStrategy: null }, CONFIG);
        if (!decision.allowed) continue;
        const firstBudget = Math.min(equity * CONFIG.firstEntryPct, equity * CONFIG.dailyNewCapitalPct - account.dailyNewCapital, account.cash - equity * CONFIG.minCashReservePct);
        const qty = Math.min(999, Math.floor((firstBudget - CONFIG.minBrokerFee) / candidate.askPrice));
        if (qty <= 0) continue;
        const gross = qty * candidate.askPrice;
        const fee = Math.max(CONFIG.minBrokerFee, Math.round(gross * CONFIG.brokerFeeRate));
        if (gross + fee > account.cash) continue;
        account.cash -= gross + fee; account.fees += fee; account.dailyNewCapital += gross + fee; account.dailyTurnover += gross;
        account.positions.push({ symbol: candidate.symbol, name: candidate.name, strategy: 'SWING', quantity: qty, averagePrice: (gross + fee) / qty, lastEntryPrice: candidate.askPrice, stopPrice: candidate.askPrice * 0.94, highestPrice: candidate.askPrice, holdingDays: 0, addOnCount: 0, partialTaken: false, marketValue: gross });
        account.trades.push({ tradeDate, time, symbol: candidate.symbol, side: 'BUY', quantity: qty, price: candidate.askPrice, fee, tax: 0, pnl: null, reason: 'SWING A級進場' });
      }

      for (const position of account.positions) {
        const quote = quotes.get(position.symbol);
        if (quote) {
          position.marketValue = position.quantity * quote.bidPrice;
          position.highestPrice = Math.max(Number(position.highestPrice || 0), quote.bidPrice);
        }
      }
      const equity = account.cash + account.positions.reduce((sum, p) => sum + Number(p.marketValue || p.quantity * p.averagePrice), 0);
      curve.push({ tradeDate, time, equity });
    }
    for (const position of account.positions) position.holdingDays += 1;
  }

  if (factorBlockers.size) {
    const error = new Error(`Q2 strict replay blocked by ${factorBlockers.size} missing point-in-time factor rows`);
    error.code = 'Q2_FACTORS_NOT_READY';
    error.factorBlockers = [...factorBlockers].slice(0, 100);
    throw error;
  }

  const finalEquity = curve.at(-1)?.equity ?? account.initialCapital;
  const sells = account.trades.filter(row => row.side === 'SELL');
  const winners = sells.filter(row => Number(row.pnl) > 0);
  const grossProfit = winners.reduce((sum, row) => sum + Number(row.pnl || 0), 0);
  const grossLoss = Math.abs(sells.filter(row => Number(row.pnl) < 0).reduce((sum, row) => sum + Number(row.pnl || 0), 0));
  return {
    generatedAt: new Date().toISOString(),
    period: { start: dates[0], end: dates.at(-1) },
    policy: { predictionForbidden: true, pointInTime: true, strategyFrozen: true, executionModel: 'conservative bid/ask proxy from minute close ± slippage' },
    initialCapital: account.initialCapital,
    finalEquity,
    returnPct: finalEquity / account.initialCapital - 1,
    maxDrawdownPct: maxDrawdown(curve),
    tradeCount: account.trades.length,
    exitCount: sells.length,
    winRate: sells.length ? winners.length / sells.length : 0,
    profitFactor: grossLoss ? grossProfit / grossLoss : null,
    realizedPnl: account.realizedPnl,
    fees: account.fees,
    taxes: account.taxes,
    openPositions: account.positions,
    tradeLog: account.trades,
    equityCurve: curve,
    restorationScore: readiness.restorationScore
  };
}

module.exports = { historicalFactors, loadGzipBars, makeCandidate, runStrictReplay, weeklyBars };
