const START_DATE = '2026-08-10';
const STATE_KEY = 'TW_STOCK_DASHBOARD_STATE_V1';
const RAW_BASE = 'https://raw.githubusercontent.com/wushinhuei/tw-stock-bot/main/%E5%8F%B0%E8%82%A1%E7%AD%96%E7%95%A5%E7%B3%BB%E7%B5%B1/web/';

const CONFIG = {
  initialCapital: 100000,
  simulationStartDate: START_DATE,
  boardLot: 1,
  standardPositionPct: 0.2,
  halfPositionPct: 0.1,
  dailyStopLossPct: -0.02,
  weeklyStopLossPct: -0.05,
  dayTradeCapitalPct: 0.08,
  brokerFeeRate: 0.001425,
  minBrokerFee: 1,
  stockSellTaxRate: 0.003,
  dayTradeSellTaxRate: 0.0015
};

const UNIVERSE = [
  { symbol: '2382.TW', code: '2382', name: '\u5ee3\u9054', group: 'AI\u8a2d\u5099', industryOk: true, fundamentalOk: true, chipOk: true },
  { symbol: '2049.TW', code: '2049', name: '\u4e0a\u9280', group: '\u6a5f\u5668\u4eba', industryOk: true, fundamentalOk: false, chipOk: false },
  { symbol: '1513.TW', code: '1513', name: '\u4e2d\u8208\u96fb', group: '\u96fb\u529b', industryOk: true, fundamentalOk: true, chipOk: false },
  { symbol: '2330.TW', code: '2330', name: '\u53f0\u7a4d\u96fb', group: '\u534a\u5c0e\u9ad4', industryOk: true, fundamentalOk: true, chipOk: true },
  { symbol: '2454.TW', code: '2454', name: '\u806f\u767c\u79d1', group: '\u534a\u5c0e\u9ad4', industryOk: true, fundamentalOk: true, chipOk: false },
  { symbol: '2317.TW', code: '2317', name: '\u9d3b\u6d77', group: 'AI\u8a2d\u5099', industryOk: true, fundamentalOk: true, chipOk: false },
  { symbol: '2308.TW', code: '2308', name: '\u53f0\u9054\u96fb', group: '\u96fb\u529b', industryOk: true, fundamentalOk: true, chipOk: true },
  { symbol: '2357.TW', code: '2357', name: '\u83ef\u78a9', group: 'AI\u8a2d\u5099', industryOk: true, fundamentalOk: true, chipOk: false }
];

function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  const action = params.action || 'read';
  const callback = params.callback || '';
  let payload;

  try {
    payload = action === 'refresh' ? refreshDashboard() : readOrSeedPayload();
  } catch (error) {
    payload = {
      ok: false,
      error: String(error && error.stack ? error.stack : error),
      generatedAt: new Date().toISOString()
    };
  }

  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + JSON.stringify(payload) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function scheduledUpdate() {
  refreshDashboard();
}

function installMinuteTrigger() {
  deleteSimulationTriggers();
  ScriptApp.newTrigger('scheduledUpdate').timeBased().everyMinutes(1).create();
}

function deleteSimulationTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'scheduledUpdate') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function clearSimulationState() {
  PropertiesService.getScriptProperties().deleteProperty(STATE_KEY);
}

function refreshDashboard() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return readOrSeedPayload();

  try {
    const previous = readOrSeedPayload();
    const scenario = buildScenario();
    const latestDay = last(scenario);
    const previousSimulation = previous && previous.simulation ? previous.simulation : null;
    const simulation = nextSimulation(previousSimulation, latestDay);
    const payload = {
      ok: true,
      source: 'apps-script',
      generatedAt: new Date().toISOString(),
      scenario: scenario,
      simulation: simulation
    };
    PropertiesService.getScriptProperties().setProperty(STATE_KEY, JSON.stringify(payload));
    return payload;
  } finally {
    lock.releaseLock();
  }
}

