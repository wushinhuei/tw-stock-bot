'use strict';

const { DriveHistorySource } = require('./drive_history');
const { MopsClient } = require('./mops_history');

function normalizeSymbol(value) {
  const match = String(value || '').match(/\b\d{4}\b/);
  return match ? match[0] : '';
}

function filterBySymbol(rows, symbol) {
  const code = normalizeSymbol(symbol);
  return code ? (rows || []).filter(row => normalizeSymbol(row.stock_code || row.symbol || row['公司代號']) === code) : (rows || []);
}

function filterAvailable(rows, asOf) {
  if (!asOf) return rows || [];
  const cutoff = String(asOf).replace(' ', 'T');
  return (rows || []).filter(row => {
    const at = String(row.available_from || row.availableAt || row.source_available_at || '').replace(' ', 'T');
    return !at || at <= cutoff;
  });
}

function isoDate(year, month, day, time = '00:00:00+08:00') {
  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}T${time}`;
}

function conservativeMonthlyAvailability(year, month) {
  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;
  // Listed-company monthly revenue is due by the 10th of the following month.
  // Use the 11th, not the filing deadline itself, so replay never assumes early publication.
  return isoDate(nextYear, nextMonth, 11);
}

function conservativeQuarterAvailability(year, quarter) {
  // Conservative point-in-time gates: annual report after Mar-31; Q1 after May-15;
  // H1 after Aug-31; Q3 after Nov-14.  Using the following day prevents
  // accidental same-deadline use when exact filing timestamps are unavailable.
  if (quarter === 4) return isoDate(year + 1, 4, 1);
  if (quarter === 1) return isoDate(year, 5, 16);
  if (quarter === 2) return isoDate(year, 9, 1);
  return isoDate(year, 11, 15);
}

function numeric(value) {
  if (value == null || value === '') return null;
  const text = String(value).replace(/,/g, '').replace(/\s+/g, '').replace(/[()]/g, match => match === '(' ? '-' : '');
  const normalized = text.endsWith(')') ? text.slice(0, -1) : text;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : null;
}

const FACT_PATTERNS = Object.freeze({
  revenue: [/營業收入合計/i, /^營業收入$/i, /^收入合計$/i, /^收入$/i],
  operating_income: [/營業利益.*損失/i, /營業利益/i, /營業損益/i],
  net_income: [/本期淨利.*淨損/i, /本期稅後淨利/i, /淨利.*淨損.*歸屬於母公司/i],
  eps: [/基本每股盈餘/i],
  assets: [/^資產總計$/i, /^資產合計$/i],
  liabilities: [/^負債總計$/i, /^負債合計$/i],
  equity: [/^權益總計$/i, /^權益合計$/i],
  cash: [/現金及約當現金/i],
  operating_cash_flow: [/營業活動.*淨現金流/i, /營業活動之淨現金/i],
  capital_expenditure: [/取得.*不動產.*廠房.*設備/i, /購置.*不動產.*廠房.*設備/i],
  current_assets: [/^流動資產合計$/i, /^流動資產$/i],
  current_liabilities: [/^流動負債合計$/i, /^流動負債$/i]
});

function factsFromRaw(raw = {}) {
  const facts = [];
  for (const [metric, patterns] of Object.entries(FACT_PATTERNS)) {
    for (const [key, value] of Object.entries(raw)) {
      if (!patterns.some(pattern => pattern.test(String(key)))) continue;
      const parsed = numeric(value);
      if (parsed == null) continue;
      facts.push({ metric, concept: String(key), value: parsed, context_ref: 'MOPS_PUBLIC_TABLE', start_date: '', end_date: '', instant: '', unit: '', decimals: '' });
      break;
    }
  }
  return facts;
}

function mergeQuarterStatements(year, quarter, statementRows) {
  const grouped = new Map();
  for (const row of statementRows.flat()) {
    const symbol = normalizeSymbol(row.stock_code);
    if (!symbol) continue;
    const key = `${symbol}:${year}:Q${quarter}`;
    const current = grouped.get(key) || {
      dataset: 'quarterlyFinancials', stock_code: symbol, stock_name: row.stock_name || '',
      fiscal_year: year, quarter, filing_date: '', filing_time: '',
      available_from: conservativeQuarterAvailability(year, quarter), source: 'MOPS_PUBLIC_TABLE',
      source_url: row.source_url || '', raw: {}, facts: []
    };
    current.raw = { ...current.raw, ...(row.raw || {}) };
    if (!current.stock_name && row.stock_name) current.stock_name = row.stock_name;
    if (row.source_url) current.source_url = row.source_url;
    grouped.set(key, current);
  }
  for (const row of grouped.values()) row.facts = factsFromRaw(row.raw);
  return [...grouped.values()];
}

async function loadDriveOrFallback(loadDrive, fallback) {
  try {
    const rows = await loadDrive();
    if (Array.isArray(rows) && rows.length) return { rows, source: 'GOOGLE_DRIVE_OFFICIAL_CACHE' };
  } catch (error) {
    const result = await fallback(error);
    return result;
  }
  return fallback(null);
}

class MopsMcpHistory {
  constructor(options = {}) {
    this.drive = options.drive || new DriveHistorySource();
    this.client = options.client || new MopsClient();
    this.allowPublicFallback = options.allowPublicFallback !== false;
  }

  async publicMonthlyRevenue(year) {
    const rows = [];
    for (let month = 1; month <= 12; month += 1) {
      const batch = await this.client.query('monthlyRevenue', Number(year), month);
      for (const row of batch) rows.push({ ...row, available_from: row.available_from || conservativeMonthlyAvailability(Number(year), month) });
    }
    return rows;
  }

  async publicQuarterlyFinancials(year) {
    const rows = [];
    for (const quarter of [1, 2, 3, 4]) {
      const statements = [];
      for (const dataset of ['incomeStatement', 'balanceSheet', 'cashFlow']) {
        try { statements.push(await this.client.query(dataset, Number(year), quarter)); }
        catch (error) {
          if (/SECURITY_BLOCK/.test(String(error?.message || error))) throw error;
          statements.push([]);
        }
      }
      rows.push(...mergeQuarterStatements(Number(year), quarter, statements));
    }
    return rows;
  }

  async publicMajorMessages(year) {
    return this.client.query('majorMessages', Number(year), null);
  }

  async monthlyRevenue({ year, symbol, asOf } = {}) {
    const loaded = await loadDriveOrFallback(
      () => this.drive.mopsRows('monthlyRevenue', Number(year)),
      async error => {
        if (!this.allowPublicFallback) throw error || new Error('MOPS monthly revenue cache empty');
        return { rows: await this.publicMonthlyRevenue(year), source: 'MOPS_PUBLIC_OFFICIAL_FALLBACK' };
      }
    );
    return { provider: 'MOPS_MCP', source: loaded.source, dataset: 'monthlyRevenue', rows: filterAvailable(filterBySymbol(loaded.rows, symbol), asOf) };
  }

  async quarterlyFinancials({ year, symbol, asOf } = {}) {
    const loaded = await loadDriveOrFallback(
      () => this.drive.mopsRows('quarterlyFinancials', Number(year)),
      async error => {
        if (!this.allowPublicFallback) throw error || new Error('MOPS financial cache empty');
        return { rows: await this.publicQuarterlyFinancials(year), source: 'MOPS_PUBLIC_OFFICIAL_FALLBACK_CONSERVATIVE_TIMING' };
      }
    );
    return { provider: 'MOPS_MCP', source: loaded.source, dataset: 'quarterlyFinancials', rows: filterAvailable(filterBySymbol(loaded.rows, symbol), asOf) };
  }

  async majorMessages({ year, symbol, asOf } = {}) {
    const loaded = await loadDriveOrFallback(
      () => this.drive.mopsRows('majorMessages', Number(year)),
      async error => {
        if (!this.allowPublicFallback) throw error || new Error('MOPS major-message cache empty');
        return { rows: await this.publicMajorMessages(year), source: 'MOPS_PUBLIC_OFFICIAL_FALLBACK' };
      }
    );
    return { provider: 'MOPS_MCP', source: loaded.source, dataset: 'majorMessages', rows: filterAvailable(filterBySymbol(loaded.rows, symbol), asOf) };
  }

  async filingIndex({ year, symbol, asOf } = {}) {
    const loaded = await loadDriveOrFallback(
      () => this.drive.mopsRows('filingIndex', Number(year)),
      async error => {
        if (!this.allowPublicFallback) throw error || new Error('MOPS filing-index cache empty');
        const financials = await this.publicQuarterlyFinancials(year);
        return {
          source: 'MOPS_PUBLIC_OFFICIAL_FALLBACK_CONSERVATIVE_TIMING',
          rows: financials.map(row => ({
            dataset: 'filingIndex', stock_code: row.stock_code, stock_name: row.stock_name,
            fiscal_year: row.fiscal_year, quarter: row.quarter,
            filing_date: row.available_from.slice(0, 10), filing_time: '00:00:00+08:00',
            available_from: row.available_from, source: row.source, source_url: row.source_url,
            timing_policy: 'CONSERVATIVE_STATUTORY_DEADLINE_PLUS_ONE_DAY'
          }))
        };
      }
    );
    return { provider: 'MOPS_MCP', source: loaded.source, dataset: 'filingIndex', rows: filterAvailable(filterBySymbol(loaded.rows, symbol), asOf) };
  }

  tools() {
    return [
      { name: 'mops_monthly_revenue', description: 'Read official MOPS monthly revenue history; use Drive cache first and public MOPS fallback when cache credentials are unavailable', inputSchema: { type: 'object', properties: { year: { type: 'integer' }, symbol: { type: 'string' }, asOf: { type: 'string' } }, required: ['year'] } },
      { name: 'mops_quarterly_financials', description: 'Read official MOPS quarterly financial history with conservative point-in-time timing fallback', inputSchema: { type: 'object', properties: { year: { type: 'integer' }, symbol: { type: 'string' }, asOf: { type: 'string' } }, required: ['year'] } },
      { name: 'mops_major_messages', description: 'Read MOPS material announcements point-in-time', inputSchema: { type: 'object', properties: { year: { type: 'integer' }, symbol: { type: 'string' }, asOf: { type: 'string' } }, required: ['year'] } },
      { name: 'mops_filing_index', description: 'Read MOPS filing index with exact cached timestamps or conservative official-public fallback timing', inputSchema: { type: 'object', properties: { year: { type: 'integer' }, symbol: { type: 'string' }, asOf: { type: 'string' } }, required: ['year'] } }
    ];
  }

  async callTool(name, args = {}) {
    const map = {
      mops_monthly_revenue: 'monthlyRevenue',
      mops_quarterly_financials: 'quarterlyFinancials',
      mops_major_messages: 'majorMessages',
      mops_filing_index: 'filingIndex'
    };
    const method = map[name];
    if (!method) throw new Error(`Unknown MOPS MCP tool: ${name}`);
    const result = await this[method](args);
    return { content: [{ type: 'text', text: JSON.stringify(result) }], structuredContent: result };
  }
}

module.exports = {
  MopsMcpHistory, conservativeMonthlyAvailability, conservativeQuarterAvailability,
  factsFromRaw, filterAvailable, filterBySymbol, loadDriveOrFallback, mergeQuarterStatements,
  normalizeSymbol, numeric
};
