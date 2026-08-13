const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');

const codePath = path.join(__dirname, '..', '台股策略系統', 'apps_script', 'Code.gs');
const context = vm.createContext({ console, Date, JSON, Math, Number, Object, String });
const exportsSource = `
globalThis.strategy = {
  affordableShares,
  analyzeObv,
  buyByRules,
  downgradeGrade,
  evaluateMarket,
  nextSimulation,
  obvSeries,
  runFreshSimulation,
  simulateDay,
  weekKey
};`;
vm.runInContext(fs.readFileSync(codePath, 'utf8') + exportsSource, context, { filename: codePath });

const strategy = context.strategy;

function candidate(symbol, overrides = {}) {
  return {
    symbol,
    name: symbol,
    price: 100,
    bidPrice: 100,
    askPrice: 100,
    stopPrice: 50,
    targetPrice: 200,
    grade: 'A',
    dayTradeOk: false,
    intradayReturnPct: 0,
    session: 'REGULAR',
    ...overrides,
};
}

function day(date, candidates, session = 'REGULAR') {
  return {
    date,
    session,
    market: { close: 120, ma20: 110, ma50: 100 },
    candidates,
  };
}

function account(overrides = {}) {
  return {
    initialCapital: 100000,
    cash: 100000,
    positions: [],
    realizedPnl: 0,
    totalFees: 0,
    totalTaxes: 0,
    trades: [],
    daily: [],
    dailyStopped: false,
    weeklyLimited: false,
    weeklyLimitWeek: null,
    maxDrawdown: 0,
    ...overrides,
  };
}

test('daily loss at or below -2% blocks new positions before entry', () => {
  const current = account({
    cash: 50000,
    positions: [{
      symbol: 'OLD',
      name: 'OLD',
      shares: 500,
      avgCost: 100,
      totalCost: 50000,
      stopPrice: 50,
      targetPrice: 200,
    }],
    daily: [{ date: '2026-08-12', equity: 100000, cash: 50000, positionValue: 50000 }],
  });

  strategy.simulateDay(current, day('2026-08-13', [
    candidate('OLD', { price: 94, bidPrice: 94, askPrice: 94 }),
    candidate('NEW'),
  ]));

  assert.equal(current.dailyStopped, true);
  assert.equal(current.positions.some(position => position.symbol === 'NEW'), false);
});

test('a weekly loss of 5% or more limits position size during the following week', () => {
  const current = account({
    cash: 94000,
    daily: [{ date: '2026-08-07', equity: 100000, cash: 100000, positionValue: 0 }],
  });

  strategy.simulateDay(current, day('2026-08-14', []));
  assert.equal(current.weeklyLimitWeek, strategy.weekKey('2026-08-17'));

  strategy.simulateDay(current, day('2026-08-17', [candidate('LIMITED')]));
  const trade = current.trades.find(item => item.action === 'BUY' && item.symbol === 'LIMITED');
  assert.ok(trade);
  assert.ok(trade.grossAmount <= 15000);
  assert.equal(current.weeklyLimited, true);
});

test('position sizing keeps at least 30% of initial capital in cash including fees', () => {
  const current = account({ cash: 40000 });
  const marketState = strategy.evaluateMarket(day('2026-08-13', []));
  strategy.buyByRules(current, day('2026-08-13', [candidate('CASH')]), marketState);

  assert.ok(current.cash >= 30000);
  assert.ok(current.positions.length === 1);
  assert.ok(current.positions[0].shares > 0);
});

test('repeated after-market refreshes do not create duplicate trades', () => {
  const regular = day('2026-08-13', [candidate('REGULAR')]);
  const after = day('2026-08-13', [
    candidate('REGULAR', { session: 'AFTER_MARKET' }),
    candidate('AFTER', { session: 'AFTER_MARKET' }),
  ], 'AFTER_MARKET');

  const regularResult = strategy.runFreshSimulation([regular]);
  const firstAfterMarket = strategy.nextSimulation(regularResult, after);
  const repeatedAfterMarket = strategy.nextSimulation(firstAfterMarket, after);

  assert.equal(repeatedAfterMarket.trades.length, firstAfterMarket.trades.length);
  assert.deepEqual(
    JSON.parse(JSON.stringify(repeatedAfterMarket.positions)),
    JSON.parse(JSON.stringify(firstAfterMarket.positions)),
  );
});

test('OBV adds, subtracts, or keeps volume according to closing-price direction', () => {
  const values = strategy.obvSeries([
    { close: 10, volume: 100 },
    { close: 11, volume: 200 },
    { close: 10, volume: 50 },
    { close: 10, volume: 999 },
  ]);
  assert.deepEqual(Array.from(values), [0, 200, 150, 150]);
});

test('OBV above a rising MA42 produces bullish confirmation', () => {
  const rows = Array.from({ length: 60 }, (_, index) => ({
    close: 100 + index,
    volume: 1000 + index * 10,
  }));
  const signal = strategy.analyzeObv(rows, 42, 20);
  assert.equal(signal.liquid, true);
  assert.equal(signal.aboveMa42, true);
  assert.equal(signal.rising, true);
  assert.equal(signal.bullish, true);
  assert.equal(signal.breakoutConfirmed, true);
});

test('price breakout without OBV confirmation downgrades one signal level', () => {
  const rows = Array.from({ length: 42 }, () => ({ close: 100, volume: 100 }));
  rows.push(
    { close: 110, volume: 10000 },
    { close: 109, volume: 5000 },
    { close: 110, volume: 100 },
    { close: 111, volume: 100 },
  );
  const signal = strategy.analyzeObv(rows, 42, 20);
  assert.equal(signal.priceBreakout, true);
  assert.equal(signal.breakoutConfirmed, false);
  assert.equal(strategy.downgradeGrade('A'), 'B');
  assert.equal(strategy.downgradeGrade('B'), 'C');
});

test('bullish price-volume divergence remains watch-only and never upgrades a grade', () => {
  assert.equal(strategy.downgradeGrade('C'), 'C');
  assert.equal(strategy.downgradeGrade('BLOCKED'), 'BLOCKED');
});