function readOrSeedPayload() {
  const saved = PropertiesService.getScriptProperties().getProperty(STATE_KEY);
  if (saved) return JSON.parse(saved);

  const seed = readSeedFromGitHub();
  PropertiesService.getScriptProperties().setProperty(STATE_KEY, JSON.stringify(seed));
  return seed;
}

function readSeedFromGitHub() {
  const scenarioText = fetchText(RAW_BASE + 'actual_data.js?v=' + Date.now());
  const simulationText = fetchText(RAW_BASE + 'simulation_result.js?v=' + Date.now());
  const scenario = parseWindowAssignment(scenarioText, 'ACTUAL_SCENARIO');
  const simulation = parseWindowAssignment(simulationText, 'PRECOMPUTED_SIMULATION');
  return {
    ok: true,
    source: 'github-seed',
    generatedAt: new Date().toISOString(),
    scenario: scenario,
    simulation: simulation
  };
}

function parseWindowAssignment(text, key) {
  const re = new RegExp('window\\.' + key + '\\s*=\\s*([\\s\\S]*?);\\s*$');
  const match = String(text || '').match(re);
  if (!match) throw new Error('Cannot parse ' + key);
  return JSON.parse(match[1]);
}

function buildScenario() {
  const marketResult = fetchChart('^TWII', '1y', '1d');
  const marketQuote = safeFetchLatestQuote('^TWII');
  const marketRows = mergeLatestRow(rowsFromChart(marketResult), marketQuote);
  const marketCloses = marketRows.map(function(row) { return row.close; });
  const latestMarket = last(marketRows);
  const market = {
    close: round2(latestMarket.close),
    ma20: round2(sma(marketCloses, 20)),
    ma50: round2(sma(marketCloses, 50))
  };

  const candidates = [];
  const twseQuotes = safeFetchTwseQuotes(UNIVERSE);
  UNIVERSE.forEach(function(stockInfo) {
    try {
      const result = fetchChart(stockInfo.symbol, '1y', '1d');
      const yahooQuote = safeFetchLatestQuote(stockInfo.symbol);
      const latestQuote = twseQuotes[stockInfo.code] || yahooQuote;
      candidates.push(gradeCandidate(stockInfo, rowsFromChart(result), latestQuote));
    } catch (error) {
      console.warn('Skip ' + stockInfo.symbol + ': ' + error.message);
    }
  });

  const groupCounts = {};
  candidates.forEach(function(candidate) {
    if (!groupCounts[candidate.group]) groupCounts[candidate.group] = 0;
    if (candidate.grade === 'A' || candidate.grade === 'B') groupCounts[candidate.group] += 1;
  });

  return [{
    date: latestMarket.date >= START_DATE ? latestMarket.date : START_DATE,
    market: market,
    groups: groupCounts,
    candidates: candidates,
    source: {
      provider: 'Apps Script + TWSE MIS + Yahoo Finance chart API',
      generatedAt: new Date().toISOString(),
      startDate: START_DATE
    }
  }];
}

function fetchChart(symbol, range, interval) {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' +
    encodeURIComponent(symbol) + '?range=' + encodeURIComponent(range || '1y') +
    '&interval=' + encodeURIComponent(interval || '1d');
  const json = fetchJson(url, { 'User-Agent': 'Mozilla/5.0' });
  if (!json.chart || json.chart.error) {
    throw new Error(symbol + ' ' + JSON.stringify(json.chart && json.chart.error));
  }
  return json.chart.result[0];
}

function safeFetchLatestQuote(symbol) {
  try {
    return fetchLatestQuote(symbol);
  } catch (error) {
    console.warn('Latest quote fallback ' + symbol + ': ' + error.message);
    return null;
  }
}

function fetchLatestQuote(symbol) {
  const result = fetchChart(symbol, '1d', '1m');
  const quote = result.indicators.quote[0];
  const timestamps = result.timestamp || [];
  for (let index = timestamps.length - 1; index >= 0; index -= 1) {
    const close = quote.close[index];
    if (close != null) {
      return {
        price: close,
        open: quote.open[index] != null ? quote.open[index] : result.meta.regularMarketOpen || close,
        high: quote.high[index] != null ? quote.high[index] : close,
        low: quote.low[index] != null ? quote.low[index] : close,
        volume: quote.volume[index] || 0,
        time: new Date(timestamps[index] * 1000).toISOString(),
        provider: 'Yahoo Finance chart API'
      };
    }
  }
  return null;
}

