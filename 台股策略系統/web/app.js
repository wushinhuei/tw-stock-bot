const CONFIG = {
  initialCapital: 100000,
  simulationStartDate: '2026-08-20',
  boardLot: 1,
  standardPositionPct: 0.25,
  halfPositionPct: 0.15,
  minCashReservePct: 0.3,
  cashCautionPct: 0.4,
  dailyStopLossPct: -0.02,
  dailySoftStopLossPct: -0.005,
  dailyProfitLockPct: 0.003,
  weeklyStopLossPct: -0.05,
  minStrongPeers: 2,
  dayTradeCapitalPct: 0.08,
  overnightPositionPct: 0.12,
  afterMarketPositionPct: 0.1,
  brokerFeeRate: 0.001425,
  minBrokerFee: 1,
  stockSellTaxRate: 0.003,
  dayTradeSellTaxRate: 0.0015,
};

const defaultScenario = [
  {
    date: '2026-08-03',
    market: { close: 23600, ma20: 23450, ma50: 22900 },
    groups: { AI設備: 3, 電力: 2, 機器人: 1 },
    candidates: [
      stock('2382', '廣達', 'AI設備', 292, 282, 318, 'A', true, 0.012),
      stock('1513', '中興電', '電力', 184, 176, 202, 'B', true, 0.006),
      stock('2049', '上銀', '機器人', 232, 222, 255, 'C', false, 0),
    ],
  },
  {
    date: '2026-08-04',
    market: { close: 23920, ma20: 23520, ma50: 22980 },
    groups: { AI設備: 4, 電力: 2, 機器人: 2 },
    candidates: [
      stock('2382', '廣達', 'AI設備', 301, 284, 326, 'A', true, 0.009),
      stock('1513', '中興電', '電力', 188, 178, 205, 'B', false, 0),
      stock('2049', '上銀', '機器人', 238, 228, 262, 'B', true, 0.004),
    ],
  },
  {
    date: '2026-08-05',
    market: { close: 24180, ma20: 23610, ma50: 23040 },
    groups: { AI設備: 4, 電力: 1, 機器人: 2 },
    candidates: [
      stock('2382', '廣達', 'AI設備', 314, 294, 326, 'A', true, 0.015),
      stock('1513', '中興電', '電力', 181, 178, 205, 'BLOCKED', false, 0),
      stock('2049', '上銀', '機器人', 244, 231, 262, 'B', true, -0.003),
    ],
  },
  {
    date: '2026-08-06',
    market: { close: 24010, ma20: 23680, ma50: 23110 },
    groups: { AI設備: 3, 電力: 1, 機器人: 2 },
    candidates: [
      stock('2382', '廣達', 'AI設備', 327, 303, 326, 'A', false, 0),
      stock('1513', '中興電', '電力', 179, 178, 205, 'BLOCKED', false, 0),
      stock('2049', '上銀', '機器人', 251, 237, 262, 'B', true, 0.006),
    ],
  },
  {
    date: '2026-08-07',
    market: { close: 23580, ma20: 23720, ma50: 23180 },
    groups: { AI設備: 2, 電力: 1, 機器人: 1 },
    candidates: [
      stock('2382', '廣達', 'AI設備', 309, 303, 326, 'B', false, 0),
      stock('1513', '中興電', '電力', 176, 178, 205, 'BLOCKED', false, 0),
      stock('2049', '上銀', '機器人', 230, 237, 262, 'BLOCKED', false, 0),
    ],
  },
  {
    date: '2026-08-10',
    market: { close: 24320, ma20: 23900, ma50: 23100 },
    groups: { AI設備: 3, 電力: 1, 機器人: 2 },
    candidates: [
      stock('2382', '廣達', 'AI設備', 302, 284, 326, 'A', true, 0.01),
      stock('1513', '中興電', '電力', 184, 179, 205, 'BLOCKED', false, 0),
      stock('2049', '上銀', '機器人', 241, 228, 262, 'B', true, 0.005),
    ],
  },
];

let scenario = Array.isArray(window.ACTUAL_SCENARIO) && window.ACTUAL_SCENARIO.length
  ? window.ACTUAL_SCENARIO
  : defaultScenario;
let activeResult = null;
let activeLatestDay = null;
let refreshInFlight = false;
let refreshTimerId = null;
let tradeWatchTimerId = null;
let activeTradeSignature = '';

function stock(symbol, name, group, price, stopPrice, targetPrice, grade, dayTradeOk, intradayReturnPct) {
  const allA = grade === 'A';
  const tradable = grade === 'A' || grade === 'B';
  return {
    symbol,
    name,
    group,
    price,
    stopPrice,
    targetPrice,
    grade,
    dayTradeOk,
    overnightOk: allA && tradable,
    executionPlan: {
      allowEntry: allA,
      orderType: allA ? 'LIMIT' : 'NO_TRADE',
      chaseAllowed: false,
      cancelAfterSeconds: allA ? 90 : 0,
      dayTradeOk: Boolean(dayTradeOk && allA),
      reason: allA ? 'A 級共振但不追價，以限價等待' : '條件不足，先不操作',
    },
    overnightPlan: {
      ok: allA && tradable,
      positionPct: allA ? CONFIG.overnightPositionPct : 0,
      reason: allA ? '可列隔日沖候選，隔天不續強就出場' : '隔夜延續條件不足，不列隔日沖',
    },
    intradayReturnPct,
    industryOk: allA || tradable,
    fundamentalOk: allA,
    chipOk: allA,
    trendOk: tradable,
    volumePriceOk: tradable,
    momentumOk: tradable,
    session: 'REGULAR',
    afterMarketPrice: null,
    afterMarketVolume: 0,
  };
}

function currency(value) {
  return new Intl.NumberFormat('zh-TW', {
    style: 'currency',
    currency: 'TWD',
    maximumFractionDigits: 0,
  }).format(value);
}

function price(value) {
  return Number(value || 0).toLocaleString('zh-TW', { maximumFractionDigits: 2 });
}

function sessionLabel(session) {
  return session === 'AFTER_MARKET' ? '盤後定價' : '盤中';
}

