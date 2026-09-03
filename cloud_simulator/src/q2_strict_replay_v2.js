'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { CONFIG } = require('./config');
const { candidateSelectionScore } = require('./scanner');
const { entryDecision, exitDecision, canAddOn } = require('./strategies');
const { auditQ2BacktestReadiness } = require('./q2_backtest_readiness');
const { historicalFactors, loadGzipBars, makeCandidate } = require('./q2_strict_replay');

function readJsonl(file) { return fs.readFileSync(file, 'utf8').split(/\r?\n/).filter(Boolean).map(line => JSON.parse(line)); }
function minuteOf(timestamp) { const m = String(timestamp).match(/T(\d{2}):(\d{2})/); return m ? Number(m[1]) * 60 + Number(m[2]) : null; }
function hhmm(total) { return `${String(Math.floor(total / 60)).padStart(2, '0')}:${String(total % 60).padStart(2, '0')}`; }
function loadWarmup(root, symbol) {
  const file = path.join(root, '2026Q2', 'twse-daily-warmup', `${symbol}.json`);
  if (!fs.existsSync(file)) return [];
  const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
  return (payload.rows || []).map(row => ({
    tradeDate: row.tradeDate,
    open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close), volume: Number(row.volume || 0)
  })).filter(row => row.tradeDate && row.close > 0).sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
}
function quoteFromBar(bar, slippagePct) {
  const mid = Number(bar.close);
  return { symbol: bar.symbol, price: mid, bidPrice: mid * (1 - slippagePct), askPrice: mid * (1 + slippagePct), availableQuantity: 999, timestamp: bar.timestamp };
}
function maxDrawdown(curve) {
  let peak = -Infinity; let dd = 0;
  for (const row of curve) { peak = Math.max(peak, row.equity); if (peak > 0) dd = Math.min(dd, row.equity / peak - 1); }
  return dd;
}
function equityOf(account, quotes) {
  return account.cash + account.positions.reduce((sum, p) => sum + p.quantity * (quotes.get(p.symbol)?.bidPrice || p.averagePrice), 0);
}
function fee(gross) { return Math.max(CONFIG.minBrokerFee, Math.round(gross * CONFIG.brokerFeeRate)); }
function sellTax(gross) { return Math.round(gross * CONFIG.sellTaxRate); }

