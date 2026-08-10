const fs = require('fs');
const path = require('path');

const CONFIG = {
  initialCapital: 100000,
  simulationStartDate: '2026-08-10',
  boardLot: 1,
  standardPositionPct: 0.2,
  halfPositionPct: 0.1,
  dailyStopLossPct: -0.02,
  weeklyStopLossPct: -0.05,
  dayTradeCapitalPct: 0.08,
  brokerFeeRate: 0.001425,
  minBrokerFee: 1,
  stockSellTaxRate: 0.003,
  dayTradeSellTaxRate: 0.0015,
};

const WEB_DIR = path.join(__dirname, 'web');
const ACTUAL_DATA_FILE = path.join(WEB_DIR, 'actual_data.js');
const OUT_FILE = path.join(WEB_DIR, 'simulation_result.js');
const JSON_OUT_FILE = path.join(__dirname, 'simulation_result.json');

function readScenario() {
  const text = fs.readFileSync(ACTUAL_DATA_FILE, 'utf8');
  const match = text.match(/window\.ACTUAL_SCENARIO\s*=\s*([\s\S]*?);\s*$/);
  if (!match) throw new Error('Cannot find window.ACTUAL_SCENARIO in actual_data.js');
  const scenario = JSON.parse(match[1]);
  if (!Array.isArray(scenario) || scenario.length === 0) throw new Error('ACTUAL_SCENARIO is empty');
  return scenario;
}

function readPreviousSimulation() {
  if (!fs.existsSync(OUT_FILE)) return null;
  const text = fs.readFileSync(OUT_FILE, 'utf8');
  const match = text.match(/window\.PRECOMPUTED_SIMULATION\s*=\s*([\s\S]*?);\s*$/);
  if (!match) return null;
  return JSON.parse(match[1]);
}

function evaluateMarket(day) {
  const { close, ma20, ma50 } = day.market;
  if (close > ma20 && close > ma50) return { mode: 'AGGRESSIVE', label: '積極做多', maxGrade: 'A' };
  if (close <= ma50) return { mode: 'DEFENSIVE', label: '防守觀察', maxGrade: 'C' };
  return { mode: 'LIGHT', label: '輕倉觀察', maxGrade: 'B' };
}

function canOpenPosition(candidate, marketState, account) {
  if (account.dailyStopped) return false;
  if (candidate.grade === 'BLOCKED' || candidate.price <= candidate.stopPrice) return false;
  if (marketState.mode === 'DEFENSIVE') return false;
  if (candidate.grade === 'A') return true;
  return candidate.grade === 'B' && marketState.mode === 'AGGRESSIVE';
}

function positionPct(candidate, account) {
  if (account.weeklyLimited) return CONFIG.halfPositionPct;
  return candidate.grade === 'A' ? CONFIG.standardPositionPct : CONFIG.halfPositionPct;
}

function tradeFee(amount) {
  if (amount <= 0) return 0;
  return Math.max(CONFIG.minBrokerFee, Math.round(amount * CONFIG.brokerFeeRate));
}

function sellTax(amount, isDayTrade) {
  return Math.round(amount * (isDayTrade ? CONFIG.dayTradeSellTaxRate : CONFIG.stockSellTaxRate));
}

function netSellProceeds(amount, isDayTrade) {
  return amount - tradeFee(amount) - sellTax(amount, isDayTrade);
}

function findCandidate(day, symbol) {
  return day.candidates.find(candidate => candidate.symbol === symbol);
}

function marketValue(positions, day) {
  return positions.reduce((sum, position) => {
    const candidate = findCandidate(day, position.symbol);
    const grossValue = position.shares * (candidate ? candidate.price : position.avgCost);
    return sum + netSellProceeds(grossValue, false);
  }, 0);
}

