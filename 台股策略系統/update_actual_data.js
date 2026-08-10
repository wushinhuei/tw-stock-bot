const fs = require('fs');
const path = require('path');

const START_DATE = '2026-08-10';
const WEB_DIR = path.join(__dirname, 'web');
const OUT_FILE = path.join(WEB_DIR, 'actual_data.js');

const UNIVERSE = [
  { symbol: '2382.TW', code: '2382', name: '廣達', group: 'AI設備', industryOk: true, fundamentalOk: true, chipOk: true },
  { symbol: '2049.TW', code: '2049', name: '上銀', group: '機器人', industryOk: true, fundamentalOk: false, chipOk: false },
  { symbol: '1513.TW', code: '1513', name: '中興電', group: '電力', industryOk: true, fundamentalOk: true, chipOk: false },
  { symbol: '2330.TW', code: '2330', name: '台積電', group: '半導體', industryOk: true, fundamentalOk: true, chipOk: true },
  { symbol: '2454.TW', code: '2454', name: '聯發科', group: '半導體', industryOk: true, fundamentalOk: true, chipOk: false },
  { symbol: '2317.TW', code: '2317', name: '鴻海', group: 'AI設備', industryOk: true, fundamentalOk: true, chipOk: false },
  { symbol: '2308.TW', code: '2308', name: '台達電', group: '電力', industryOk: true, fundamentalOk: true, chipOk: true },
  { symbol: '2357.TW', code: '2357', name: '華碩', group: 'AI設備', industryOk: true, fundamentalOk: true, chipOk: false },
];

async function fetchChart(symbol, range = '1y', interval = '1d') {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=${range}&interval=${interval}`;
  const response = await fetch(url, {
    headers: { 'User-Agent': 'Mozilla/5.0' },
  });
  if (!response.ok) throw new Error(`${symbol} HTTP ${response.status}`);
  const json = await response.json();
  if (!json.chart || json.chart.error) {
    throw new Error(`${symbol} ${JSON.stringify(json.chart && json.chart.error)}`);
  }
  return json.chart.result[0];
}

async function fetchLatestQuote(symbol) {
  const result = await fetchChart(symbol, '1d', '1m');
  const quote = result.indicators.quote[0];
  const timestamps = result.timestamp || [];
  for (let index = timestamps.length - 1; index >= 0; index -= 1) {
    const close = quote.close[index];
    if (close != null) {
      return {
        price: close,
        open: quote.open[index] ?? result.meta.regularMarketOpen ?? close,
        high: quote.high[index] ?? close,
        low: quote.low[index] ?? close,
        volume: quote.volume[index] || 0,
        time: new Date(timestamps[index] * 1000).toISOString(),
      };
    }
  }
  if (result.meta && result.meta.regularMarketPrice != null) {
    return {
      price: result.meta.regularMarketPrice,
      open: result.meta.regularMarketOpen ?? result.meta.chartPreviousClose ?? result.meta.regularMarketPrice,
      high: result.meta.regularMarketDayHigh ?? result.meta.regularMarketPrice,
      low: result.meta.regularMarketDayLow ?? result.meta.regularMarketPrice,
      volume: result.meta.regularMarketVolume || 0,
      time: new Date((result.meta.regularMarketTime || Date.now() / 1000) * 1000).toISOString(),
    };
  }
  return null;
}

function parseTwseNumber(value) {
  const number = Number(String(value || '').replace(/,/g, ''));
  return Number.isFinite(number) ? number : null;
}

function bestTwsePrice(item) {
  const last = parseTwseNumber(item.z);
  if (last != null) return last;
  const previousLast = parseTwseNumber(item.pz);
  if (previousLast != null) return previousLast;
  const bestBid = parseTwseNumber(String(item.b || '').split('_')[0]);
  const bestAsk = parseTwseNumber(String(item.a || '').split('_')[0]);
  if (bestBid != null && bestAsk != null) return (bestBid + bestAsk) / 2;
  return parseTwseNumber(item.y);
}

async function fetchTwseQuotes(items) {
  const channels = items.map(item => `tse_${item.code}.tw`).join('|');
  const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(channels)}&json=1&delay=0`;
  const response = await fetch(url, {
    headers: {
      Referer: 'https://mis.twse.com.tw/stock/index.jsp',
      'User-Agent': 'Mozilla/5.0',
    },
  });
  if (!response.ok) throw new Error(`TWSE MIS HTTP ${response.status}`);
  const json = await response.json();
  const quotes = {};
  (json.msgArray || []).forEach(item => {
    const price = bestTwsePrice(item);
    if (item.c && price != null) {
      quotes[item.c] = {
        price,
        open: parseTwseNumber(item.o) ?? price,
        high: parseTwseNumber(item.h) ?? price,
        low: parseTwseNumber(item.l) ?? price,
        volume: (parseTwseNumber(item.v) || 0) * 1000,
        time: item.tlong ? new Date(Number(item.tlong)).toISOString() : new Date().toISOString(),
        provider: 'TWSE MIS',
      };
    }
  });
  return quotes;
}

function rowsFromChart(result) {
  const quote = result.indicators.quote[0];
  return result.timestamp.map((ts, index) => ({
    date: new Date(ts * 1000).toISOString().slice(0, 10),
    open: quote.open[index],
    high: quote.high[index],
    low: quote.low[index],
    close: quote.close[index],
    volume: quote.volume[index] || 0,
  })).filter(row => row.close != null && row.open != null);
}

function sma(values, period) {
  if (values.length < period) return null;
  return values.slice(-period).reduce((sum, value) => sum + value, 0) / period;
}

