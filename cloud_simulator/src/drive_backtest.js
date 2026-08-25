'use strict';

const { CONFIG } = require('./config');
const { DriveHistorySource, validBar, yearsBetween } = require('./drive_history');
const { analyzeObv, atr, emaSeries, macd, rsi, sma } = require('./indicators');

function fee(amount, config = CONFIG) {
  return Math.max(config.minBrokerFee, Math.round(amount * config.brokerFeeRate));
}

function technicalProxy(bars) {
  if (bars.length < 60) return null;
  const window = bars.slice(-120);
  const closes = window.map(row => row.close);
  const volumes = window.map(row => row.volume);
  const close = closes.at(-1);
  const ma20 = sma(closes, 20);
  const ma50 = sma(closes, 50);
  const ema9 = emaSeries(closes, 9).at(-1);
  const ema20 = emaSeries(closes, 20).at(-1);
  const momentum = macd(closes);
  const rsi14 = rsi(closes, 14);
  const atr14 = atr(window, 14);
  const volumeAverage = sma(volumes, 20);
  const volumeRatio = volumeAverage ? volumes.at(-1) / volumeAverage : 0;
  const obv = analyzeObv(window, 42, 20);
  let technical = 0;
  if (close > ma20) technical += 8;
  if (close > ma50) technical += 7;
  if (ema9 >= ema20) technical += 6;
  if (momentum.histogram >= 0) technical += 6;
  if (rsi14 >= 50 && rsi14 <= 75) technical += 5;
  if (atr14 / close >= 0.006) technical += 3;
  let volumeObv = 0;
  if (volumeRatio >= 1) volumeObv += 5;
  if (volumeRatio >= 1.5) volumeObv += 5;
  if (obv.aboveMa42) volumeObv += 4;
  if (obv.rising) volumeObv += 3;
  if (obv.breakoutConfirmed) volumeObv += 3;
  if (obv.topDivergence) volumeObv = Math.max(0, volumeObv - 5);
  return { score: Math.round((technical + volumeObv) / 55 * 100), technical, volumeObv, obv, volumeRatio };
}

function closePosition(position, bar, date, reason, state, config) {
  const proceeds = position.shares * bar.close;
  const costs = fee(proceeds, config) + Math.round(proceeds * config.sellTaxRate);
  const pnl = proceeds - costs - position.cost;
  state.cash += proceeds - costs;
  state.trades.push({ symbol: position.symbol, strategy: position.strategy, entryDate: position.entryDate, exitDate: date, shares: position.shares, entryPrice: position.entryPrice, exitPrice: bar.close, pnl, returnPct: pnl / position.cost, reason });
  state.positions.delete(position.symbol);
}

