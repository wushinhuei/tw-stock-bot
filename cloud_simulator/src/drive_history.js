'use strict';

const { GoogleAuth } = require('google-auth-library');

const DRIVE_DATASETS = Object.freeze({
  top50: Object.freeze({
    folderId: '1MxFVvokT86PlmmZ8ugHaID5iAsc90Qse',
    manifestId: '1_dUjbK480Mng6ABditIRUAtou1S9XP6m',
    files: Object.freeze({
      2016: '1bl7cBlDSSllKdEJ67FuVIm44ru8gjFPs', 2017: '1p_pwonjtsJue80gppyPiE1SRGoyyZKOB',
      2018: '1Y541BV-vxxRH4zQpxI1diIR7kBs49Lqo', 2019: '1ZC9mvMAqw0kdRsCut0Y2KAEWwUqjGIjz',
      2020: '1tq471AY__1KXNuyk7y6Tr_QSHipvmBxv', 2021: '10AhIETwJShykI1ig-SYmty1XrsdQS-Og',
      2022: '1b9NE9KzPzNpit2KA_tIqKSjSX9li8Fth', 2023: '1xKI701Ny0WGy0qtgLI6IKOsqPZE_kGOT',
      2024: '1j4dG292f6oNcqrPlBqoMRnCjf9tHtE2x', 2025: '1L4ASbagbOapcLt_yyh7wf_iMW0AMqho4',
      2026: '1AP9mSs4VMzdlYnU-n0SAg-xn5XBlLC-q'
    })
  }),
  stockDaily: Object.freeze({
    folderId: '1K0pAhcPJLxTZ7dIjlTrMFcqUr30gBl35',
    manifestId: '1_0NnEjwCRkoguD9OowRnp7mQ8rovneKx',
    files: Object.freeze({
      2016: '13oA4ov51G-aUTjaSxRG6ndcQRJI12B71', 2017: '1BTeuSvJYD6kPHdC5wbmCvIJY-Rt5LTv6',
      2018: '1ydnmwUf7cactodtE81f6GhgjHBzUS-9O', 2019: '1moLeqmld-g9eyRdSFO4Unj5uF45OXHjt',
      2020: '1p94OzKd1NtdpLiOZCAqxzxKfvLM9WWwp', 2021: '1XoZYfYeOgMFdbIoVzQY5EeP_OWfGcBsR',
      2022: '1Y4nVvckaYaxjYFhi9Wicr8wsS8P65dg3', 2023: '1xXUjyEoAMbbizw4i3dPLlpAcbnnFJmOM',
      2024: '1PdCUwvACacIVDbfW4wCOE2UcxlKYJdbR', 2025: '1E21X2YXXODUgKIfHurwuhDuYSyFBJaNw',
      2026: '1y8r2JcpiPjiCHAmrfsvH5ZcZmoDeVDZe'
    })
  })
});

function csvFields(line) {
  const fields = [];
  let value = '';
  let quoted = false;
  for (let index = 0; index < line.length; index += 1) {
    const character = line[index];
    if (character === '"') {
      if (quoted && line[index + 1] === '"') { value += '"'; index += 1; }
      else quoted = !quoted;
    } else if (character === ',' && !quoted) {
      fields.push(value);
      value = '';
    } else value += character;
  }
  fields.push(value);
  return fields;
}

function parseCsv(text) {
  const lines = String(text || '').replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  if (!lines[0]) return [];
  const header = csvFields(lines.shift());
  return lines.filter(Boolean).map(line => {
    const values = csvFields(line);
    return Object.fromEntries(header.map((name, index) => [name, values[index] ?? '']));
  });
}

function yearsBetween(start, end) {
  const first = Number(String(start).slice(0, 4));
  const last = Number(String(end).slice(0, 4));
  if (!Number.isInteger(first) || !Number.isInteger(last) || first > last) throw new Error('invalid history date range');
  return Array.from({ length: last - first + 1 }, (_, index) => first + index);
}

function validBar(row) {
  return ['open', 'high', 'low', 'close'].every(key => Number.isFinite(Number(row[key])) && Number(row[key]) > 0);
}

function createDriveTextFetcher(options = {}) {
  const auth = options.auth || new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
  const fetchImpl = options.fetchImpl || fetch;
  return async fileId => {
    const client = await auth.getClient();
    const headers = await client.getRequestHeaders();
    const response = await fetchImpl(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(fileId)}?alt=media`, {
      headers: { ...headers, accept: 'text/plain,text/csv,application/json' },
      signal: AbortSignal.timeout(120000)
    });
    if (!response.ok) throw new Error(`Google Drive file ${fileId} HTTP ${response.status}`);
    return response.text();
  };
}

class DriveHistorySource {
  constructor(options = {}) {
    this.datasets = options.datasets || DRIVE_DATASETS;
    this.fetchText = options.fetchText || createDriveTextFetcher(options);
    this.cache = new Map();
  }

  dataset(name) {
    const dataset = this.datasets[name];
    if (!dataset) throw new Error(`unknown Drive history dataset: ${name}`);
    return dataset;
  }

  async manifest(name) {
    const key = `${name}:manifest`;
    if (!this.cache.has(key)) {
      const payload = JSON.parse(await this.fetchText(this.dataset(name).manifestId));
      if (payload.last_update?.error || !/complete$/i.test(String(payload.last_update?.status || ''))) throw new Error(`${name} Drive manifest is not complete`);
      this.cache.set(key, payload);
    }
    return this.cache.get(key);
  }

  async rows(name, year) {
    const key = `${name}:${year}`;
    if (!this.cache.has(key)) {
      const fileId = this.dataset(name).files[year];
      if (!fileId) throw new Error(`${name} has no configured file for ${year}`);
      this.cache.set(key, parseCsv(await this.fetchText(fileId)));
    }
    return this.cache.get(key);
  }

  clearRows(name, year) {
    this.cache.delete(`${name}:${year}`);
  }

  async top50Rows(start, end) {
    await this.manifest('top50');
    const result = [];
    for (const year of yearsBetween(start, end)) {
      for (const row of await this.rows('top50', year)) if (row.trade_date >= start && row.trade_date <= end) result.push(row);
    }
    return result.sort((a, b) => a.trade_date.localeCompare(b.trade_date) || Number(a.rank) - Number(b.rank));
  }

  async dailyBars(symbol, start, end) {
    await this.manifest('stockDaily');
    const result = [];
    for (const year of yearsBetween(start, end)) {
      for (const row of await this.rows('stockDaily', year)) {
        if (row.stock_code !== String(symbol) || row.trade_date < start || row.trade_date > end || !validBar(row)) continue;
        result.push({
          timestamp: `${row.trade_date}T00:00:00.000Z`, tradeDate: row.trade_date, symbol: row.stock_code, name: row.stock_name,
          open: Number(row.open), high: Number(row.high), low: Number(row.low), close: Number(row.close),
          volume: Number(row.trade_volume || 0), value: Number(row.trade_value || 0), transactions: Number(row.transactions || 0),
          top50Rank: row.top50_rank ? Number(row.top50_rank) : null, isTop50: row.is_top50 === '1'
        });
      }
    }
    return result.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  }
}

module.exports = { DRIVE_DATASETS, DriveHistorySource, createDriveTextFetcher, csvFields, parseCsv, validBar, yearsBetween };