function highest(values, period) {
  if (values.length < period) return null;
  return Math.max(...values.slice(-period));
}

function rsi(values, period = 14) {
  if (values.length <= period) return null;
  let gain = 0;
  let loss = 0;
  for (let i = values.length - period; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  if (loss === 0) return 100;
  const rs = (gain / period) / (loss / period);
  return 100 - 100 / (1 + rs);
}

function emaSeries(values, period) {
  const k = 2 / (period + 1);
  const out = [];
  values.forEach((value, index) => {
    if (index === 0) out.push(value);
    else out.push(value * k + out[index - 1] * (1 - k));
  });
  return out;
}

function macd(values) {
  if (values.length < 35) return { dif: null, signal: null, hist: null };
  const fast = emaSeries(values, 12);
  const slow = emaSeries(values, 26);
  const dif = fast.map((value, index) => value - slow[index]);
  const signal = emaSeries(dif, 9);
  return {
    dif: dif.at(-1),
    signal: signal.at(-1),
    hist: dif.at(-1) - signal.at(-1),
  };
}

function mergeLatestRow(rows, latestQuote) {
  if (!latestQuote || latestQuote.price == null) return rows;
  const merged = [...rows];
  const last = { ...merged.at(-1) };
  last.close = latestQuote.price;
  last.open = latestQuote.open ?? last.open;
  last.high = Math.max(last.high || latestQuote.price, latestQuote.high || latestQuote.price, latestQuote.price);
  last.low = Math.min(last.low || latestQuote.price, latestQuote.low || latestQuote.price, latestQuote.price);
  last.volume = Math.max(last.volume || 0, latestQuote.volume || 0);
  merged[merged.length - 1] = last;
  return merged;
}

function gradeCandidate(base, rows, latestQuote) {
  const mergedRows = mergeLatestRow(rows, latestQuote);
  const closes = rows.map(row => row.close);
  const markedCloses = mergedRows.map(row => row.close);
  const volumes = mergedRows.map(row => row.volume);
  const latest = mergedRows.at(-1);
  const prev = mergedRows.at(-2) || latest;
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
    price: Math.round(latest.close * 100) / 100,
    stopPrice,
    targetPrice,
    grade,
    dayTradeOk: grade !== 'BLOCKED' && volumeRatio >= 1.1 && Math.abs(intradayReturnPct) >= 0.002,
    intradayReturnPct: Math.max(-0.03, Math.min(0.03, intradayReturnPct)),
    industryOk: base.industryOk,
    fundamentalOk: base.fundamentalOk,
    chipOk: base.chipOk,
    trendOk,
    volumePriceOk,
    momentumOk,
    metrics: {
      date: latest.date,
      ma20,
      ma50,
      rsi14,
      macdHist: m.hist,
      volumeRatio,
      sourceSymbol: base.symbol,
      latestQuoteTime: latestQuote?.time || null,
      latestQuoteProvider: latestQuote?.provider || null,
      dailyClose: rows.at(-1).close,
      markedClose: markedCloses.at(-1),
    },
  };
}

async function main() {
  const marketResult = await fetchChart('^TWII');
  const marketQuote = await fetchLatestQuote('^TWII').catch(error => {
    console.warn(`Latest market quote fallback ^TWII: ${error.message}`);
    return null;
  });
  const marketRows = mergeLatestRow(rowsFromChart(marketResult), marketQuote);
  const marketCloses = marketRows.map(row => row.close);
  const latestMarket = marketRows.at(-1);
  const market = {
    close: Math.round(latestMarket.close * 100) / 100,
    ma20: Math.round(sma(marketCloses, 20) * 100) / 100,
    ma50: Math.round(sma(marketCloses, 50) * 100) / 100,
  };

  const candidates = [];
  const twseQuotes = await fetchTwseQuotes(UNIVERSE).catch(error => {
    console.warn(`TWSE MIS fallback: ${error.message}`);
    return {};
  });

  for (const stockInfo of UNIVERSE) {
    try {
      const result = await fetchChart(stockInfo.symbol);
      const yahooQuote = await fetchLatestQuote(stockInfo.symbol).catch(error => {
        console.warn(`Latest quote fallback ${stockInfo.symbol}: ${error.message}`);
        return null;
      });
      const latestQuote = twseQuotes[stockInfo.code] || yahooQuote;
      candidates.push(gradeCandidate(stockInfo, rowsFromChart(result), latestQuote));
    } catch (error) {
      console.warn(`Skip ${stockInfo.symbol}: ${error.message}`);
    }
  }

  const groupCounts = {};
  candidates.forEach(candidate => {
    if (!groupCounts[candidate.group]) groupCounts[candidate.group] = 0;
    if (candidate.grade === 'A' || candidate.grade === 'B') groupCounts[candidate.group] += 1;
  });

  const scenario = [{
    date: latestMarket.date >= START_DATE ? latestMarket.date : START_DATE,
    market,
    groups: groupCounts,
    candidates,
    source: {
      provider: 'Yahoo Finance chart API',
      generatedAt: new Date().toISOString(),
      startDate: START_DATE,
    },
  }];

  fs.writeFileSync(
    OUT_FILE,
    `window.ACTUAL_SCENARIO = ${JSON.stringify(scenario, null, 2)};\n`,
    'utf8'
  );

  console.log(`Wrote ${OUT_FILE}`);
  console.log(`Date ${scenario[0].date}, candidates ${candidates.length}`);
}

main().catch(error => {
  console.error(error);
  process.exit(1);
});