function safeFetchTwseQuotes(items) {
  try {
    return fetchTwseQuotes(items);
  } catch (error) {
    console.warn('TWSE MIS fallback: ' + error.message);
    return {};
  }
}

function fetchTwseQuotes(items) {
  const channels = items.map(function(item) { return 'tse_' + item.code + '.tw'; }).join('|');
  const url = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=' +
    encodeURIComponent(channels) + '&json=1&delay=0';
  const json = fetchJson(url, {
    Referer: 'https://mis.twse.com.tw/stock/index.jsp',
    'User-Agent': 'Mozilla/5.0'
  });
  const quotes = {};
  (json.msgArray || []).forEach(function(item) {
    const price = bestTwsePrice(item);
    if (item.c && price != null) {
      quotes[item.c] = {
        price: price,
        open: coalesce(parseTwseNumber(item.o), price),
        high: coalesce(parseTwseNumber(item.h), price),
        low: coalesce(parseTwseNumber(item.l), price),
        volume: (parseTwseNumber(item.v) || 0) * 1000,
        time: item.tlong ? new Date(Number(item.tlong)).toISOString() : new Date().toISOString(),
        provider: 'TWSE MIS'
      };
    }
  });
  return quotes;
}

function fetchJson(url, headers) {
  return JSON.parse(fetchText(url, headers));
}

