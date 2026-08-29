'use strict';

const { GoogleAuth } = require('google-auth-library');
const { adjustBars } = require('./corporate_actions');

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
  }),
  marketFlow: Object.freeze({
    folderId: '1UN4xM089UmWq0XKbVJjlLM2avK7yHq-i',
    manifestId: '1euGZK6A2YzyQKrZehk7qvTLhOP83uOVm',
    files: Object.freeze({
      2016: '1u0EOHBy_jIxf5rjH24q8CWj-kyoUsVen', 2017: '1kmZoBwWOPHJxP4pBU25OgTYcsTIKiY7U',
      2018: '1UKv6SA4fsTgbEzEgIpBTtHhEm9ktryns', 2019: '1VE_0bbMqYxGOYrhOzT1t2KS5sJiDBvJ2',
      2020: '1sMXLyJblRwnOdAaqGONz3o5Qfwxqg2PC', 2021: '1hwpZA-PMru1gSpRqvfM8giqh9BJKYEx7',
      2022: '1oXPLj_aIBIM5ro_2bMLpiF_MfgwgpiCL', 2023: '1nMpMzS8hhy8DDuYwqeryti34_zP1W-EO',
      2024: '1rZO0MLbbKod3-3lRuyGemQkTGBceyNcA', 2025: '14_GmE5Qukcn__mXnzM5-zcqqiRyQo622',
      2026: '1youqfuh2UPMLzwsKM5LuyZcg49vKMq8C'
    })
  }),
  corporateActions: Object.freeze({
    folderId: '1tzD1pSXC77ywAwgSirEnfdZ2lznoXS34',
    manifestId: '1NGiDXXJW0caFOmW5RfsorjOd4Zlqny6S',
    files: Object.freeze({ all: '18wWLGK4xD-mRMhogH4brghdxFMK1AxNQ', factors: '17VxJoaQ02ntiA2TJInZSFUm0gXITj1Pw' })
  })
});

const MOPS_ROLLING = Object.freeze({
  manifestId: '1Sl5pzvt3SjaHQF7gvjZDZsVMTSbf1PiD',
  datasets: Object.freeze({
    companyBasic: Object.freeze({ folderId: '1Qd_zkcAFa4Jc_Mlps3XJp35q3vG0TGqP', name: () => 'company_basic_latest.jsonl' }),
    monthlyRevenue: Object.freeze({ folderId: '1w6Xft0UqrC4lnFCRl8HYtnN5JjgrTBeS', name: year => `monthly_revenue_${year}.jsonl` }),
    quarterlyFinancials: Object.freeze({ folderId: '1oNlmeY46SpjBoZCUUlLCGGu8AV1W-knd', name: year => `quarterly_openapi_${year}.jsonl` }),
    majorMessages: Object.freeze({ folderId: '1r7ThzvUZeX6stObW1XrA42IrIAPisKsO', name: year => `major_messages_${year}.jsonl` }),
    filingIndex: Object.freeze({ folderId: '1sl84LYnUXJ149HhUzQKdcmPCnEQPL1l9', name: year => `filing_times_${year}.jsonl` })
  })
});