function markToMarket(previous, day) {
  const account = {
    ...previous,
    positions: Array.isArray(previous.positions) ? previous.positions : [],
    trades: Array.isArray(previous.trades) ? previous.trades : [],
    daily: Array.isArray(previous.daily) ? [...previous.daily] : [],
  };
  const positionValue = marketValue(account.positions, day);
  const equity = Number(account.cash || 0) + positionValue;
  const previousDaily = account.daily.length > 1 ? account.daily[account.daily.length - 2] : null;
  const previousEquity = previousDaily ? previousDaily.equity : account.initialCapital || CONFIG.initialCapital;
  const lastDaily = account.daily.at(-1);

  if (lastDaily) {
    account.daily[account.daily.length - 1] = {
      ...lastDaily,
      date: day.date,
      equity,
      cash: Number(account.cash || 0),
      positionValue,
      dayPnl: equity - previousEquity,
      marketLabel: evaluateMarket(day).label,
    };
  } else {
    account.daily.push({
      date: day.date,
      equity,
      cash: Number(account.cash || 0),
      positionValue,
      dayPnl: equity - (account.initialCapital || CONFIG.initialCapital),
      marketLabel: evaluateMarket(day).label,
    });
  }

  return {
    ...account,
    finalEquity: equity,
    totalReturn: equity / (account.initialCapital || CONFIG.initialCapital) - 1,
    maxDrawdown: Math.min(account.maxDrawdown || 0, equity / (account.initialCapital || CONFIG.initialCapital) - 1),
    generatedAt: new Date().toISOString(),
    source: day.source || null,
  };
}

function sellReason(candidate, marketState, position) {
  if (candidate.price <= position.stopPrice) return '跌破停損，強制賣出';
  if (candidate.price >= position.targetPrice) return '達目標價，強制停利';
  if (candidate.grade === 'BLOCKED') return '訊號轉為禁止交易，防守賣出';
  if (marketState.mode === 'DEFENSIVE') return '大盤跌破 50MA，防守賣出';
  return '規則賣出';
}

function sellByRules(account, day, marketState) {
  const stillHolding = [];
  account.positions.forEach(position => {
    const candidate = findCandidate(day, position.symbol);
    if (!candidate) {
      stillHolding.push(position);
      return;
    }

    const grossAmount = position.shares * candidate.price;
    const shouldSell = candidate.price <= position.stopPrice
      || candidate.price >= position.targetPrice
      || candidate.grade === 'BLOCKED'
      || marketState.mode === 'DEFENSIVE';

    if (!shouldSell) {
      stillHolding.push(position);
      return;
    }

    const fee = tradeFee(grossAmount);
    const tax = sellTax(grossAmount, false);
    const proceeds = grossAmount - fee - tax;
    const pnl = proceeds - position.totalCost;
    account.cash += proceeds;
    account.realizedPnl += pnl;
    account.totalFees += fee;
    account.totalTaxes += tax;
    account.trades.push({
      date: day.date,
      action: '賣出',
      symbol: position.symbol,
      name: position.name,
      shares: position.shares,
      price: candidate.price,
      grossAmount,
      fee,
      tax,
      pnl,
      reason: sellReason(candidate, marketState, position),
    });
  });
  account.positions = stillHolding;
}

function buyByRules(account, day, marketState) {
  day.candidates
    .filter(candidate => canOpenPosition(candidate, marketState, account))
    .forEach(candidate => {
      if (account.positions.some(position => position.symbol === candidate.symbol)) return;
      const budget = account.initialCapital * positionPct(candidate, account);
      const unitCost = candidate.price * CONFIG.boardLot;
      const unitsByBudget = Math.floor(Math.min(budget, account.cash) / unitCost);
      const units = unitsByBudget > 0 ? unitsByBudget : account.cash >= unitCost ? 1 : 0;
      const shares = units * CONFIG.boardLot;
      if (shares <= 0) return;

      const grossAmount = shares * candidate.price;
      const fee = tradeFee(grossAmount);
      const totalCost = grossAmount + fee;
      if (totalCost > account.cash) return;

      account.cash -= totalCost;
      account.totalFees += fee;
      account.positions.push({
        symbol: candidate.symbol,
        name: candidate.name,
        shares,
        avgCost: candidate.price,
        totalCost,
        stopPrice: candidate.stopPrice,
        targetPrice: candidate.targetPrice,
      });
      account.trades.push({
        date: day.date,
        action: '買進',
        symbol: candidate.symbol,
        name: candidate.name,
        shares,
        price: candidate.price,
        grossAmount,
        fee,
        tax: 0,
        pnl: 0,
        reason: `${candidate.grade} 級共振，強制依規則買進；手續費 ${formatCurrency(fee)}`,
      });
    });
}