function fetchText(url, headers) {
  const response = UrlFetchApp.fetch(url, {
    headers: headers || {},
    followRedirects: true,
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) throw new Error(url + ' HTTP ' + code);
  return response.getContentText();
}

function parseTwseNumber(value) {
  const number = Number(String(value || '').replace(/,/g, ''));
  return Number.isFinite(number) ? number : null;
}

function bestTwsePrice(item) {
  const lastPrice = parseTwseNumber(item.z);
  if (lastPrice != null) return lastPrice;
  const previousLast = parseTwseNumber(item.pz);
  if (previousLast != null) return previousLast;
  const bestBid = parseTwseNumber(String(item.b || '').split('_')[0]);
  const bestAsk = parseTwseNumber(String(item.a || '').split('_')[0]);
  if (bestBid != null && bestAsk != null) return (bestBid + bestAsk) / 2;
  return parseTwseNumber(item.y);
}

function rowsFromChart(result) {
  const quote = result.indicators.quote[0];
  return (result.timestamp || []).map(function(ts, index) {
    return {
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      open: quote.open[index],
      high: quote.high[index],
      low: quote.low[index],
      close: quote.close[index],
      volume: quote.volume[index] || 0
    };
  }).filter(function(row) {
    return row.close != null && row.open != null;
  });
}

function mergeLatestRow(rows, latestQuote) {
  if (!latestQuote || latestQuote.price == null || !rows.length) return rows;
  const merged = rows.slice();
  const lastRow = Object.assign({}, last(merged));
  lastRow.close = latestQuote.price;
  lastRow.open = latestQuote.open != null ? latestQuote.open : lastRow.open;
  lastRow.high = Math.max(lastRow.high || latestQuote.price, latestQuote.high || latestQuote.price, latestQuote.price);
  lastRow.low = Math.min(lastRow.low || latestQuote.price, latestQuote.low || latestQuote.price, latestQuote.price);
  lastRow.volume = Math.max(lastRow.volume || 0, latestQuote.volume || 0);
  merged[merged.length - 1] = lastRow;
  return merged;
}

function gradeCandidate(base, rows, latestQuote) {
  const mergedRows = mergeLatestRow(rows, latestQuote);
  const closes = rows.map(function(row) { return row.close; });
  const markedCloses = mergedRows.map(function(row) { return row.close; });
  const volumes = mergedRows.map(function(row) { return row.volume; });
  const latest = last(mergedRows);
  const prev = mergedRows.length > 1 ? mergedRows[mergedRows.length - 2] : latest;
  const ma20 = sma(closes, 20);
  const ma50 = sma(closes, 50);
  const volume20 = sma(volumes, 20) || latest.volume;
  const high20 = highest(closes.slice(0, -1), 20) || prev.close;
  const rsi14 = rsi(closes, 14);
  const m = macd(closes);
  const trendOk = ma20 != null && ma50 != null && latest.close > ma20 && latest.close > ma50;
  const volumeRatio = volume20 ? latest.volume / volume20 : 1;
  const volumePriceOk = latest.close >= high20 * 0.985 || volumeRatio >= 1.2;
  const momentumOk = (rsi14 == null || rsi14 >= 50) && (m.hist == null || m.hist >= 0);
  const all = base.industryOk && base.fundamentalOk && base.chipOk && trendOk && volumePriceOk && momentumOk;
  const backed = base.industryOk || base.fundamentalOk || base.chipOk;
  const grade = all ? 'A' : trendOk && volumePriceOk && momentumOk && backed ? 'B' : trendOk || volumePriceOk || momentumOk ? 'C' : 'BLOCKED';
  const stopPrice = Math.round(Math.min(latest.close * 0.94, ma20 || latest.close * 0.94) * 10) / 10;
  const targetPrice = Math.round(latest.close * 1.08 * 10) / 10;
  const intradayReturnPct = latest.open ? latest.close / latest.open - 1 : 0;

  return {
    symbol: base.code,
    name: base.name,
    group: base.group,
    price: round2(latest.close),
    stopPrice: stopPrice,
    targetPrice: targetPrice,
    grade: grade,
    dayTradeOk: grade !== 'BLOCKED' && volumeRatio >= 1.1 && Math.abs(intradayReturnPct) >= 0.002,
    intradayReturnPct: Math.max(-0.03, Math.min(0.03, intradayReturnPct)),
    industryOk: base.industryOk,
    fundamentalOk: base.fundamentalOk,
    chipOk: base.chipOk,
    trendOk: trendOk,
    volumePriceOk: volumePriceOk,
    momentumOk: momentumOk,
    metrics: {
      date: latest.date,
      ma20: ma20,
      ma50: ma50,
      rsi14: rsi14,
      macdHist: m.hist,
      volumeRatio: volumeRatio,
      sourceSymbol: base.symbol,
      latestQuoteTime: latestQuote && latestQuote.time ? latestQuote.time : null,
      latestQuoteProvider: latestQuote && latestQuote.provider ? latestQuote.provider : null,
      dailyClose: last(rows).close,
      markedClose: last(markedCloses)
    }
  };
}

function nextSimulation(previous, day) {
  if (!previous || !Array.isArray(previous.daily) || !previous.daily.length) {
    return runFreshSimulation([day]);
  }
  const previousLatestDay = last(previous.daily);
  if (previousLatestDay && previousLatestDay.date === day.date) {
    return markToMarket(previous, day);
  }
  return advanceOneDay(previous, day);
}

function runFreshSimulation(days) {
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
    maxDrawdown: 0
  };
  days.filter(function(day) { return day.date >= CONFIG.simulationStartDate; })
    .forEach(function(day) { simulateDay(account, day); });
  return finalizeAccount(account, last(days));
}

function advanceOneDay(previous, day) {
  const account = cloneAccount(previous);
  simulateDay(account, day);
  return finalizeAccount(account, day);
}