function formatTaipeiDateTime(value) {
  const date = value ? new Date(value) : null;
  if (!date || Number.isNaN(date.getTime())) return '-';
  return new Intl.DateTimeFormat('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).format(date);
}

function todayTaipeiDate() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function pct(value) {
  return `${(Number(value || 0) * 100).toFixed(2)}%`;
}

function evaluateMarket(day) {
  const { close = 0, ma20 = 0, ma50 = 0 } = day?.market || {};
  if (close > ma20 && close > ma50) return { mode: 'AGGRESSIVE', label: '積極做多', maxGrade: 'A' };
  if (close <= ma50) return { mode: 'DEFENSIVE', label: '防守觀察', maxGrade: 'C' };
  return { mode: 'LIGHT', label: '輕倉觀察', maxGrade: 'B' };
}

function canOpenPosition(candidate, marketState, account) {
  if (account.dailyStopped) return false;
  if (candidate.grade === 'BLOCKED' || candidate.price <= candidate.stopPrice) return false;
  if (marketState.mode === 'DEFENSIVE') return false;
  if (candidate.executionPlan && !candidate.executionPlan.allowEntry) return false;
  return candidate.grade === 'A';
}

function positionPct(candidate, account) {
  const equity = account.finalEquity || account.initialCapital || CONFIG.initialCapital;
  const cashRatio = equity ? Number(account.cash || 0) / equity : 0;
  if (cashRatio < CONFIG.cashCautionPct) return Math.min(CONFIG.halfPositionPct, CONFIG.standardPositionPct / 2);
  if (account.weeklyLimited) return CONFIG.halfPositionPct;
  if (candidate.session === 'AFTER_MARKET') return CONFIG.afterMarketPositionPct;
  if (candidate.overnightOk) return CONFIG.overnightPositionPct;
  return candidate.grade === 'A' ? CONFIG.standardPositionPct : CONFIG.halfPositionPct;
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
    const startEquity = account.cash + marketValue(account.positions, day);

    sellByRules(account, day, marketState);
    rotateOutOfWeakPositions(account, day, marketState);
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
      startEquity,
      session: day.session || 'REGULAR',
    });
    previousEquity = equity;
  });

  const finalEquity = account.daily.at(-1)?.equity ?? account.initialCapital;
  return {
    ...account,
    finalEquity,
    totalReturn: finalEquity / account.initialCapital - 1,
    maxDrawdown,
  };
}

function sellByRules(account, day, marketState) {
  const stillHolding = [];
  account.positions.forEach(position => {
    const candidate = findCandidate(day, position.symbol);
    if (!candidate) {
      stillHolding.push(position);
      return;
    }

    const sellPrice = executionSellPrice(candidate);
    const value = position.shares * sellPrice;
    const shouldSell = sellPrice <= position.stopPrice
      || sellPrice >= position.targetPrice
      || candidate.grade === 'BLOCKED'
      || marketState.mode === 'DEFENSIVE';

    if (shouldSell) {
      const fee = tradeFee(value);
      const tax = sellTax(value, false);
      const proceeds = value - fee - tax;
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
        price: sellPrice,
        grossAmount: value,
        fee,
        tax,
        pnl,
        session: candidate.session || day.session || 'REGULAR',
        reason: `${sellReason(candidate, marketState, position)}；${sessionLabel(candidate.session || day.session)}`,
      });
    } else {
      stillHolding.push(position);
    }
  });
  account.positions = stillHolding;
}

function rotateOutOfWeakPositions(account, day, marketState) {
  if (marketState.mode === 'DEFENSIVE' || account.dailyStopped) return;
  const hasAOpportunity = day.candidates.some(candidate => canOpenPosition(candidate, marketState, account));
  if (!hasAOpportunity) return;

  const stillHolding = [];
  account.positions.forEach(position => {
    const candidate = findCandidate(day, position.symbol);
    if (!candidate || candidate.grade === 'A') {
      stillHolding.push(position);
      return;
    }

    const sellPrice = executionSellPrice(candidate);
    const value = position.shares * sellPrice;
    const fee = tradeFee(value);
    const tax = sellTax(value, false);
    const proceeds = value - fee - tax;
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
      price: sellPrice,
      grossAmount: value,
      fee,
      tax,
      pnl,
      session: candidate.session || day.session || 'REGULAR',
      reason: `出現 A 級候選股，非 A 持倉輪動轉出；${sessionLabel(candidate.session || day.session)}`,
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
      const buyPrice = executionBuyPrice(candidate);
      const lotCost = buyPrice * CONFIG.boardLot;
      const availableCash = tradableCash(account);
      const lotsByBudget = Math.floor(Math.min(budget, availableCash) / lotCost);
      const lots = lotsByBudget > 0 ? lotsByBudget : availableCash >= lotCost ? 1 : 0;
      const shares = lots * CONFIG.boardLot;
      if (shares <= 0) return;
      const cost = shares * buyPrice;
      const fee = tradeFee(cost);
      const totalCost = cost + fee;
      if (totalCost > tradableCash(account)) return;
      account.cash -= totalCost;
      account.totalFees += fee;
      account.positions.push({
        symbol: candidate.symbol,
        name: candidate.name,
        shares,
        avgCost: buyPrice,
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
        price: buyPrice,
        grossAmount: cost,
        fee,
        tax: 0,
        pnl: 0,
        session: candidate.session || day.session || 'REGULAR',
        reason: `${candidate.grade} 級共振，強制依規則買進；手續費 ${currency(fee)}；${sessionLabel(candidate.session || day.session)}`,
      });
    });
}

function runDayTrades(account, day, marketState) {
  if (day.session === 'AFTER_MARKET') return;
  if (marketState.mode === 'DEFENSIVE' || account.dailyStopped) return;
  day.candidates
    .filter(candidate => candidate.dayTradeOk && candidate.grade === 'A' && !hasTrade(account, day.date, candidate.symbol, '當沖'))
    .forEach(candidate => {
      const budget = account.initialCapital * CONFIG.dayTradeCapitalPct;
      const buyPrice = executionBuyPrice(candidate);
      const sellPrice = executionSellPrice(candidate);
      const lotCost = buyPrice * CONFIG.boardLot;
      const lots = Math.floor(Math.min(budget, tradableCash(account)) / lotCost);
      const shares = lots * CONFIG.boardLot;
      if (shares <= 0) return;
      const buyAmount = shares * buyPrice;
      const sellAmount = shares * sellPrice;
      const buyFee = tradeFee(buyAmount);
      if (buyAmount + buyFee > tradableCash(account)) return;
      const sellFee = tradeFee(sellAmount);
      const tax = sellTax(sellAmount, true);
      const netPnl = sellAmount - buyAmount - buyFee - sellFee - tax;
      account.realizedPnl += netPnl;
      account.totalFees += buyFee + sellFee;
      account.totalTaxes += tax;
      account.cash += netPnl;
      account.trades.push({
        date: day.date,
        action: '當沖',
        symbol: candidate.symbol,
        name: candidate.name,
        shares,
        price: buyPrice,
        grossAmount: buyAmount + sellAmount,
        fee: buyFee + sellFee,
        tax,
        pnl: netPnl,
        session: 'REGULAR',
        reason: `符合魔王線放量與三快減，日內模擬平倉；買 ${price(buyPrice)} / 賣 ${price(sellPrice)}`,
      });
    });
}

