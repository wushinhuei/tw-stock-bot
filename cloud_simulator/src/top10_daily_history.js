'use strict';

const { stockDaily } = require('./twse_mcp_history');

const MANIFEST_OBJECT = 'cache/top10_daily/manifest.json';

function addDays(ymd, days) {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function fourQuarterStart(ymd) {
  const date = new Date(`${ymd}T00:00:00Z`);
  date.setUTCFullYear(date.getUTCFullYear() - 1);
  return addDays(date.toISOString().slice(0, 10), 1);
}

function mergeDailyRows(existing, incoming, start, end) {
  const byDate = new Map();
  for (const row of [...(existing || []), ...(incoming || [])]) {
    if (row?.tradeDate >= start && row?.tradeDate <= end) byDate.set(row.tradeDate, row);
  }
  return [...byDate.values()].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
}

class GcsTop10DailyStore {
  constructor(bucketName) {
    if (!bucketName) throw new Error('GCS_BUCKET is required for Top10 daily history');
    const { Storage } = require('@google-cloud/storage');
    this.bucket = new Storage().bucket(bucketName);
  }

  async read(name) {
    try {
      const [contents] = await this.bucket.file(name).download();
      return JSON.parse(contents.toString('utf8'));
    } catch (error) {
      if (Number(error?.code) === 404) return null;
      throw error;
    }
  }

  async write(name, payload) {
    await this.bucket.file(name).save(JSON.stringify(payload), {
      contentType: 'application/json', cacheControl: 'no-store', gzip: true
    });
  }

  readManifest() { return this.read(MANIFEST_OBJECT); }
  writeManifest(payload) { return this.write(MANIFEST_OBJECT, payload); }
  readSymbol(symbol) { return this.read(`cache/top10_daily/${symbol}.json`); }
  writeSymbol(symbol, payload) { return this.write(`cache/top10_daily/${symbol}.json`, payload); }
}

async function syncTop10DailyHistory(options = {}) {
  const candidates = (options.candidates || []).slice(0, 10);
  const tradeDate = String(options.tradeDate || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(tradeDate)) throw new Error(`invalid Top10 trade date: ${tradeDate}`);
  const store = options.store;
  if (!store) throw new Error('Top10 daily history store is required');
  const fetchDaily = options.fetchDaily || stockDaily;
  const now = options.now || new Date();
  const windowStart = fourQuarterStart(tradeDate);
  const previousManifest = await store.readManifest().catch(() => null);
  const previousBySymbol = new Map((previousManifest?.symbols || []).map(row => [row.symbol, row]));
  const activeSymbols = new Set(candidates.map(row => String(row.symbol)));
  const results = [];

  for (const candidate of candidates) {
    const symbol = String(candidate.symbol);
    try {
      const cached = await store.readSymbol(symbol).catch(() => null);
      const existingRows = cached?.rows || [];
      const cachedCoversStart = cached?.windowStart && cached.windowStart <= windowStart;
      const latestCached = existingRows.length ? existingRows[existingRows.length - 1].tradeDate : null;
      const fetchStart = cachedCoversStart && latestCached ? addDays(latestCached, 1) : windowStart;
      const incoming = fetchStart <= tradeDate
        ? (await fetchDaily(symbol, fetchStart, tradeDate, options.fetchOptions || {})).rows
        : [];
      const rows = mergeDailyRows(existingRows, incoming, windowStart, tradeDate);
      const payload = {
        symbol,
        name: candidate.name || cached?.name || symbol,
        windowStart,
        requestedThrough: tradeDate,
        latestTradeDate: rows.at(-1)?.tradeDate || null,
        rowCount: rows.length,
        source: 'TWSE_STOCK_DAY',
        updatedAt: now.toISOString(),
        rows
      };
      await store.writeSymbol(symbol, payload);
      results.push({ symbol, name: payload.name, active: true, status: 'COMPLETE', rowCount: rows.length, latestTradeDate: payload.latestTradeDate, fetchedRows: incoming.length });
    } catch (error) {
      results.push({ symbol, name: candidate.name || symbol, active: true, status: 'ERROR', error: String(error.message || error) });
    }
  }

  for (const [symbol, old] of previousBySymbol) {
    if (!activeSymbols.has(symbol)) results.push({ ...old, active: false, status: 'PAUSED', pausedAt: now.toISOString() });
  }

  const active = results.filter(row => row.active);
  const complete = active.length === candidates.length && active.every(row => row.status === 'COMPLETE' && row.latestTradeDate === tradeDate);
  const manifest = {
    policy: 'DAILY_TOP10_ROLLING_FOUR_QUARTERS',
    generatedAt: now.toISOString(),
    tradeDate,
    windowStart,
    activeSymbols: [...activeSymbols],
    activeCount: active.length,
    complete,
    symbols: results
  };
  await store.writeManifest(manifest);
  return manifest;
}

function top10DailyStoreFromEnvironment() {
  return process.env.GCS_BUCKET ? new GcsTop10DailyStore(process.env.GCS_BUCKET) : null;
}

module.exports = {
  GcsTop10DailyStore,
  MANIFEST_OBJECT,
  fourQuarterStart,
  mergeDailyRows,
  syncTop10DailyHistory,
  top10DailyStoreFromEnvironment
};