function simulateDay(account, day) {
  const marketState = evaluateMarket(day);
  account.dailyStopped = false;
  sellByRules(account, day, marketState);
  buyByRules(account, day, marketState);
  runDayTrades(account, day, marketState);

  const previousEquity = account.daily.length ? last(account.daily).equity : account.initialCapital;
  const positionValue = marketValue(account.positions, day);
  const equity = account.cash + positionValue;
  const dayPnl = equity - previousEquity;
  const dayReturn = previousEquity ? dayPnl / previousEquity : 0;
  if (dayReturn <= CONFIG.dailyStopLossPct) account.dailyStopped = true;

  const peak = Math.max(account.initialCapital, maxDailyEquity(account.daily), equity);
  account.maxDrawdown = Math.min(account.maxDrawdown || 0, equity / peak - 1);
  account.weeklyLimited = equity / account.initialCapital - 1 <= CONFIG.weeklyStopLossPct;
  account.daily.push({
    date: day.date,
    equity: equity,
    cash: account.cash,
    positionValue: positionValue,
    dayPnl: dayPnl,
    marketLabel: marketState.label
  });
}

function markToMarket(previous, day) {
  const account = cloneAccount(previous);
  const positionValue = marketValue(account.positions, day);
  const equity = account.cash + positionValue;
  const previousDaily = account.daily.length > 1 ? account.daily[account.daily.length - 2] : null;
  const previousEquity = previousDaily ? previousDaily.equity : account.initialCapital;
  const lastDaily = last(account.daily);

  if (lastDaily) {
    account.daily[account.daily.length - 1] = Object.assign({}, lastDaily, {
      date: day.date,
      equity: equity,
      cash: account.cash,
      positionValue: positionValue,
      dayPnl: equity - previousEquity,
      marketLabel: evaluateMarket(day).label
    });
  }

  return finalizeAccount(account, day);
}

function finalizeAccount(account, day) {
  const finalEquity = account.daily.length ? last(account.daily).equity : account.initialCapital;
  return Object.assign(account, {
    finalEquity: finalEquity,
    totalReturn: finalEquity / account.initialCapital - 1,
    maxDrawdown: account.maxDrawdown || 0,
    generatedAt: new Date().toISOString(),
    source: day && day.source ? day.source : null
  });
}

function cloneAccount(previous) {
  return {
    initialCapital: previous.initialCapital || CONFIG.initialCapital,
    cash: Number(previous.cash || 0),
    positions: JSON.parse(JSON.stringify(previous.positions || [])),
    realizedPnl: Number(previous.realizedPnl || 0),
    totalFees: Number(previous.totalFees || 0),
    totalTaxes: Number(previous.totalTaxes || 0),
    trades: JSON.parse(JSON.stringify(previous.trades || [])),
    daily: JSON.parse(JSON.stringify(previous.daily || [])),
    dailyStopped: Boolean(previous.dailyStopped),
    weeklyLimited: Boolean(previous.weeklyLimited),
    maxDrawdown: Number(previous.maxDrawdown || 0)
  };
}

function evaluateMarket(day) {
  const close = day.market.close;
  const ma20 = day.market.ma20;
  const ma50 = day.market.ma50;
  if (close > ma20 && close > ma50) return { mode: 'AGGRESSIVE', label: '\u7a4d\u6975\u505a\u591a', maxGrade: 'A' };
  if (close <= ma50) return { mode: 'DEFENSIVE', label: '\u9632\u5b88\u89c0\u671b', maxGrade: 'C' };
  return { mode: 'LIGHT', label: '\u8f15\u5009\u8a66\u55ae', maxGrade: 'B' };
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

function sellByRules(account, day, marketState) {
  const stillHolding = [];
  account.positions.forEach(function(position) {
    const candidate = findCandidate(day, position.symbol);
    if (!candidate) {
      stillHolding.push(position);
      return;
    }
    const grossAmount = position.shares * candidate.price;
    const shouldSell = candidate.price <= position.stopPrice ||
      candidate.price >= position.targetPrice ||
      candidate.grade === 'BLOCKED' ||
      marketState.mode === 'DEFENSIVE';

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
      action: 'SELL',
      symbol: position.symbol,
      name: position.name,
      shares: position.shares,
      price: candidate.price,
      grossAmount: grossAmount,
      fee: fee,
      tax: tax,
      pnl: pnl,
      reason: sellReason(candidate, marketState, position)
    });
  });
  account.positions = stillHolding;
}