function runDayTrades(account, day, marketState) {
  if (marketState.mode === 'DEFENSIVE' || account.dailyStopped) return;
  day.candidates
    .filter(candidate => candidate.dayTradeOk && candidate.grade !== 'BLOCKED')
    .forEach(candidate => {
      const budget = account.initialCapital * CONFIG.dayTradeCapitalPct;
      const unitCost = candidate.price * CONFIG.boardLot;
      const units = Math.floor(Math.min(budget, account.cash) / unitCost);
      const shares = units * CONFIG.boardLot;
      if (shares <= 0) return;

      const buyAmount = shares * candidate.price;
      const buyFee = tradeFee(buyAmount);
      if (buyAmount + buyFee > account.cash) return;
      const sellPrice = candidate.price * (1 + candidate.intradayReturnPct);
      const sellAmount = shares * sellPrice;
      const sellFee = tradeFee(sellAmount);
      const tax = sellTax(sellAmount, true);
      const pnl = sellAmount - buyAmount - buyFee - sellFee - tax;
      account.cash += pnl;
      account.realizedPnl += pnl;
      account.totalFees += buyFee + sellFee;
      account.totalTaxes += tax;
      account.trades.push({
        date: day.date,
        action: '當沖',
        symbol: candidate.symbol,
        name: candidate.name,
        shares,
        price: candidate.price,
        grossAmount: buyAmount + sellAmount,
        fee: buyFee + sellFee,
        tax,
        pnl,
        reason: `符合魔王線放量與三快減，日內模擬平倉；買 ${formatPrice(candidate.price)} / 賣 ${formatPrice(sellPrice)}`,
      });
    });
}

function runSimulation(days) {
  const simulationDays = days.filter(day => day.date >= CONFIG.simulationStartDate);
  const account = {
    initialCapital: CONFIG.initialCapital,
    cash: CONFIG.initialCapital,
    positions: [],
    realizedPnl: 0,
    totalFees: 0,
    totalTaxes: 0,
    trades: [],
    daily: [],
    dailyStopped: false,
    weeklyLimited: false,
  };

  let previousEquity = CONFIG.initialCapital;
  let peakEquity = CONFIG.initialCapital;
  let maxDrawdown = 0;

  simulationDays.forEach(day => {
    const marketState = evaluateMarket(day);
    account.dailyStopped = false;

    sellByRules(account, day, marketState);
    buyByRules(account, day, marketState);
    runDayTrades(account, day, marketState);

    const positionValue = marketValue(account.positions, day);
    const equity = account.cash + positionValue;
    const dayPnl = equity - previousEquity;
    const dayReturn = dayPnl / previousEquity;
    if (dayReturn <= CONFIG.dailyStopLossPct) account.dailyStopped = true;
    peakEquity = Math.max(peakEquity, equity);
    maxDrawdown = Math.min(maxDrawdown, equity / peakEquity - 1);
    account.weeklyLimited = equity / account.initialCapital - 1 <= CONFIG.weeklyStopLossPct;
    account.daily.push({
      date: day.date,
      equity,
      cash: account.cash,
      positionValue,
      dayPnl,
      marketLabel: marketState.label,
    });
    previousEquity = equity;
  });

  const finalEquity = account.daily.at(-1).equity;
  return {
    ...account,
    finalEquity,
    totalReturn: finalEquity / account.initialCapital - 1,
    maxDrawdown,
    generatedAt: new Date().toISOString(),
    source: days.at(-1).source || null,
  };
}

function formatCurrency(value) {
  return new Intl.NumberFormat('zh-TW', {
    style: 'currency',
    currency: 'TWD',
    maximumFractionDigits: 0,
  }).format(value);
}

function formatPrice(value) {
  return Number(value || 0).toLocaleString('zh-TW', { maximumFractionDigits: 2 });
}

function main() {
  const scenario = readScenario();
  const latestDay = scenario.at(-1);
  const previous = readPreviousSimulation();
  const previousLatestDay = previous && Array.isArray(previous.daily) ? previous.daily.at(-1) : null;
  const result = previousLatestDay && previousLatestDay.date === latestDay.date
    ? markToMarket(previous, latestDay)
    : runSimulation(scenario);
  const payload = {
    config: CONFIG,
    result,
  };
  fs.writeFileSync(JSON_OUT_FILE, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');
  fs.writeFileSync(OUT_FILE, `window.PRECOMPUTED_SIMULATION = ${JSON.stringify(result, null, 2)};\n`, 'utf8');
  console.log(`Wrote ${OUT_FILE}`);
  console.log(`Final equity ${formatCurrency(result.finalEquity)}, return ${(result.totalReturn * 100).toFixed(2)}%`);
}

main();