function hasTrade(account, date, symbol, action) {
  return account.trades.some(trade => trade.date === date && trade.symbol === symbol && trade.action === action);
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

function tradableCash(account) {
  const reserve = account.initialCapital * CONFIG.minCashReservePct;
  return Math.max(0, account.cash - reserve);
}

function executionBuyPrice(candidate) {
  return Number(candidate?.askPrice || candidate?.price || 0);
}

function executionSellPrice(candidate) {
  return Number(candidate?.bidPrice || candidate?.price || 0);
}

function marketValue(positions, day) {
  return positions.reduce((sum, position) => {
    const candidate = findCandidate(day, position.symbol);
    const grossValue = position.shares * (candidate ? executionSellPrice(candidate) : position.avgCost);
    return sum + netSellProceeds(grossValue, false);
  }, 0);
}

function findCandidate(day, symbol) {
  return (day?.candidates || []).find(candidate => candidate.symbol === symbol);
}

function sellReason(candidate, marketState, position) {
  if (candidate.price <= position.stopPrice) return '跌破停損，強制賣出';
  if (candidate.price >= position.targetPrice) return '達目標價，強制停利';
  if (candidate.grade === 'BLOCKED') return '訊號轉為禁止交易，防守賣出';
  if (marketState.mode === 'DEFENSIVE') return '大盤跌破 50MA，防守賣出';
  return '規則賣出';
}

function render(result) {
  activeResult = result;
  const latestDay = scenario.filter(day => day.date >= CONFIG.simulationStartDate).at(-1)
    || scenario.at(-1)
    || {
      date: CONFIG.simulationStartDate,
      candidates: [],
      source: { generatedAt: new Date().toISOString(), refreshMode: 'fallback' },
      session: 'REGULAR',
    };
  activeLatestDay = latestDay;
  renderLastUpdated(result, latestDay);
  document.querySelector('#finalEquity').textContent = currency(result.finalEquity);
  document.querySelector('#finalDate').textContent = `自 ${CONFIG.simulationStartDate} 起，截至 ${latestDay.date}`;
  document.querySelector('#totalReturn').textContent = pct(result.totalReturn);
  document.querySelector('#totalReturn').className = result.totalReturn >= 0 ? 'gain' : 'loss';
  document.querySelector('#realizedPnl').textContent = currency(result.realizedPnl);
  document.querySelector('#realizedPnl').className = result.realizedPnl >= 0 ? 'gain' : 'loss';
  document.querySelector('#tradeCount').textContent = `${result.trades.length} 筆自動交易；費稅 ${currency(result.totalFees + result.totalTaxes)}`;
  document.querySelector('#maxDrawdown').textContent = pct(result.maxDrawdown);
  document.querySelector('#maxDrawdown').className = 'loss';

  renderTodayDecision(result, latestDay);
  renderAGradeCandidates(latestDay);
  renderInternationalNews(latestDay.internationalNews || result.internationalNews || []);
  renderPositions(result, latestDay);
  renderTrades(result.trades, todayTaipeiDate());
  renderCurve(result.daily);
}

function renderLastUpdated(result, latestDay) {
  const label = document.querySelector('#lastUpdatedAt');
  if (!label) return;
  const sourceTime = result?.generatedAt || latestDay?.source?.generatedAt || window.PRECOMPUTED_SIMULATION?.generatedAt;
  const mode = latestDay?.source?.refreshMode === 'quick' ? '快速報價' : '完整資料';
  label.textContent = `最後更新：${formatTaipeiDateTime(sourceTime)}（${mode}）`;
}

function renderRefreshFallback(error) {
  console.warn(error);
  const result = currentSimulation();
  activeTradeSignature = resultTradeSignature(result);
  render(result);
  const label = document.querySelector('#lastUpdatedAt');
  if (label) label.textContent = `最後更新：${formatTaipeiDateTime(new Date().toISOString())}（使用備援資料）`;
}

function renderHistoryReturns(result) {
  const daily = Array.isArray(result.daily) ? result.daily : [];
  const trades = Array.isArray(result.trades) ? result.trades : [];
  const initialCapital = result.initialCapital || CONFIG.initialCapital;
  let peakEquity = initialCapital;

  document.querySelector('#historyFinalEquity').textContent = currency(result.finalEquity || initialCapital);
  document.querySelector('#historyTotalReturn').textContent = pct((result.finalEquity || initialCapital) / initialCapital - 1);
  document.querySelector('#historyTotalReturn').className = (result.finalEquity || initialCapital) >= initialCapital ? 'gain' : 'loss';
  document.querySelector('#historyMaxDrawdown').textContent = pct(result.maxDrawdown || 0);
  document.querySelector('#historyMaxDrawdown').className = (result.maxDrawdown || 0) < 0 ? 'loss' : 'flat';

  document.querySelector('#historyReturnRows').innerHTML = daily.map((day, index) => {
    const previousEquity = index > 0 ? daily[index - 1].equity : initialCapital;
    const dayPnl = day.equity - previousEquity;
    const dayReturn = previousEquity ? dayPnl / previousEquity : 0;
    const totalReturn = day.equity / initialCapital - 1;
    peakEquity = Math.max(peakEquity, day.equity);
    const drawdown = day.equity / peakEquity - 1;

    return `
      <tr>
        <td>${day.date}</td>
        <td>${currency(day.equity)}</td>
        <td class="${dayPnl >= 0 ? 'gain' : 'loss'}">${currency(dayPnl)}</td>
        <td class="${dayReturn >= 0 ? 'gain' : 'loss'}">${pct(dayReturn)}</td>
        <td class="${totalReturn >= 0 ? 'gain' : 'loss'}">${pct(totalReturn)}</td>
        <td class="${drawdown < 0 ? 'loss' : 'flat'}">${pct(drawdown)}</td>
        <td>${day.marketLabel || '-'}</td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="7">尚無歷史交易資料</td></tr>';

  const historyTradeDate = document.querySelector('#historyTradeDate');
  const historyDates = uniqueHistoryDates(daily, trades);
  if (historyTradeDate) {
    const previousValue = historyTradeDate.value;
    const selectedDate = historyDates.includes(previousValue) ? previousValue : historyDates[0] || '';
    historyTradeDate.disabled = historyDates.length === 0;
    historyTradeDate.innerHTML = historyDates.length
      ? historyDates.map(date => `<option value="${date}">${date}</option>`).join('')
      : '<option value="">尚無可查詢日期</option>';
    historyTradeDate.value = selectedDate;
    historyTradeDate.onchange = historyDates.length
      ? () => renderHistoryTradeRows(trades, historyTradeDate.value)
      : null;
    renderHistoryTradeRows(trades, selectedDate);
  }
}

function renderHistoryTradeRows(trades, selectedDate) {
  const filteredTrades = selectedDate ? trades.filter(trade => trade.date === selectedDate) : [];
  document.querySelector('#historyTradeRows').innerHTML = filteredTrades.slice().reverse().map(trade => `
    <tr>
      <td>${trade.date}<br><span>${sessionLabel(trade.session)}</span></td>
      <td><span class="badge ${actionBadgeClass(trade.action)}">${displayTradeAction(trade.action)}</span></td>
      <td><strong>${trade.symbol}</strong><br><span>${trade.name}</span></td>
      <td>${Number(trade.shares || 0).toLocaleString('zh-TW')}</td>
      <td>${price(trade.price)}</td>
      <td>${currency(trade.grossAmount || 0)}</td>
      <td>${currency(trade.fee || 0)}</td>
      <td>${currency(trade.tax || 0)}</td>
      <td class="${(trade.pnl || 0) >= 0 ? 'gain' : 'loss'}">${currency(trade.pnl || 0)}</td>
      <td class="reason">${displayTradeReason(trade.reason)}</td>
    </tr>
  `).join('') || '<tr><td colspan="10">該日期尚無交易明細</td></tr>';
}

function renderTodayDecision(result, day) {
  const marketState = evaluateMarket(day);
  const buys = day.candidates.filter(candidate => canOpenPosition(candidate, marketState, result));
  const preOpenPlan = day.preOpenPlan || day.source?.preOpenPlan;
  const text = buys.length
    ? `今日規則允許買進：${buys.map(item => `${item.symbol} ${item.name}`).join('、')}。`
    : '今日沒有乾淨新買點，系統只管理持倉與風控。';
  const cashRatio = result.finalEquity ? Number(result.cash || 0) / result.finalEquity : 0;
  const capitalText = `現金水位 ${pct(cashRatio)}；每日小賺達 ${pct(CONFIG.dailyProfitLockPct)} 後停止新增風險。`;
  document.querySelector('#todayDecision').innerHTML = `
    <div><strong>${marketState.label}</strong><span>${text}</span></div>
    <div><strong>${currency(result.finalEquity)}</strong><span>${capitalText}</span></div>
    ${preOpenPlan ? `<div><strong>開盤前：${preOpenPlan.stance}</strong><span>${preOpenPlan.checklist?.slice(0, 2).join('；') || '先確認國際股市與新聞面。'}</span></div>` : ''}
  `;
}

function renderPositions(result, day) {
  const rows = result.positions.map(position => {
    const candidate = findCandidate(day, position.symbol);
    const current = candidate ? executionSellPrice(candidate) : position.avgCost;
    const quoteSession = candidate ? sessionLabel(candidate.session || day.session) : sessionLabel(day.session);
    const value = position.shares * current;
    const netValue = netSellProceeds(value, false);
    const pnl = netValue - position.totalCost;
    const pnlPct = position.totalCost ? pnl / position.totalCost : 0;
    return `
      <tr>
        <td><strong>${position.symbol}</strong><br><span>${position.name}</span></td>
        <td>${position.shares.toLocaleString('zh-TW')}</td>
        <td>${price(position.avgCost)}</td>
        <td>${price(current)}<br><span>${quoteSession}</span></td>
        <td>${currency(netValue)}<br><span>稅費後估值</span></td>
        <td class="${pnl >= 0 ? 'gain' : 'loss'}">${currency(pnl)} (${pct(pnlPct)})</td>
        <td>
          <button type="button" class="status-button" data-position-status="${position.symbol}">
            ${positionStatus(candidate, position)}
          </button>
        </td>
      </tr>
    `;
  }).join('');
  document.querySelector('#positionRows').innerHTML = rows || '<tr><td colspan="7">目前無持股，系統等待下一個合格買點。</td></tr>';
  document.querySelectorAll('[data-position-status]').forEach(button => {
    button.addEventListener('click', () => openPositionStatus(button.dataset.positionStatus));
  });
}

function positionStatus(candidate, position) {
  if (!candidate) return '無今日資料';
  if (candidate.price <= position.stopPrice) return '跌破停損，下一日賣出';
  if (candidate.price >= position.targetPrice) return '達目標價，下一日停利';
  return candidate.grade === 'A' || candidate.grade === 'B' ? '續抱' : '防守觀察';
}

function openPositionStatus(symbol) {
  const modal = document.querySelector('#positionStatusModal');
  const content = document.querySelector('#positionStatusContent');
  if (!modal || !content || !activeResult || !activeLatestDay) return;
  const position = activeResult.positions.find(item => item.symbol === symbol);
  const candidate = findCandidate(activeLatestDay, symbol);
  if (!position) return;
  content.innerHTML = positionStatusDetail(position, candidate);
  modal.hidden = false;
  document.body.classList.add('modal-open');
  const closeButton = modal.querySelector('.icon-close');
  if (closeButton) closeButton.focus();
}

function positionStatusDetail(position, candidate) {
  const status = positionStatus(candidate, position);
  const current = candidate ? executionSellPrice(candidate) : position.avgCost;
  const netValue = netSellProceeds(position.shares * current, false);
  const pnl = netValue - position.totalCost;
  const checks = candidate ? [
    ['等級', candidate.grade || '-'],
    ['趨勢', candidate.trendOk ? '通過' : '未通過'],
    ['量價', candidate.volumePriceOk ? '通過' : '未通過'],
    ['動能', candidate.momentumOk ? '通過' : '未通過'],
    ['籌碼', candidate.chipOk ? '通過' : '未通過'],
    ['OBV', candidate.obvOk ? '通過' : '未通過'],
  ] : [['資料', '今日無候選股資料']];
  const reasons = positionStatusReasons(candidate, position, current);

  return `
    <section>
      <h3>${position.symbol} ${position.name}：${status}</h3>
      <div class="status-summary">
        <div><span>持股</span><strong>${position.shares.toLocaleString('zh-TW')} 股</strong></div>
        <div><span>成本</span><strong>${price(position.avgCost)}</strong></div>
        <div><span>現價</span><strong>${price(current)}</strong></div>
        <div><span>未實現損益</span><strong class="${pnl >= 0 ? 'gain' : 'loss'}">${currency(pnl)}</strong></div>
        <div><span>停損價</span><strong>${price(position.stopPrice)}</strong></div>
        <div><span>目標價</span><strong>${price(position.targetPrice)}</strong></div>
      </div>
    </section>
    <section>
      <h3>判斷原因</h3>
      <ul>${reasons.map(reason => `<li>${reason}</li>`).join('')}</ul>
    </section>
    <section>
      <h3>訊號檢查</h3>
      <div class="status-checks">
        ${checks.map(([label, value]) => `<div><span>${label}</span><strong>${value}</strong></div>`).join('')}
      </div>
    </section>
  `;
}

function executionOrderLabel(plan) {
  const map = {
    LIMIT_OR_MARKETABLE: '限價或小幅可成交價',
    LIMIT_ONLY: '只限價，不追價',
    LIMIT: '限價等待',
    NO_TRADE: '不操作',
  };
  return map[plan?.orderType] || '不操作';
}

function executionPlanText(candidate) {
  const plan = candidate.executionPlan || {};
  const chase = plan.chaseAllowed ? `可微追 ${pct(plan.maxChasePct || 0)}` : '不追價';
  const cancel = plan.cancelAfterSeconds ? `${plan.cancelAfterSeconds} 秒未成交抽單` : '不掛單';
  return `${executionOrderLabel(plan)} · ${chase} · ${cancel}`;
}

function overnightPlanText(candidate) {
  const plan = candidate.overnightPlan || {};
  if (!plan.ok && !candidate.overnightOk) return '隔日沖：不符合';
  return `隔日沖候選 · 建議部位 ${pct(plan.positionPct || CONFIG.overnightPositionPct)}`;
}

function renderAGradeCandidates(day) {
  const target = document.querySelector('#aGradeCandidates');
  if (!target || !day) return;
  const source = day.source?.universe || {};
  const today = todayTaipeiDate();
  const dataDate = String(day.date || '');
  const hasCurrentTradingData = dataDate === today;
  const aGrades = (day.candidates || [])
    .filter(candidate => (
      hasCurrentTradingData &&
      candidate.grade === 'A' &&
      Number.isFinite(Number(candidate.score)) &&
      Number(candidate.score) >= 80 &&
      candidate.executionPlan?.allowEntry === true &&
      !candidate.heldSupplement
    ))
    .sort((a, b) => (a.metrics?.volumeRank || 999) - (b.metrics?.volumeRank || 999));

  if (!aGrades.length) {
    const dateMessage = hasCurrentTradingData
      ? '今日資料已完成檢查，但沒有同時達到 80 分且允許進場的標的。'
      : `今日非交易日或當日資料尚未產生；目前最近資料日為 ${dataDate || '尚無資料'}。`;
    target.innerHTML = `
      <div class="empty-candidates">
        <strong>今日尚無 A 級候選股</strong>
        <span>${dateMessage} 系統已先過濾成交量前 ${source.topVolumeLimit || 50} 名與指定族群；無完整評分、未達 80 分或交易計畫不允許進場時，不列為 A 級候選。</span>
      </div>
    `;
    return;
  }

  target.innerHTML = aGrades.map(candidate => {
    const rank = candidate.metrics?.volumeRank ? `成交量第 ${candidate.metrics.volumeRank} 名` : '成交量排名：-';
    const volumeRatio = candidate.metrics?.volumeRatio ? `${Number(candidate.metrics.volumeRatio).toFixed(2)} 倍量` : '量能：-';
    const rsiText = candidate.metrics?.rsi14 != null ? `RSI ${Number(candidate.metrics.rsi14).toFixed(1)}` : 'RSI -';
    const macdText = candidate.metrics?.macdHist != null ? `MACD ${Number(candidate.metrics.macdHist).toFixed(2)}` : 'MACD -';
    const bidAsk = candidate.bidPrice != null && candidate.askPrice != null
      ? `買一 ${price(candidate.bidPrice)} / 賣一 ${price(candidate.askPrice)}`
      : '買賣價 -';
    const quoteTime = candidate.metrics?.latestQuoteTime
      ? `報價 ${formatTaipeiDateTime(candidate.metrics.latestQuoteTime)}`
      : '報價時間 -';
    const executionText = executionPlanText(candidate);
    const overnightText = overnightPlanText(candidate);
    const executionReason = candidate.executionPlan?.reason || '條件不足，先不操作';
    const overnightReason = candidate.overnightPlan?.reason || '';
    return `
      <article class="candidate-card">
        <div>
          <strong>${candidate.symbol} ${candidate.name}</strong>
          <span>${candidate.group} · ${rank}</span>
        </div>
        <div class="candidate-price">${price(candidate.price)}</div>
        <div class="candidate-quote"><strong>${candidate.score ?? '-'} 分</strong> · ${candidate.strategy || '策略待判定'}</div>
        ${candidate.components ? `<div class="candidate-signals"><span>技術 ${candidate.components.technical}/35</span><span>OBV量價 ${candidate.components.volumeObv}/20</span><span>籌碼 ${candidate.components.chip}/15</span><span>基本 ${candidate.components.fundamental}/10</span><span>官方＋媒體消息 ${candidate.components.officialNews}/15</span><span>執行 ${candidate.components.liquidity}/5</span></div>` : ''}
        <div class="candidate-quote">${bidAsk}<br>${quoteTime}</div>
        <div class="candidate-signals">
          <span>${volumeRatio}</span>
          <span>${rsiText}</span>
          <span>${macdText}</span>
        </div>
        <div class="candidate-plan">
          <span>停損 ${price(candidate.stopPrice)}</span>
          <span>目標 ${price(candidate.targetPrice)}</span>
        </div>
        <div class="candidate-execution">
          <span>${executionText}</span>
          <span>${overnightText}</span>
        </div>
        <div class="candidate-quote">${executionReason}${overnightReason ? `<br>${overnightReason}` : ''}</div>
      </article>
    `;
  }).join('');
}

function renderInternationalNews(items) {
  const target = document.querySelector('#internationalNews');
  if (!target) return;
  target.innerHTML = (items || []).slice(0, 12).map(item => `
    <article class="news-card">
      <div><strong>${internationalRiskLabel(item.risk)}影響 · ${internationalSentimentLabel(item.sentiment)}</strong><span>${internationalCategoryLabel(item.category)}</span></div>
      <h3>${item.titleZhTw || item.translatedTitle || item.title || '-'}</h3>
      <p>${item.summaryZhTw || item.translatedSummary || item.summary || '僅提供原文連結。'}</p>
      <a href="${item.url}" target="_blank" rel="noopener noreferrer">${item.source || '來源'} · ${formatTaipeiDateTime(item.publishedAt)}</a>
    </article>
  `).join('') || '<div class="empty-candidates"><strong>目前沒有國際 RSS 提示</strong><span>消息失敗不會中斷正式選股與持倉管理。</span></div>';
}

function internationalSentimentLabel(value) {
  return ({ POSITIVE: '正面', NEGATIVE: '負面', NEUTRAL: '中性', UNCERTAIN: '不確定' })[String(value || '').toUpperCase()] || value || '不確定';
}

function internationalRiskLabel(value) {
  return ({ HIGH: '高', MEDIUM: '中', LOW: '低' })[String(value || '').toUpperCase()] || value || '低';
}

function internationalCategoryLabel(value) {
  return ({
    'AI equipment': 'AI設備', 'Global markets': '全球市場', 'Macro economy': '總體經濟',
    Commodities: '原物料', Energy: '能源', Semiconductor: '半導體', Technology: '科技'
  })[String(value || '')] || value || '國際市場';
}

function positionStatusReasons(candidate, position, current) {
  if (!candidate) return ['目前沒有今日即時候選股資料，暫以原持倉資料估值。'];
  if (current <= position.stopPrice) return [`現價 ${price(current)} 已跌破停損價 ${price(position.stopPrice)}，依規則列為下一次賣出。`];
  if (current >= position.targetPrice) return [`現價 ${price(current)} 已達目標價 ${price(position.targetPrice)}，依規則列為停利候選。`];
  if (candidate.grade === 'A' || candidate.grade === 'B') {
    return [
      `目前等級為 ${candidate.grade}，核心訊號仍在可持有範圍。`,
      `現價 ${price(current)} 尚未跌破停損價 ${price(position.stopPrice)}。`,
      `現價尚未達目標價 ${price(position.targetPrice)}，系統繼續用規則管理持倉。`,
    ];
  }
  return [
    `目前等級為 ${candidate.grade || '未分級'}，未達 A/B 續抱強度，因此列為防守觀察。`,
    `尚未跌破停損價 ${price(position.stopPrice)}，所以沒有立即賣出。`,
    `系統會持續觀察趨勢、量價、動能與籌碼是否恢復。`,
  ];
}

function renderTrades(trades, currentDate) {
  const todayTrades = trades.filter(trade => trade.date === currentDate);
  document.querySelector('#tradeRows').innerHTML = todayTrades.slice().reverse().map(trade => `
    <tr>
      <td>${trade.date}<br><span>${sessionLabel(trade.session)}</span></td>
      <td><span class="badge ${actionBadgeClass(trade.action)}">${displayTradeAction(trade.action)}</span></td>
      <td><strong>${trade.symbol}</strong><br><span>${trade.name}</span></td>
      <td>${trade.shares.toLocaleString('zh-TW')}</td>
      <td>${price(trade.price)}</td>
      <td>${currency(trade.fee || 0)}</td>
      <td>${currency(trade.tax || 0)}</td>
      <td class="${trade.pnl >= 0 ? 'gain' : 'loss'}">${currency(trade.pnl)}</td>
      <td class="reason">${displayTradeReason(trade.reason)}</td>
    </tr>
  `).join('') || '<tr><td colspan="9">今日暫無交易。</td></tr>';
}

function uniqueHistoryDates(daily, trades) {
  return [...new Set(
    daily.map(day => day.date)
      .concat(trades.map(trade => trade.date))
      .filter(date => /^\d{4}-\d{2}-\d{2}$/.test(String(date || '')))
  )].sort().reverse();
}

function actionBadgeClass(action) {
  if (action === '買進' || action === 'BUY') return 'buy';
  if (action === '賣出' || action === 'SELL') return 'blocked';
  return 'watch';
}

function displayTradeAction(action) {
  const map = {
    BUY: '買進',
    SELL: '賣出',
    DAYTRADE: '當沖',
    buy: '買進',
    sell: '賣出',
    daytrade: '當沖',
  };
  return map[action] || action || '-';
}

function displayTradeReason(reason) {
  if (!reason) return '-';
  return String(reason)
    .replace(/Intraday rule simulation using current ask\/bid/g, '當沖規則模擬，使用目前委買／委賣價估算')
    .replace(/Rotate out of non-A holding because A-grade candidates are available/g, '出現 A 級候選股，非 A 持倉輪動轉出')
    .replace(/Existing holding quote supplement; not in current top-volume target scan/g, '既有持倉補報價；未列入今日成交量前 100 名目標族群掃描')
    .replace(/([ABC]) rule entry; fee ([0-9,.]+)/g, '$1 級共振，強制依規則買進；手續費 $2')
    .replace(/Stop loss/g, '跌破停損價')
    .replace(/Target reached/g, '達到目標價')
    .replace(/Signal blocked/g, '訊號遭規則阻擋')
    .replace(/Market defensive/g, '大盤進入防守模式')
    .replace(/Rule exit/g, '依出場規則賣出')
    .replace(/; after-hours fixed-price simulation/g, '；盤後定價模擬')
    .replace(/; regular-session simulation/g, '；盤中模擬')
    .replace(/after-hours fixed-price simulation/g, '盤後定價模擬')
    .replace(/regular-session simulation/g, '盤中模擬');
}

function renderCurve(days) {
  const values = days.map(day => day.equity);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const range = Math.max(1, max - min);
  document.querySelector('#equityCurve').innerHTML = days.map(day => {
    const height = 18 + ((day.equity - min) / range) * 120;
    return `<div class="bar" style="height:${height}px" title="${day.date} ${currency(day.equity)}"><span>${day.date.slice(5)}</span></div>`;
  }).join('');
}

function initRulesModal() {
  const modal = document.querySelector('#rulesModal');
  const openButton = document.querySelector('#openRulesButton');
  if (!modal || !openButton) return;

  const closeButtons = modal.querySelectorAll('[data-close-rules]');
  const close = () => {
    modal.hidden = true;
    document.body.classList.remove('modal-open');
    openButton.focus();
  };
  const open = () => {
    modal.hidden = false;
    document.body.classList.add('modal-open');
    const closeButton = modal.querySelector('.icon-close');
    if (closeButton) closeButton.focus();
  };

  openButton.addEventListener('click', open);
  closeButtons.forEach(button => button.addEventListener('click', close));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !modal.hidden) close();
  });
}

function initReturnsModal() {
  const modal = document.querySelector('#returnsModal');
  const openButton = document.querySelector('#openReturnsButton');
  if (!modal || !openButton) return;

  const closeButtons = modal.querySelectorAll('[data-close-returns]');
  const close = () => {
    modal.hidden = true;
    document.body.classList.remove('modal-open');
    openButton.focus();
  };
  const open = () => {
    renderHistoryReturns(activeResult || currentSimulation());
    modal.hidden = false;
    document.body.classList.add('modal-open');
    const closeButton = modal.querySelector('.icon-close');
    if (closeButton) closeButton.focus();
  };

  openButton.addEventListener('click', open);
  closeButtons.forEach(button => button.addEventListener('click', close));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !modal.hidden) close();
  });
}

function initPositionStatusModal() {
  const modal = document.querySelector('#positionStatusModal');
  if (!modal) return;

  const closeButtons = modal.querySelectorAll('[data-close-position-status]');
  const close = () => {
    modal.hidden = true;
    document.body.classList.remove('modal-open');
  };

  closeButtons.forEach(button => button.addEventListener('click', close));
  document.addEventListener('keydown', event => {
    if (event.key === 'Escape' && !modal.hidden) close();
  });
}

function currentSimulation() {
  scenario = Array.isArray(window.ACTUAL_SCENARIO) && window.ACTUAL_SCENARIO.length
    ? window.ACTUAL_SCENARIO
    : defaultScenario;
  const latestDay = scenario.filter(day => day.date >= CONFIG.simulationStartDate).at(-1);
  if (window.PRECOMPUTED_SIMULATION && latestDay) {
    return markToMarketResult(window.PRECOMPUTED_SIMULATION, latestDay);
  }
  return runSimulation(scenario);
}

function markToMarketResult(result, day) {
  const marked = {
    ...result,
    positions: Array.isArray(result.positions) ? result.positions : [],
    daily: Array.isArray(result.daily) ? [...result.daily] : [],
  };
  const positionValue = marketValue(marked.positions, day);
  const finalEquity = Number(marked.cash || 0) + positionValue;
  const previousDaily = marked.daily.length > 1 ? marked.daily[marked.daily.length - 2] : null;
  const previousEquity = previousDaily ? previousDaily.equity : marked.initialCapital || CONFIG.initialCapital;
  const lastDaily = marked.daily.at(-1);

  if (lastDaily) {
    marked.daily[marked.daily.length - 1] = {
      ...lastDaily,
      date: day.date,
      equity: finalEquity,
      cash: Number(marked.cash || 0),
      positionValue,
      dayPnl: finalEquity - previousEquity,
      marketLabel: evaluateMarket(day).label,
      session: day.session || lastDaily.session || 'REGULAR',
    };
  }

  marked.finalEquity = finalEquity;
  marked.totalReturn = finalEquity / (marked.initialCapital || CONFIG.initialCapital) - 1;
  marked.markedToMarketAt = day.source?.generatedAt || new Date().toISOString();
  return marked;
}

async function loadWindowAssignment(src, key) {
  const cleanSrc = src.split('?')[0];
  const text = await requestText(dataFileUrl(cleanSrc));
  const match = text.match(new RegExp(`window\\.${key}\\s*=\\s*([\\s\\S]*?);\\s*$`));
  if (!match) throw new Error(`Unable to parse ${key} from ${cleanSrc}`);
  return JSON.parse(match[1]);
}

function dataFileUrl(fileName) {
  const cacheBuster = `v=${Date.now()}`;
  if (location.hostname.endsWith('github.io')) {
    const encodedFile = encodeURIComponent(fileName);
    return `https://raw.githubusercontent.com/wushinhuei/tw-stock-bot/main/%E5%8F%B0%E8%82%A1%E7%AD%96%E7%95%A5%E7%B3%BB%E7%B5%B1/web/${encodedFile}?${cacheBuster}`;
  }
  return `${fileName}?${cacheBuster}`;
}

function requestText(url) {
  return new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open('GET', url, true);
    request.setRequestHeader('Cache-Control', 'no-cache');
    request.onload = () => {
      if (request.status >= 200 && request.status < 300) {
        resolve(request.responseText);
      } else {
        reject(new Error(`Unable to load ${url}`));
      }
    };
    request.onerror = () => reject(new Error(`Unable to load ${url}`));
    request.send();
  });
}