function buyByRules(account, day, marketState) {
  day.candidates.filter(function(candidate) {
    return canOpenPosition(candidate, marketState, account);
  }).forEach(function(candidate) {
    if (account.positions.some(function(position) { return position.symbol === candidate.symbol; })) return;
    const budget = account.initialCapital * positionPct(candidate, account);
    const unitCost = candidate.price * CONFIG.boardLot;
    const units = Math.floor(Math.min(budget, account.cash) / unitCost);
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
      shares: shares,
      avgCost: candidate.price,
      totalCost: totalCost,
      stopPrice: candidate.stopPrice,
      targetPrice: candidate.targetPrice
    });
    account.trades.push({
      date: day.date,
      action: 'BUY',
      symbol: candidate.symbol,
      name: candidate.name,
      shares: shares,
      price: candidate.price,
      grossAmount: grossAmount,
      fee: fee,
      tax: 0,
      pnl: 0,
      reason: candidate.grade + ' rule entry; fee ' + fee
    });
  });
}

function runDayTrades(account, day, marketState) {
  if (marketState.mode === 'DEFENSIVE' || account.dailyStopped) return;
  day.candidates.filter(function(candidate) {
    return candidate.dayTradeOk && candidate.grade !== 'BLOCKED';
  }).forEach(function(candidate) {
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
      action: 'DAYTRADE',
      symbol: candidate.symbol,
      name: candidate.name,
      shares: shares,
      price: candidate.price,
      grossAmount: buyAmount + sellAmount,
      fee: buyFee + sellFee,
      tax: tax,
      pnl: pnl,
      reason: 'Intraday rule simulation'
    });
  });
}

function sellReason(candidate, marketState, position) {
  if (candidate.price <= position.stopPrice) return 'Stop loss';
  if (candidate.price >= position.targetPrice) return 'Target reached';
  if (candidate.grade === 'BLOCKED') return 'Signal blocked';
  if (marketState.mode === 'DEFENSIVE') return 'Market defensive';
  return 'Rule exit';
}

function marketValue(positions, day) {
  return positions.reduce(function(sum, position) {
    const candidate = findCandidate(day, position.symbol);
    const grossValue = position.shares * (candidate ? candidate.price : position.avgCost);
    return sum + netSellProceeds(grossValue, false);
  }, 0);
}

function findCandidate(day, symbol) {
  return day.candidates.find(function(candidate) { return candidate.symbol === symbol; });
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

function sma(values, period) {
  if (values.length < period) return null;
  return values.slice(values.length - period).reduce(function(sum, value) { return sum + value; }, 0) / period;
}

function highest(values, period) {
  if (values.length < period) return null;
  return Math.max.apply(null, values.slice(values.length - period));
}

function rsi(values, period) {
  period = period || 14;
  if (values.length <= period) return null;
  let gain = 0;
  let loss = 0;
  for (let i = values.length - period; i < values.length; i += 1) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  if (loss === 0) return 100;
  const rs = gain / period / (loss / period);
  return 100 - 100 / (1 + rs);
}

function emaSeries(values, period) {
  const k = 2 / (period + 1);
  const out = [];
  values.forEach(function(value, index) {
    if (index === 0) out.push(value);
    else out.push(value * k + out[index - 1] * (1 - k));
  });
  return out;
}

function macd(values) {
  if (values.length < 35) return { dif: null, signal: null, hist: null };
  const fast = emaSeries(values, 12);
  const slow = emaSeries(values, 26);
  const dif = fast.map(function(value, index) { return value - slow[index]; });
  const signal = emaSeries(dif, 9);
  return {
    dif: last(dif),
    signal: last(signal),
    hist: last(dif) - last(signal)
  };
}

function maxDailyEquity(daily) {
  if (!daily.length) return CONFIG.initialCapital;
  return Math.max.apply(null, daily.map(function(day) { return day.equity; }));
}

function coalesce(value, fallback) {
  return value != null ? value : fallback;
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function last(values) {
  return values[values.length - 1];
}
