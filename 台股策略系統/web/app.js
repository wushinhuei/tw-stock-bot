const CONFIG = {
  initialCapital: 100000,
  simulationStartDate: '2026-08-10',
  boardLot: 1,
  standardPositionPct: 0.2,
  halfPositionPct: 0.1,
  dailyStopLossPct: -0.02,
  weeklyStopLossPct: -0.05,
  minStrongPeers: 2,
  dayTradeCapitalPct: 0.08,
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
    intradayReturnPct,
    industryOk: allA || tradable,
    fundamentalOk: allA,
    chipOk: allA,
    trendOk: tradable,
    volumePriceOk: tradable,
    momentumOk: tradable,
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

function pct(value) {
  return `${(Number(value || 0) * 100).toFixed(2)}%`;
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
    });
    previousEquity = equity;
  });

  const finalEquity = account.daily.at(-1).equity;
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

    const value = position.shares * candidate.price;
    const shouldSell = candidate.price <= position.stopPrice
      || candidate.price >= position.targetPrice
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
        price: candidate.price,
        grossAmount: value,
        fee,
        tax,
        pnl,
        reason: sellReason(candidate, marketState, position),
      });
    } else {
      stillHolding.push(position);
    }
  });
  account.positions = stillHolding;
}

function buyByRules(account, day, marketState) {
  day.candidates
    .filter(candidate => canOpenPosition(candidate, marketState, account))
    .forEach(candidate => {
      if (account.positions.some(position => position.symbol === candidate.symbol)) return;
      const budget = account.initialCapital * positionPct(candidate, account);
      const lotCost = candidate.price * CONFIG.boardLot;
      const lotsByBudget = Math.floor(Math.min(budget, account.cash) / lotCost);
      const lots = lotsByBudget > 0 ? lotsByBudget : account.cash >= lotCost ? 1 : 0;
      const shares = lots * CONFIG.boardLot;
      if (shares <= 0) return;
      const cost = shares * candidate.price;
      const fee = tradeFee(cost);
      const totalCost = cost + fee;
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
        grossAmount: cost,
        fee,
        tax: 0,
        pnl: 0,
        reason: `${candidate.grade} 級共振，強制依規則買進；手續費 ${currency(fee)}`,
      });
    });
}

function runDayTrades(account, day, marketState) {
  if (marketState.mode === 'DEFENSIVE' || account.dailyStopped) return;
  day.candidates
    .filter(candidate => candidate.dayTradeOk && candidate.grade !== 'BLOCKED')
    .forEach(candidate => {
      const budget = account.initialCapital * CONFIG.dayTradeCapitalPct;
      const lotCost = candidate.price * CONFIG.boardLot;
      const lots = Math.floor(Math.min(budget, account.cash) / lotCost);
      const shares = lots * CONFIG.boardLot;
      if (shares <= 0) return;
      const buyAmount = shares * candidate.price;
      const sellPrice = candidate.price * (1 + candidate.intradayReturnPct);
      const sellAmount = shares * sellPrice;
      const buyFee = tradeFee(buyAmount);
      if (buyAmount + buyFee > account.cash) return;
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
        price: candidate.price,
        grossAmount: buyAmount + sellAmount,
        fee: buyFee + sellFee,
        tax,
        pnl: netPnl,
        reason: `符合魔王線放量與三快減，日內模擬平倉；買 ${price(candidate.price)} / 賣 ${price(sellPrice)}`,
      });
    });
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

function marketValue(positions, day) {
  return positions.reduce((sum, position) => {
    const candidate = findCandidate(day, position.symbol);
    const grossValue = position.shares * (candidate ? candidate.price : position.avgCost);
    return sum + netSellProceeds(grossValue, false);
  }, 0);
}

function findCandidate(day, symbol) {
  return day.candidates.find(candidate => candidate.symbol === symbol);
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
  const latestDay = scenario.filter(day => day.date >= CONFIG.simulationStartDate).at(-1);
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
  renderPositions(result, latestDay);
  renderDailyRows(result.daily);
  renderTrades(result.trades);
  renderCurve(result.daily);
}

function renderHistoryReturns(result) {
  const daily = Array.isArray(result.daily) ? result.daily : [];
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
}

