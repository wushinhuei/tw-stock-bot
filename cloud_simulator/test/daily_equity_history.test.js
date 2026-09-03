'use strict';

const assert = require('node:assert/strict');
const { upsertDailyEquity } = require('../src/daily_equity_history');

(function createsFirstDailySnapshot() {
  const account = { initialCapital: 100000, equity: 101000, cash: 81000, daily: [] };
  const result = upsertDailyEquity(account, { date: '2026-09-03', timestamp: '2026-09-03T05:30:00.000Z' });
  assert.equal(result.created, true);
  assert.equal(account.daily.length, 1);
  assert.equal(account.daily[0].equity, 101000);
  assert.equal(account.daily[0].positionValue, 20000);
  assert.equal(account.daily[0].dayPnl, 1000);
})();

(function sameDayUpsertsInsteadOfDuplicating() {
  const account = { initialCapital: 100000, equity: 101000, cash: 81000, daily: [] };
  upsertDailyEquity(account, { date: '2026-09-03', timestamp: '2026-09-03T01:30:00.000Z' });
  account.equity = 102500;
  account.cash = 82000;
  const result = upsertDailyEquity(account, { date: '2026-09-03', timestamp: '2026-09-03T05:30:00.000Z' });
  assert.equal(result.created, false);
  assert.equal(account.daily.length, 1);
  assert.equal(account.daily[0].equity, 102500);
  assert.equal(account.daily[0].positionValue, 20500);
  assert.equal(account.daily[0].dayPnl, 2500);
})();

(function nextDayUsesPriorEquityAsBase() {
  const account = {
    initialCapital: 100000,
    equity: 101000,
    cash: 81000,
    daily: [{ date: '2026-09-02', equity: 100500, cash: 80500, positionValue: 20000 }]
  };
  upsertDailyEquity(account, { date: '2026-09-03' });
  assert.equal(account.daily.length, 2);
  assert.equal(account.daily[1].dayPnl, 500);
  assert.equal(account.daily[1].dayReturn, 101000 / 100500 - 1);
})();

console.log('daily equity history tests passed');
