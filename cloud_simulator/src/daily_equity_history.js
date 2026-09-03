'use strict';

function finite(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeDailyHistory(account) {
  const rows = Array.isArray(account?.daily) ? account.daily : [];
  const byDate = new Map();
  for (const row of rows) {
    const date = String(row?.date || '').slice(0, 10);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    byDate.set(date, { ...row, date });
  }
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function previousEquity(history, date, initialCapital) {
  const previous = history.filter(row => row.date < date).at(-1);
  return previous ? finite(previous.equity, initialCapital) : finite(initialCapital, 0);
}

function upsertDailyEquity(account, options = {}) {
  if (!account || typeof account !== 'object') throw new Error('account is required');
  const date = String(options.date || '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`Invalid daily equity date: ${options.date}`);

  const history = normalizeDailyHistory(account);
  const equity = finite(account.equity, finite(account.initialCapital, 0));
  const cash = finite(account.cash, finite(account.bankCash, 0));
  const positionValue = Math.max(0, finite(options.positionValue, equity - cash));
  const baseEquity = previousEquity(history, date, account.initialCapital);
  const existingIndex = history.findIndex(row => row.date === date);
  const existing = existingIndex >= 0 ? history[existingIndex] : null;
  const dayStartEquity = finite(existing?.dayStartEquity, finite(account.dayStartEquity, baseEquity));
  const peakBeforeToday = history
    .filter(row => row.date < date)
    .reduce((max, row) => Math.max(max, finite(row.equity, 0)), finite(account.initialCapital, 0));
  const peakEquity = Math.max(peakBeforeToday, equity);
  const drawdown = peakEquity > 0 ? equity / peakEquity - 1 : 0;

  const row = {
    ...(existing || {}),
    date,
    equity,
    cash,
    positionValue,
    dayPnl: equity - baseEquity,
    dayReturn: baseEquity > 0 ? equity / baseEquity - 1 : 0,
    cumulativeReturn: finite(account.initialCapital, 0) > 0 ? equity / finite(account.initialCapital, 0) - 1 : 0,
    drawdown,
    dayStartEquity,
    marketLabel: options.marketLabel || existing?.marketLabel || null,
    session: options.session || existing?.session || 'REGULAR',
    updatedAt: options.timestamp || new Date().toISOString()
  };

  if (existingIndex >= 0) history[existingIndex] = row;
  else history.push(row);
  history.sort((a, b) => a.date.localeCompare(b.date));
  account.daily = history;
  account.maxDrawdown = Math.min(0, ...history.map(item => finite(item.drawdown, 0)));
  return { row, created: existingIndex < 0, history };
}

module.exports = { normalizeDailyHistory, upsertDailyEquity };