function appsScriptEndpoint() {
  const endpoint = String(window.APPS_SCRIPT_ENDPOINT || '').trim();
  return /^https:\/\/script\.google\.com\/macros\/s\/.+\/exec$/.test(endpoint) ? endpoint : '';
}

function cloudDashboardEndpoint() {
  const endpoint = String(window.CLOUD_DASHBOARD_ENDPOINT || '').trim();
  return /^https:\/\/[a-z0-9-]+(?:\.[a-z0-9-]+)*\.run\.app\/dashboard$/.test(endpoint) ? endpoint : '';
}

async function loadCloudDashboardPayload() {
  const endpoint = cloudDashboardEndpoint();
  if (!endpoint) return false;
  const url = new URL(endpoint);
  url.searchParams.set('t', Date.now());
  const response = await fetch(url.toString(), { cache: 'no-store' });
  if (!response.ok) throw new Error(`Cloud dashboard HTTP ${response.status}`);
  const payload = await response.json();
  if (!payload || payload.ok === false || !Array.isArray(payload.scenario) || !payload.simulation) {
    throw new Error(payload && payload.error ? payload.error : 'Invalid Cloud dashboard payload');
  }
  window.ACTUAL_SCENARIO = payload.scenario;
  window.PRECOMPUTED_SIMULATION = payload.simulation;
  return true;
}