function runStrictReplayV2(options = {}) {
  const root = path.resolve(options.root || 'data/backtest');
  const readiness = auditQ2BacktestReadiness({ root });
  if (!readiness.targetReached) {
    const error = new Error(`Q2 strict replay blocked: ${readiness.blockers.join(', ')}`);
    error.code = 'Q2_NOT_READY'; error.readiness = readiness; throw error;
  }

  const pitRows = readJsonl(path.join(root, 'q2-mops-point-in-time', 'q2_pit_with_mops.jsonl'));
  const symbols = [...new Set(pitRows.map(row => String(row.symbol)))];
  const intradayRoot = path.join(root, '2026Q2', 'intraday');
  const intraday = new Map(symbols.map(symbol => [symbol, {
    one: loadGzipBars(path.join(intradayRoot, '1m', `${symbol}.csv.gz`)),
    fifteen: loadGzipBars(path.join(intradayRoot, '15m', `${symbol}.csv.gz`))
  }]));
  const warmup = new Map(symbols.map(symbol => [symbol, loadWarmup(root, symbol)]));

  const account = { initialCapital: CONFIG.initialCapital, cash: CONFIG.initialCapital, positions: [], trades: [], realizedPnl: 0, fees: 0, taxes: 0, dailyNewCapital: 0, dailyTurnover: 0 };
  const curve = [];
  const factorBlockers = new Set();
  const dates = [...new Set(pitRows.map(row => row.tradeDate))].sort();
  const slippagePct = Number(options.slippagePct ?? 0.0015);

  for (const tradeDate of dates) {
    account.dailyNewCapital = 0; account.dailyTurnover = 0;
    const rows = pitRows.filter(row => row.tradeDate === tradeDate);
    for (let minute = 9 * 60 + 15; minute <= 13 * 60 + 15; minute += 15) {
      const time = hhmm(minute);
      const scored = [];
      const quotes = new Map();
      for (const row of rows) {
        if (!historicalFactors(row) || historicalFactors(row).fundamentalScore == null || historicalFactors(row).officialNewsScore == null) {
          factorBlockers.add(`${tradeDate}|${row.symbol}|HISTORICAL_FACTOR_NOT_MATERIALIZED`); continue;
        }
        const source = intraday.get(String(row.symbol));
        const oneMinuteToday = source.one.filter(bar => bar.tradeDate === tradeDate && minuteOf(bar.timestamp) <= minute);
        if (!oneMinuteToday.length) continue;
        const quote = quoteFromBar(oneMinuteToday.at(-1), slippagePct);
        quotes.set(String(row.symbol), quote);
        const dailyBars = (warmup.get(String(row.symbol)) || []).filter(bar => bar.tradeDate < tradeDate).slice(-180);
        const bars15m = source.fifteen.filter(bar => bar.timestamp <= quote.timestamp).slice(-80);
        if (dailyBars.length < 50 || bars15m.length < 20) continue;
        const candidate = makeCandidate(row, { oneMinuteToday, bars15m, dailyBars }, quote, minute);
        if (candidate.blocked) { factorBlockers.add(`${tradeDate}|${row.symbol}|${candidate.reason}`); continue; }
        scored.push(candidate);
      }

      // Top100 uses only volume accumulated up to this replay timestamp.
      const top100 = scored.slice().sort((a, b) => Number(b.volume) - Number(a.volume)).slice(0, CONFIG.candidateSelectionPoolLimit);
      const top30 = top100.map(row => ({ ...row, selectionScore: candidateSelectionScore(row) }))
        .sort((a, b) => b.selectionScore.total - a.selectionScore.total).slice(0, CONFIG.maxCandidates);

      for (const position of [...account.positions]) {
        const candidate = scored.find(row => row.symbol === position.symbol);
        const quote = quotes.get(position.symbol);
        if (!candidate || !quote) continue;
        position.marketValue = position.quantity * quote.bidPrice;
        position.highestPrice = Math.max(Number(position.highestPrice || 0), quote.bidPrice);
        const exit = exitDecision(position, candidate, { date: tradeDate, time }, CONFIG);
        if (!exit.exit) continue;
        const quantity = exit.partial ? Math.max(1, Math.floor(position.quantity / 2)) : position.quantity;
        const gross = quantity * quote.bidPrice;
        const f = fee(gross); const tax = sellTax(gross); const pnl = gross - f - tax - position.averagePrice * quantity;
        account.cash += gross - f - tax; account.realizedPnl += pnl; account.fees += f; account.taxes += tax; account.dailyTurnover += gross;
        account.trades.push({ tradeDate, time, symbol: position.symbol, side: 'SELL', quantity, price: quote.bidPrice, fee: f, tax, pnl, reason: exit.reason });
        position.quantity -= quantity; if (exit.partial) position.partialTaken = true;
        if (position.quantity <= 0) account.positions = account.positions.filter(item => item !== position);
      }

      for (const candidate of top30.filter(row => row.grade === 'A').sort((a, b) => b.score - a.score)) {
        let equity = equityOf(account, quotes);
        const held = account.positions.find(position => position.symbol === candidate.symbol);
        if (held) {
          if (!canAddOn(held, candidate, { equity }, CONFIG)) continue;
          const capRemaining = equity * CONFIG.strategyCaps.SWING - account.positions.filter(p => p.strategy === 'SWING').reduce((s, p) => s + Number(p.marketValue || p.quantity * p.averagePrice), 0);
          const budget = Math.max(0, Math.min(equity * CONFIG.addOnPct, capRemaining, equity * CONFIG.dailyNewCapitalPct - account.dailyNewCapital, equity * CONFIG.dailyTurnoverPct - account.dailyTurnover, account.cash - equity * CONFIG.minCashReservePct));
          const qty = Math.min(999, Math.floor((budget - CONFIG.minBrokerFee) / candidate.askPrice));
          if (qty <= 0) continue;
          const gross = qty * candidate.askPrice; const f = fee(gross); if (gross + f > account.cash) continue;
          const total = held.quantity + qty; held.averagePrice = (held.averagePrice * held.quantity + gross + f) / total; held.quantity = total; held.lastEntryPrice = candidate.askPrice; held.addOnCount += 1;
          account.cash -= gross + f; account.fees += f; account.dailyNewCapital += gross + f; account.dailyTurnover += gross;
          account.trades.push({ tradeDate, time, symbol: candidate.symbol, side: 'BUY', quantity: qty, price: candidate.askPrice, fee: f, tax: 0, pnl: null, reason: 'SWING 一次策略加碼' });
          continue;
        }
        if (account.positions.length >= 5) continue;
        const decision = entryDecision(candidate, 'SWING', { date: tradeDate, time, marketMode: 'NORMAL', dailyStopped: false, weeklyStopped: false, sameSymbolStrategy: null }, CONFIG);
        if (!decision.allowed) continue;
        equity = equityOf(account, quotes);
        const swingExposure = account.positions.filter(p => p.strategy === 'SWING').reduce((s, p) => s + Number(p.marketValue || p.quantity * p.averagePrice), 0);
        const budget = Math.max(0, Math.min(equity * CONFIG.firstEntryPct, equity * CONFIG.strategyCaps.SWING - swingExposure, equity * CONFIG.dailyNewCapitalPct - account.dailyNewCapital, equity * CONFIG.dailyTurnoverPct - account.dailyTurnover, account.cash - equity * CONFIG.minCashReservePct));
        const qty = Math.min(999, Math.floor((budget - CONFIG.minBrokerFee) / candidate.askPrice));
        if (qty <= 0) continue;
        const gross = qty * candidate.askPrice; const f = fee(gross); if (gross + f > account.cash) continue;
        account.cash -= gross + f; account.fees += f; account.dailyNewCapital += gross + f; account.dailyTurnover += gross;
        account.positions.push({ symbol: candidate.symbol, name: candidate.name, strategy: 'SWING', quantity: qty, averagePrice: (gross + f) / qty, lastEntryPrice: candidate.askPrice, stopPrice: candidate.askPrice * 0.94, highestPrice: candidate.askPrice, holdingDays: 0, addOnCount: 0, partialTaken: false, marketValue: gross });
        account.trades.push({ tradeDate, time, symbol: candidate.symbol, side: 'BUY', quantity: qty, price: candidate.askPrice, fee: f, tax: 0, pnl: null, reason: 'SWING A級進場' });
      }

      const equity = equityOf(account, quotes);
      curve.push({ tradeDate, time, equity });
    }
    for (const position of account.positions) position.holdingDays += 1;
  }

  if (factorBlockers.size) {
    const error = new Error(`Q2 strict replay blocked by ${factorBlockers.size} missing point-in-time factor rows`);
    error.code = 'Q2_FACTORS_NOT_READY'; error.factorBlockers = [...factorBlockers].slice(0, 100); throw error;
  }

  const finalEquity = curve.at(-1)?.equity ?? account.initialCapital;
  const sells = account.trades.filter(row => row.side === 'SELL');
  const wins = sells.filter(row => Number(row.pnl) > 0);
  const grossProfit = wins.reduce((s, row) => s + Number(row.pnl || 0), 0);
  const grossLoss = Math.abs(sells.filter(row => Number(row.pnl) < 0).reduce((s, row) => s + Number(row.pnl || 0), 0));
  return {
    generatedAt: new Date().toISOString(), period: { start: dates[0], end: dates.at(-1) },
    policy: { dataSourcePrimary: 'TWSE_MCP', predictionForbidden: true, pointInTime: true, strategyFrozen: true, dailyWarmup: 'TWSE_MCP', intradayFallback: 'only when TWSE minute history unavailable', executionModel: `minute close ± ${slippagePct}` },
    initialCapital: account.initialCapital, finalEquity, returnPct: finalEquity / account.initialCapital - 1,
    maxDrawdownPct: maxDrawdown(curve), tradeCount: account.trades.length, exitCount: sells.length,
    winRate: sells.length ? wins.length / sells.length : 0, profitFactor: grossLoss ? grossProfit / grossLoss : null,
    realizedPnl: account.realizedPnl, fees: account.fees, taxes: account.taxes,
    openPositions: account.positions, tradeLog: account.trades, equityCurve: curve, restorationScore: readiness.restorationScore
  };
}

module.exports = { loadWarmup, runStrictReplayV2 };