const ANALYSIS_UNIVERSE = Object.freeze({
  folderId: '1zN3mhXleUSdg_zc3_pZRwXpn0J3dXmcL',
  rowsName: 'analysis_universe.jsonl',
  manifestName: 'analysis_universe_manifest.json'
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

function parseJsonl(text) {
  return String(text || '').split(/\r?\n/).filter(Boolean).map((line, index) => {
    try { return JSON.parse(line); }
    catch (error) { throw new Error(`invalid JSONL at line ${index + 1}: ${error.message}`); }
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

function createDriveFileFinder(options = {}) {
  const auth = options.auth || new GoogleAuth({ scopes: ['https://www.googleapis.com/auth/drive.readonly'] });
  const fetchImpl = options.fetchImpl || fetch;
  return async (folderId, name) => {
    const client = await auth.getClient();
    const headers = await client.getRequestHeaders();
    const escaped = String(name).replaceAll("'", "\\'");
    const query = `'${folderId}' in parents and name='${escaped}' and trashed=false`;
    const url = `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name,modifiedTime)&orderBy=modifiedTime%20desc&pageSize=2`;
    const response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`Google Drive list ${name} HTTP ${response.status}`);
    const files = (await response.json()).files || [];
    if (files.length !== 1) throw new Error(`Google Drive expected one ${name}, found ${files.length}`);
    return files[0].id;
  };
}

class DriveHistorySource {
  constructor(options = {}) {
    this.datasets = options.datasets || DRIVE_DATASETS;
    this.fetchText = options.fetchText || createDriveTextFetcher(options);
    this.findFile = options.findFile || createDriveFileFinder(options);
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
      const status = payload.last_update?.status || payload.status;
      if (payload.last_update?.error || payload.errors?.length || !/complete$/i.test(String(status || ''))) throw new Error(`${name} Drive manifest is not complete`);
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

  async marketFlowRows(symbol, start, end) {
    await this.manifest('marketFlow');
    const result = [];
    for (const year of yearsBetween(start, end)) {
      for (const row of await this.rows('marketFlow', year)) {
        if (row.stock_code === String(symbol) && row.trade_date >= start && row.trade_date <= end) result.push(row);
      }
    }
    return result.sort((a, b) => a.trade_date.localeCompare(b.trade_date));
  }

  async mopsManifest() {
    if (!this.cache.has('mops:manifest')) {
      const payload = JSON.parse(await this.fetchText(MOPS_ROLLING.manifestId));
      if (payload.status !== 'complete' || (payload.warnings || []).length) throw new Error('MOPS Drive manifest is not complete');
      this.cache.set('mops:manifest', payload);
    }
    return this.cache.get('mops:manifest');
  }

  async mopsRows(name, year = new Date().getFullYear()) {
    await this.mopsManifest();
    const definition = MOPS_ROLLING.datasets[name];
    if (!definition) throw new Error(`unknown MOPS Drive dataset: ${name}`);
    const fileName = definition.name(year);
    const key = `mops:${name}:${fileName}`;
    if (!this.cache.has(key)) {
      const fileId = await this.findFile(definition.folderId, fileName);
      this.cache.set(key, parseJsonl(await this.fetchText(fileId)));
    }
    return this.cache.get(key);
  }

  async analysisUniverse() {
    const key = 'analysis:universe';
    if (!this.cache.has(key)) {
      const fileId = await this.findFile(ANALYSIS_UNIVERSE.folderId, ANALYSIS_UNIVERSE.rowsName);
      this.cache.set(key, parseJsonl(await this.fetchText(fileId)));
    }
    return this.cache.get(key);
  }

  async analysisUniverseManifest() {
    const key = 'analysis:manifest';
    if (!this.cache.has(key)) {
      const fileId = await this.findFile(ANALYSIS_UNIVERSE.folderId, ANALYSIS_UNIVERSE.manifestName);
      const rows = parseJsonl(await this.fetchText(fileId));
      if (rows.length !== 1) throw new Error('analysis universe manifest must contain one record');
      this.cache.set(key, rows[0]);
    }
    return this.cache.get(key);
  }

  async analysisReady(symbol) {
    const code = String(symbol);
    const row = (await this.analysisUniverse()).find(item => item.stock_code === code);
    return Boolean(row && row.analysis_ready);
  }

  async analysisStatus() {
    const [top50, stockDaily, marketFlow, mops] = await Promise.all([
      this.manifest('top50'), this.manifest('stockDaily'), this.manifest('marketFlow'), this.mopsManifest()
    ]);
    const dates = [top50.latest_successful_trade_date, stockDaily.latest_successful_trade_date, marketFlow.latest_successful_trade_date];
    if (!dates[0] || new Set(dates).size !== 1 || marketFlow.top50_alignment?.aligned !== true) {
      throw new Error(`Drive analysis dates are not aligned: ${dates.join('/')}`);
    }
    return {
      tradeDate: dates[0],
      top50: { status: top50.last_update.status, rows: top50.total_rows },
      stockDaily: { status: stockDaily.last_update.status, rows: stockDaily.total_rows, symbols: stockDaily.stock_count },
      marketFlow: { status: marketFlow.last_update.status, rows: marketFlow.total_rows, sources: marketFlow.source_status },
      mops: { status: mops.status, generatedAt: mops.generated_at, symbols: mops.symbol_count, results: mops.results }
    };
  }

  async corporateActions(symbol, start, end) {
    await this.manifest('corporateActions');
    const rows = await this.rows('corporateActions', 'all');
    return rows.filter(row => row.stock_code === String(symbol) && row.action_date >= start && row.action_date <= end)
      .map(row => ({ ...row, adjustment_factor: Number(row.adjustment_factor) }))
      .sort((a, b) => a.action_date.localeCompare(b.action_date));
  }

  async adjustedDailyBars(symbol, start, end) {
    const [bars, actions] = await Promise.all([
      this.dailyBars(symbol, start, end),
      this.corporateActions(symbol, start, '9999-12-31')
    ]);
    return adjustBars(bars, actions);
  }
}

module.exports = { ANALYSIS_UNIVERSE, DRIVE_DATASETS, MOPS_ROLLING, DriveHistorySource, createDriveFileFinder, createDriveTextFetcher, csvFields, parseCsv, parseJsonl, validBar, yearsBetween };