function runDailyBacktest(dataset, options = {}) {
  const config = { ...CONFIG, ...(options.config || {}) };
  const start = options.start || '2023-08-25';
  const end = options.end || '2026-08-24';
  const state = { cash: config.initialCapital, positions: new Map(), trades: [], equity: [] };
  const history = new Map();
  let pending = [];
  let peak = config.initialCapital;
  let maxDrawdown = 0;
  for (const date of dataset.dates.filter(value => value >= start && value <= end)) {
    const bars = dataset.byDate.get(date) || new Map();
    for (const signal of pending) {
      if (state.positions.has(signal.symbol)) continue;
      const bar = bars.get(signal.symbol);
      if (!bar) continue;
      const equityBefore = state.cash + [...state.positions.values()].reduce((sum, position) => sum + position.shares * (bars.get(position.symbol)?.open || position.lastClose), 0);
      const reserve = Math.max(config.settlementReserveMin, equityBefore * config.settlementReservePct, equityBefore * config.minCashReservePct);
      const pct = signal.score >= 80 ? config.firstEntryPct : config.trialEntryPct;
      const budget = Math.min(equityBefore * pct, Math.max(0, state.cash - reserve));
      const shares = Math.floor((budget - config.minBrokerFee) / (bar.open * (1 + config.brokerFeeRate)));
      if (shares < 1) continue;
      const amount = shares * bar.open;
      const cost = amount + fee(amount, config);
      state.cash -= cost;
      state.positions.set(signal.symbol, { ...signal, shares, cost, entryPrice: bar.open, entryDate: date, days: 0, highWater: bar.open, lastClose: bar.close });
    }
    pending = [];
    for (const position of [...state.positions.values()]) {
      const bar = bars.get(position.symbol);
      if (!bar) continue;
      const exitBar = { ...bar };
      position.days += 1;
      position.highWater = Math.max(position.highWater, bar.high);
      position.lastClose = bar.close;
      let reason = null;
      if (position.strategy === 'OVERNIGHT') {
        if (bar.low <= position.entryPrice * 0.98) { exitBar.close = position.entryPrice * 0.98; reason = '停損'; }
        else if (bar.high >= position.entryPrice * 1.03) { exitBar.close = position.entryPrice * 1.03; reason = '停利'; }
        else if (position.days >= 3) reason = '持有滿3日';
      } else {
        if (bar.low <= position.entryPrice * 0.94) { exitBar.close = position.entryPrice * 0.94; reason = '初始停損'; }
        else if (position.highWater >= position.entryPrice * 1.05 && bar.low <= position.entryPrice) { exitBar.close = position.entryPrice; reason = '保本出場'; }
        else if (position.days >= 20 || bar.close < position.signalMa20) reason = position.days >= 20 ? '持有滿20日' : '跌破MA20';
      }
      if (reason) closePosition(position, exitBar, date, reason, state, config);
    }
    let equity = state.cash;
    for (const position of state.positions.values()) equity += position.shares * (bars.get(position.symbol)?.close || position.lastClose);
    peak = Math.max(peak, equity);
    maxDrawdown = Math.min(maxDrawdown, equity / peak - 1);
    state.equity.push({ date, equity });
    for (const [symbol, bar] of bars) {
      const rows = history.get(symbol) || [];
      rows.push(bar);
      history.set(symbol, rows.slice(-140));
    }
    const candidates = [];
    for (const symbol of dataset.top50ByDate.get(date) || []) {
      const proxy = technicalProxy(history.get(symbol));
      if (!proxy || proxy.score < 75 || state.positions.has(symbol)) continue;
      candidates.push({ symbol, score: proxy.score, signalMa20: sma(history.get(symbol).map(row => row.close), 20), strategy: proxy.obv.breakoutConfirmed ? 'SWING' : 'OVERNIGHT' });
    }
    pending = candidates.sort((a, b) => b.score - a.score).slice(0, 3);
  }
  const lastDate = state.equity.at(-1)?.date;
  const lastBars = dataset.byDate.get(lastDate) || new Map();
  for (const position of [...state.positions.values()]) {
    const bar = lastBars.get(position.symbol);
    if (bar) closePosition(position, bar, lastDate, '回測期末', state, config);
  }
  const finalEquity = state.cash;
  const wins = state.trades.filter(row => row.pnl > 0).length;
  const grossProfit = state.trades.filter(row => row.pnl > 0).reduce((sum, row) => sum + row.pnl, 0);
  const grossLoss = -state.trades.filter(row => row.pnl < 0).reduce((sum, row) => sum + row.pnl, 0);
  return { period: { start, end }, methodology: 'TOP50收盤訊號，次交易日開盤成交；只回測日線技術面與OBV代理分數', initialCapital: config.initialCapital, finalEquity, totalReturn: finalEquity / config.initialCapital - 1, maxDrawdown, trades: state.trades.length, winRate: state.trades.length ? wins / state.trades.length : 0, profitFactor: grossLoss ? grossProfit / grossLoss : null, tradeLog: state.trades };
}

async function loadDriveDataset(options = {}) {
  const source = options.source || new DriveHistorySource();
  const start = options.start || '2023-08-25';
  const end = options.end || '2026-08-24';
  const warmupStart = options.warmupStart || '2023-01-01';
  await Promise.all([source.manifest('top50'), source.manifest('stockDaily')]);
  const top50ByDate = new Map();
  for (const year of yearsBetween(warmupStart, end)) {
    for (const row of await source.rows('top50', year)) {
      if (row.trade_date < warmupStart || row.trade_date > end) continue;
      if (!top50ByDate.has(row.trade_date)) top50ByDate.set(row.trade_date, []);
      top50ByDate.get(row.trade_date).push(row.stock_code);
    }
    source.clearRows('top50', year);
  }
  const byDate = new Map();
  for (const year of yearsBetween(warmupStart, end)) {
    for (const row of await source.rows('stockDaily', year)) {
      if (row.trade_date < warmupStart || row.trade_date > end || !validBar(row)) continue;
      if (!byDate.has(row.trade_date)) byDate.set(row.trade_date, new Map());
      byDate.get(row.trade_date).set(row.stock_code, { symbol: row.stock_code, open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close), volume: Number(row.trade_volume || 0) });
    }
    source.clearRows('stockDaily', year);
  }
  return { start, end, dates: [...byDate.keys()].sort(), byDate, top50ByDate };
}

async function runDriveBacktest(options = {}) {
  const dataset = await loadDriveDataset(options);
  return runDailyBacktest(dataset, options);
}

module.exports = { fee, loadDriveDataset, runDailyBacktest, runDriveBacktest, technicalProxy };