function renderTodayDecision(result, day) {
  const marketState = evaluateMarket(day);
  const buys = day.candidates.filter(candidate => canOpenPosition(candidate, marketState, result));
  const text = buys.length
    ? `今日規則允許買進：${buys.map(item => `${item.symbol} ${item.name}`).join('、')}。`
    : '今日沒有新買點，系統只管理持倉與風控。';
  document.querySelector('#todayDecision').innerHTML = `
    <div><strong>${marketState.label}</strong><span>${text}</span></div>
    <div><strong>${currency(result.finalEquity)}</strong><span>目前模擬總資產</span></div>
  `;
}

function renderPositions(result, day) {
  const rows = result.positions.map(position => {
    const candidate = findCandidate(day, position.symbol);
    const current = candidate ? candidate.price : position.avgCost;
    const value = position.shares * current;
    const netValue = netSellProceeds(value, false);
    const pnl = netValue - position.totalCost;
    const pnlPct = position.totalCost ? pnl / position.totalCost : 0;
    return `
      <tr>
        <td><strong>${position.symbol}</strong><br><span>${position.name}</span></td>
        <td>${position.shares.toLocaleString('zh-TW')}</td>
        <td>${price(position.avgCost)}</td>
        <td>${price(current)}</td>
        <td>${currency(netValue)}<br><span>稅費後估值</span></td>
        <td class="${pnl >= 0 ? 'gain' : 'loss'}">${currency(pnl)} (${pct(pnlPct)})</td>
        <td>${positionStatus(candidate, position)}</td>
      </tr>
    `;
  }).join('');
  document.querySelector('#positionRows').innerHTML = rows || '<tr><td colspan="7">目前無持股，系統等待下一個合格買點。</td></tr>';
}

function positionStatus(candidate, position) {
  if (!candidate) return '無今日資料';
  if (candidate.price <= position.stopPrice) return '跌破停損，下一日賣出';
  if (candidate.price >= position.targetPrice) return '達目標價，下一日停利';
  return candidate.grade === 'A' || candidate.grade === 'B' ? '續抱' : '防守觀察';
}

function renderDailyRows(days) {
  document.querySelector('#dailyRows').innerHTML = days.map(day => `
    <tr>
      <td>${day.date}</td>
      <td>${currency(day.equity)}</td>
      <td>${currency(day.cash)}</td>
      <td>${currency(day.positionValue)}</td>
      <td class="${day.dayPnl >= 0 ? 'gain' : 'loss'}">${currency(day.dayPnl)}</td>
      <td>${day.marketLabel}</td>
    </tr>
  `).join('');
}

function renderTrades(trades) {
  document.querySelector('#tradeRows').innerHTML = trades.slice().reverse().map(trade => `
    <tr>
      <td>${trade.date}</td>
      <td><span class="badge ${trade.action === '買進' ? 'buy' : trade.action === '賣出' ? 'blocked' : 'watch'}">${trade.action}</span></td>
      <td><strong>${trade.symbol}</strong><br><span>${trade.name}</span></td>
      <td>${trade.shares.toLocaleString('zh-TW')}</td>
      <td>${price(trade.price)}</td>
      <td>${currency(trade.fee || 0)}</td>
      <td>${currency(trade.tax || 0)}</td>
      <td class="${trade.pnl >= 0 ? 'gain' : 'loss'}">${currency(trade.pnl)}</td>
      <td class="reason">${trade.reason}</td>
    </tr>
  `).join('');
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

async function refreshData() {
  const button = document.querySelector('#refreshDataButton');
  if (button) {
    button.disabled = true;
    button.classList.add('is-loading');
    button.textContent = '更新中...';
  }

  try {
    window.ACTUAL_SCENARIO = await loadWindowAssignment('actual_data.js', 'ACTUAL_SCENARIO');
    window.PRECOMPUTED_SIMULATION = await loadWindowAssignment('simulation_result.js', 'PRECOMPUTED_SIMULATION');
    scenario = window.ACTUAL_SCENARIO;
    render(currentSimulation());
  } catch (error) {
    console.error(error);
  } finally {
    if (button) {
      button.disabled = false;
      button.classList.remove('is-loading');
      button.textContent = '更新資料';
    }
  }
}

function initDataRefresh() {
  const refreshButton = document.querySelector('#refreshDataButton');
  if (refreshButton) refreshButton.addEventListener('click', refreshData);
  refreshData();
  window.setInterval(refreshData, 5 * 60 * 1000);
}

initRulesModal();
initReturnsModal();
initDataRefresh();
render(currentSimulation());
