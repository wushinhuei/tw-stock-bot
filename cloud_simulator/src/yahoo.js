'use strict';

function chartUrl(host, symbol, range, interval) {
  return `https://${host}/v8/finance/chart/${encodeURIComponent(symbol)}?range=${encodeURIComponent(range)}&interval=${encodeURIComponent(interval)}&events=div%2Csplits&_=${Date.now()}`;
}

async function fetchChart(symbol, range, interval, fetchImpl = fetch) {
  let lastError;
  for (const host of ['query1.finance.yahoo.com', 'query2.finance.yahoo.com']) {
    const url = chartUrl(host, symbol, range, interval);
    try {
      const response = await fetchImpl(url, {
        cache: 'no-store',
        headers: {
          'User-Agent': 'tw-stock-cloud-simulator/1.0',
          'Cache-Control': 'no-cache, no-store, max-age=0',
          Pragma: 'no-cache'
        },
        signal: AbortSignal.timeout(6000)
      });
      if (!response.ok) throw new Error(`Yahoo HTTP ${response.status}`);
      const json = await response.json();
      if (json.chart?.error || !json.chart?.result?.[0]) throw new Error(JSON.stringify(json.chart?.error || 'missing result'));
      return json.chart.result[0];
    } catch (error) {
      lastError = error;
    }
  }
  throw new Error(`${symbol} Yahoo chart failed: ${lastError}`);
}

function chartBars(result) {
  const quote = result?.indicators?.quote?.[0] || {};
  return (result?.timestamp || []).map((timestamp, index) => ({
    timestamp: new Date(Number(timestamp) * 1000).toISOString(),
    open: Number(quote.open?.[index]),
    high: Number(quote.high?.[index]),
    low: Number(quote.low?.[index]),
    close: Number(quote.close?.[index]),
    volume: Number(quote.volume?.[index] || 0)
  })).filter(row => [row.open, row.high, row.low, row.close].every(Number.isFinite));
}

function aggregateBars(bars, bucketMs) {
  const groups = new Map();
  for (const bar of bars || []) {
    const time = new Date(bar.timestamp).getTime();
    if (!Number.isFinite(time)) continue;
    const bucket = Math.floor(time / bucketMs) * bucketMs;
    const current = groups.get(bucket);
    if (!current) {
      groups.set(bucket, { ...bar, timestamp: new Date(bucket).toISOString() });
    } else {
      current.high = Math.max(current.high, bar.high);
      current.low = Math.min(current.low, bar.low);
      current.close = bar.close;
      current.volume += Number(bar.volume || 0);
    }
  }
  return [...groups.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

function weeklyBars(dailyBars) {
  const groups = new Map();
  for (const bar of dailyBars || []) {
    const date = new Date(bar.timestamp);
    const day = date.getUTCDay() || 7;
    const monday = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - day + 1));
    const key = monday.toISOString().slice(0, 10);
    const current = groups.get(key);
    if (!current) groups.set(key, { ...bar, timestamp: `${key}T00:00:00.000Z` });
    else {
      current.high = Math.max(current.high, bar.high);
      current.low = Math.min(current.low, bar.low);
      current.close = bar.close;
      current.volume += Number(bar.volume || 0);
    }
  }
  return [...groups.values()].sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}

async function fetchTechnicalBars(symbol, fetchImpl = fetch) {
  const yahooSymbol = String(symbol).includes('.') ? String(symbol) : `${symbol}.TW`;
  const [intraday, daily] = await Promise.all([
    fetchChart(yahooSymbol, '5d', '5m', fetchImpl),
    fetchChart(yahooSymbol, '1y', '1d', fetchImpl)
  ]);
  const bars5m = chartBars(intraday);
  const dailyBars = chartBars(daily);
  return {
    bars5m,
    bars15m: aggregateBars(bars5m, 15 * 60 * 1000),
    dailyBars,
    weeklyBars: weeklyBars(dailyBars),
    provider: 'Yahoo Finance Chart API',
    fetchedAt: new Date().toISOString()
  };
}

async function fetchIntradayBars(symbol, fetchImpl = fetch) {
  const yahooSymbol = String(symbol).includes('.') ? String(symbol) : `${symbol}.TW`;
  const intraday = await fetchChart(yahooSymbol, '5d', '5m', fetchImpl);
  const bars5m = chartBars(intraday);
  return {
    bars5m,
    bars15m: aggregateBars(bars5m, 15 * 60 * 1000),
    provider: 'Yahoo Finance Chart API',
    fetchedAt: new Date().toISOString()
  };
}

module.exports = { aggregateBars, chartBars, fetchChart, fetchIntradayBars, fetchTechnicalBars, weeklyBars };