async function loadCloudDashboardStatus() {
  const endpoint = cloudDashboardEndpoint();
  if (!endpoint) return null;
  const url = new URL(endpoint);
  url.searchParams.set('t', Date.now());
  const response = await fetch(url.toString(), { cache: 'no-store' });
  if (!response.ok) throw new Error(`Cloud dashboard HTTP ${response.status}`);
  const payload = await response.json();
  return payload && payload.ok !== false ? payload : null;
}

function appsScriptUrl(action, options = {}) {
  const url = new URL(appsScriptEndpoint());
  url.searchParams.set('action', action);
  url.searchParams.set('t', Date.now());
  if (options.force) url.searchParams.set('force', '1');
  return url.toString();
}

function requestJsonp(url) {
  return new Promise((resolve, reject) => {
    const callbackName = `twStockCallback_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    const script = document.createElement('script');
    const timer = window.setTimeout(() => {
      cleanup();
      reject(new Error(`Apps Script timeout ${url}`));
    }, 75000);
    const cleanup = () => {
      window.clearTimeout(timer);
      delete window[callbackName];
      script.remove();
    };

    window[callbackName] = payload => {
      cleanup();
      resolve(payload);
    };

    script.onerror = () => {
      cleanup();
      reject(new Error(`Unable to load Apps Script ${url}`));
    };

    const glue = url.includes('?') ? '&' : '?';
    script.src = `${url}${glue}callback=${encodeURIComponent(callbackName)}`;
    document.head.appendChild(script);
  });
}

async function loadAppsScriptPayload(action, options = {}) {
  const endpoint = appsScriptEndpoint();
  if (!endpoint) return false;
  const payload = await requestJsonp(appsScriptUrl(action, options));
  if (!payload || payload.ok === false || !Array.isArray(payload.scenario) || !payload.simulation) {
    throw new Error(payload && payload.error ? payload.error : 'Invalid Apps Script payload');
  }
  window.ACTUAL_SCENARIO = payload.scenario;
  window.PRECOMPUTED_SIMULATION = payload.simulation;
  return true;
}

async function loadAppsScriptStatus() {
  const endpoint = appsScriptEndpoint();
  if (!endpoint) return null;
  const payload = await requestJsonp(appsScriptUrl('status'));
  if (!payload || payload.ok === false) return null;
  return payload;
}

async function loadStaticPayload() {
  window.ACTUAL_SCENARIO = await loadWindowAssignment('actual_data.js', 'ACTUAL_SCENARIO');
  window.PRECOMPUTED_SIMULATION = await loadWindowAssignment('simulation_result.js', 'PRECOMPUTED_SIMULATION');
}

function taipeiNowParts() {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Taipei',
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(new Date());
  return Object.fromEntries(parts.map(part => [part.type, part.value]));
}

function isTaiwanMarketLive() {
  const now = taipeiNowParts();
  if (now.weekday === 'Sat' || now.weekday === 'Sun') return false;
  const minutes = Number(now.hour) * 60 + Number(now.minute);
  return minutes >= 8 * 60 + 55 && minutes <= 13 * 60 + 35;
}

function refreshIntervalMs() {
  return 30 * 60 * 1000;
}

function tradeWatchIntervalMs() {
  return 60 * 1000;
}

function resultTradeSignature(result) {
  const trades = Array.isArray(result?.trades) ? result.trades : [];
  const latestTrade = trades.length ? trades[trades.length - 1] : null;
  if (!latestTrade) return '0:none';
  return [
    trades.length,
    latestTrade.date || '',
    latestTrade.action || '',
    latestTrade.symbol || '',
    latestTrade.shares || '',
    latestTrade.price || '',
    latestTrade.pnl || ''
  ].join('|');
}

async function refreshData(options = {}) {
  if (refreshInFlight) return;
  refreshInFlight = true;
  const force = Boolean(options.force);
  const button = document.querySelector('#refreshDataButton');
  if (button) {
    button.disabled = true;
    button.classList.add('is-loading');
    button.textContent = '更新中...';
  }
  const lastUpdatedLabel = document.querySelector('#lastUpdatedAt');
  if (lastUpdatedLabel) lastUpdatedLabel.textContent = '最後更新：更新中...';

  try {
    const loadedFromCloud = force ? false : await loadCloudDashboardPayload().catch(error => {
      console.warn(error);
      return false;
    });
    const loadedFromAppsScript = loadedFromCloud ? false : await loadAppsScriptPayload(force ? 'refresh' : 'read', {
      force: Boolean(options.force),
    }).catch(error => {
      console.warn(error);
      return false;
    });
    if (!loadedFromCloud && !loadedFromAppsScript) await loadStaticPayload();
    scenario = window.ACTUAL_SCENARIO;
    const result = currentSimulation();
    activeTradeSignature = resultTradeSignature(result);
    render(result);
  } catch (error) {
    renderRefreshFallback(error);
  } finally {
    refreshInFlight = false;
    if (button) {
      button.disabled = false;
      button.classList.remove('is-loading');
      button.textContent = '更新資料';
    }
    if (lastUpdatedLabel && lastUpdatedLabel.textContent.includes('更新中')) {
      lastUpdatedLabel.textContent = `最後更新：${formatTaipeiDateTime(new Date().toISOString())}（使用目前畫面資料）`;
    }
  }
}

function initDataRefresh() {
  const refreshButton = document.querySelector('#refreshDataButton');
  if (refreshButton) refreshButton.addEventListener('click', () => refreshData({ force: true }));
  refreshData().finally(() => {
    scheduleNextRefresh();
    scheduleTradeWatch();
  });
}

function scheduleNextRefresh() {
  if (refreshTimerId) window.clearTimeout(refreshTimerId);
  refreshTimerId = window.setTimeout(() => {
    refreshData().finally(scheduleNextRefresh);
  }, refreshIntervalMs());
}

function scheduleTradeWatch() {
  if (tradeWatchTimerId) window.clearTimeout(tradeWatchTimerId);
  tradeWatchTimerId = window.setTimeout(() => {
    checkTradeUpdate().finally(scheduleTradeWatch);
  }, tradeWatchIntervalMs());
}

async function checkTradeUpdate() {
  if (refreshInFlight) return;
  const cloudStatus = await loadCloudDashboardStatus().catch(error => {
    console.warn(error);
    return null;
  });
  const status = cloudStatus || await loadAppsScriptStatus().catch(error => {
    console.warn(error);
    return null;
  });
  if (!status || !status.tradeSignature) return;
  if (!activeTradeSignature) {
    activeTradeSignature = status.tradeSignature;
    return;
  }
  if (status.tradeSignature !== activeTradeSignature) {
    await refreshData();
  }
}

initRulesModal();
initReturnsModal();
initPositionStatusModal();
initDataRefresh();
render(currentSimulation());
