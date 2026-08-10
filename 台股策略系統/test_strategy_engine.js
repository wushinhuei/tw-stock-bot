const test = require('node:test');
const assert = require('node:assert/strict');
const {
  evaluateMarket,
  evaluateWatchlist,
  isInBreakoutCooldown,
} = require('./strategy_engine');

function baseInput(overrides = {}) {
  return {
    date: '2026-08-10',
    portfolio: {
      equity: 300000,
      dailyRealizedPnlPct: 0,
      weeklyRealizedPnlPct: 0,
      ...(overrides.portfolio || {}),
    },
    market: {
      close: 24000,
      ma20: 23500,
      ma50: 23000,
      ...(overrides.market || {}),
    },
    groups: {
      AI: { strongPeers: 3 },
      ...(overrides.groups || {}),
    },
    breakoutHistory: overrides.breakoutHistory || {},
    candidates: overrides.candidates || [
      {
        symbol: 'TEST',
        name: '測試股',
        group: 'AI',
        lineKey: '景線',
        industryOk: true,
        fundamentalOk: true,
        chipOk: true,
        trendOk: true,
        volumePriceOk: true,
        momentumOk: true,
      },
    ],
  };
}

test('大盤跌破 50MA 時最高只能觀察，不產生追價買進', () => {
  const market = evaluateMarket({ close: 22000, ma20: 23000, ma50: 23500 });
  assert.equal(market.mode, 'DEFENSIVE');
  assert.equal(market.maxGrade, 'C');

  const result = evaluateWatchlist(baseInput({
    market: { close: 22000, ma20: 23000, ma50: 23500 },
  }));
  assert.equal(result.candidates[0].grade, 'BLOCKED');
  assert.equal(result.candidates[0].canBuy, false);
});

test('單日虧損達 2% 後停止交易', () => {
  const result = evaluateWatchlist(baseInput({
    portfolio: { dailyRealizedPnlPct: -0.021 },
  }));
  assert.equal(result.lossLimits.isDailyStopped, true);
  assert.equal(result.candidates[0].grade, 'BLOCKED');
  assert.match(result.candidates[0].blockedReasons.join(' '), /單日最大虧損/);
});

test('單週虧損達 5% 後 A 級訊號降為 B 級', () => {
  const result = evaluateWatchlist(baseInput({
    portfolio: { weeklyRealizedPnlPct: -0.051 },
  }));
  assert.equal(result.lossLimits.isWeeklyLimited, true);
  assert.equal(result.candidates[0].rawGrade, 'A');
  assert.equal(result.candidates[0].grade, 'B');
});

test('C 級訊號只能觀察不能買', () => {
  const result = evaluateWatchlist(baseInput({
    candidates: [
      {
        symbol: 'TECHONLY',
        name: '只有技術',
        group: 'AI',
        trendOk: true,
        volumePriceOk: true,
        momentumOk: true,
        industryOk: false,
        fundamentalOk: false,
        chipOk: false,
      },
    ],
  }));
  assert.equal(result.candidates[0].grade, 'C');
  assert.equal(result.candidates[0].canBuy, false);
});

test('假突破後 1-3 天內進入冷卻', () => {
  const cooldown = isInBreakoutCooldown(
    { symbol: 'TEST', lineKey: '景線' },
    { TEST: [{ lineKey: '景線', fakeBreakoutDate: '2026-08-08' }] },
    '2026-08-10'
  );
  assert.ok(cooldown);

  const result = evaluateWatchlist(baseInput({
    breakoutHistory: {
      TEST: [{ lineKey: '景線', fakeBreakoutDate: '2026-08-08' }],
    },
  }));
  assert.equal(result.candidates[0].grade, 'BLOCKED');
  assert.match(result.candidates[0].blockedReasons.join(' '), /假突破冷卻/);
});

