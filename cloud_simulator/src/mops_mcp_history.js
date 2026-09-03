'use strict';

const path = require('node:path');
const { DriveHistorySource } = require('./drive_history');
const {
  MopsClient, SECURITY_BLOCK, canonicalRow, downloadXbrlArchive, parseHtmlTables,
  parseXbrlArchive, rowsFromTable
} = require('./mops_history');

const MOPS_BASE = 'https://mops.twse.com.tw/mops/web';
const MONTHLY_ARCHIVE_BASE = 'https://mops.twse.com.tw/server-java/FileDownLoad';

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
  return isoDate(nextYear, nextMonth, 11);
}

function conservativeQuarterAvailability(year, quarter) {
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

function parseCsv(text) {
  const rows = [];
  let row = []; let cell = ''; let quoted = false;
  const source = String(text || '').replace(/^\uFEFF/, '');
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (quoted) {
      if (ch === '"' && source[i + 1] === '"') { cell += '"'; i += 1; }
      else if (ch === '"') quoted = false;
      else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') { row.push(cell.trim()); cell = ''; }
    else if (ch === '\n') { row.push(cell.trim()); if (row.some(Boolean)) rows.push(row); row = []; cell = ''; }
    else if (ch !== '\r') cell += ch;
  }
  row.push(cell.trim()); if (row.some(Boolean)) rows.push(row);
  return rows;
}

function monthlyArchiveUrl(year, month) {
  const roc = Number(year) - 1911;
  const params = new URLSearchParams({
    step: '9', functionName: 'show_file', filePath: '/home/html/nas/t21/sii/',
    fileName: `t21sc03_${roc}_${Number(month)}.csv`
  });
  return `${MONTHLY_ARCHIVE_BASE}?${params}`;
}

function canonicalMonthlyArchiveRows(text, year, month, sourceUrl) {
  const table = parseCsv(text);
  const headerIndex = table.findIndex(row => row.some(cell => /公司代號/.test(String(cell))));
  if (headerIndex < 0) return [];
  const header = table[headerIndex];
  return table.slice(headerIndex + 1).map(values => Object.fromEntries(header.map((key, index) => [key, values[index] ?? ''])))
    .filter(raw => normalizeSymbol(raw['公司代號']))
    .map(raw => ({
      ...canonicalRow('monthlyRevenue', raw, { year: Number(year), month: Number(month), sourceUrl }),
      available_from: conservativeMonthlyAvailability(Number(year), Number(month)),
      source: 'MOPS_MONTHLY_OFFICIAL_ARCHIVE',
      timing_policy: 'CONSERVATIVE_MONTHLY_DEADLINE_PLUS_ONE_DAY'
    }));
}

async function loadDriveOrFallback(loadDrive, fallback) {
  try {
    const rows = await loadDrive();
    if (Array.isArray(rows) && rows.length) return { rows, source: 'GOOGLE_DRIVE_OFFICIAL_CACHE' };
  } catch (error) {
    return fallback(error);
  }
  return fallback(null);
}

class MopsMcpHistory {
  constructor(options = {}) {
    this.drive = options.drive || new DriveHistorySource();
    this.client = options.client || new MopsClient();
    this.allowPublicFallback = options.allowPublicFallback !== false;
    this.fetchImpl = options.fetchImpl || this.client.fetchImpl || fetch;
    this.publicCache = new Map();
  }

  async publicMonthlyRevenue(year, months = null) {
    const selectedMonths = months?.length ? months.map(Number) : Array.from({ length: 12 }, (_, index) => index + 1);
    const rows = [];
    for (const month of selectedMonths) {
      const cacheKey = `revenue:${year}:${month}`;
      if (!this.publicCache.has(cacheKey)) {
        const sourceUrl = monthlyArchiveUrl(year, month);
        const response = await this.fetchImpl(sourceUrl, { headers: { accept: 'text/csv,*/*', 'user-agent': 'tw-stock-bot-mops-mcp/1.0 (+official-archive)' }, signal: AbortSignal.timeout(120000) });
        if (!response.ok) throw new Error(`MOPS_MONTHLY_ARCHIVE_HTTP_${response.status}`);
        const text = await response.text();
        if (SECURITY_BLOCK.test(text)) throw new Error('MOPS_SECURITY_BLOCK: monthly official archive blocked');
        this.publicCache.set(cacheKey, canonicalMonthlyArchiveRows(text, year, month, sourceUrl));
      }
      rows.push(...this.publicCache.get(cacheKey));
    }
    return rows;
  }

  async publicQuarterlyFinancials(year, options = {}) {
    const quarters = options.quarters?.length ? options.quarters.map(Number) : [1, 2, 3, 4];
    const allowedSymbols = new Set((options.symbols || []).map(normalizeSymbol).filter(Boolean));
    const rows = [];
    for (const quarter of quarters) {
      const cacheKey = `xbrl:${year}:Q${quarter}:${[...allowedSymbols].sort().join(',') || 'ALL'}`;
      if (!this.publicCache.has(cacheKey)) {
        const archive = await downloadXbrlArchive(Number(year), quarter, {
          outputDir: path.resolve(process.env.MOPS_PUBLIC_XBRL_DIR || 'tmp/mops-public-xbrl'),
          fetchImpl: this.fetchImpl
        });
        const parsed = await parseXbrlArchive(archive.target, allowedSymbols.size ? allowedSymbols : new Set(), { sourceUrl: archive.source_url });
        const normalized = parsed.map(row => ({
          ...row,
          available_from: row.available_from || conservativeQuarterAvailability(Number(year), quarter),
          source: row.source || 'MOPS_XBRL',
          timing_policy: row.available_from ? 'EXACT_FILING_TIME' : 'CONSERVATIVE_STATUTORY_DEADLINE_PLUS_ONE_DAY'
        }));
        this.publicCache.set(cacheKey, normalized);
      }
      rows.push(...this.publicCache.get(cacheKey));
    }
    return rows;
  }

  async publicMajorMessages(year, symbol) {
    const code = normalizeSymbol(symbol);
    if (!code) return [];
    const cacheKey = `messages:${year}:${code}`;
    if (this.publicCache.has(cacheKey)) return this.publicCache.get(cacheKey);
    const sourceUrl = `${MOPS_BASE}/t05st01?${new URLSearchParams({ firstin: 'true', co_id: code, year: String(Number(year) - 1911) })}`;
    const response = await this.fetchImpl(sourceUrl, { headers: { accept: 'text/html,application/xhtml+xml', 'user-agent': 'tw-stock-bot-mops-mcp/1.0 (+official-history)' }, signal: AbortSignal.timeout(120000) });
    const html = await response.text();
    if (!response.ok) throw new Error(`MOPS_MAJOR_MESSAGE_HTTP_${response.status}`);
    if (SECURITY_BLOCK.test(html)) throw new Error('MOPS_SECURITY_BLOCK: historical major messages blocked');
    const rows = parseHtmlTables(html).flatMap(rowsFromTable)
      .map(raw => canonicalRow('majorMessages', raw, { year: Number(year), sourceUrl }))
      .filter(row => normalizeSymbol(row.stock_code || code) === code)
      .map(row => ({ ...row, stock_code: row.stock_code || code }));
    this.publicCache.set(cacheKey, rows);
    return rows;
  }

  async monthlyRevenue({ year, symbol, asOf, months } = {}) {
    const loaded = await loadDriveOrFallback(
      () => this.drive.mopsRows('monthlyRevenue', Number(year)),
      async error => {
        if (!this.allowPublicFallback) throw error || new Error('MOPS monthly revenue cache empty');
        return { rows: await this.publicMonthlyRevenue(year, months), source: 'MOPS_OFFICIAL_MONTHLY_ARCHIVE' };
      }
    );
    return { provider: 'MOPS_MCP', source: loaded.source, dataset: 'monthlyRevenue', rows: filterAvailable(filterBySymbol(loaded.rows, symbol), asOf) };
  }

  async quarterlyFinancials({ year, symbol, asOf, quarters } = {}) {
    const loaded = await loadDriveOrFallback(
      () => this.drive.mopsRows('quarterlyFinancials', Number(year)),
      async error => {
        if (!this.allowPublicFallback) throw error || new Error('MOPS financial cache empty');
        const rows = await this.publicQuarterlyFinancials(year, { quarters, symbols: symbol ? [symbol] : [] });
        return { rows, source: 'MOPS_OFFICIAL_XBRL_ARCHIVE_CONSERVATIVE_TIMING' };
      }
    );
    return { provider: 'MOPS_MCP', source: loaded.source, dataset: 'quarterlyFinancials', rows: filterAvailable(filterBySymbol(loaded.rows, symbol), asOf) };
  }

  async majorMessages({ year, symbol, asOf } = {}) {
    const loaded = await loadDriveOrFallback(
      () => this.drive.mopsRows('majorMessages', Number(year)),
      async error => {
        if (!this.allowPublicFallback) throw error || new Error('MOPS major-message cache empty');
        return { rows: await this.publicMajorMessages(year, symbol), source: 'MOPS_OFFICIAL_HISTORICAL_PAGE' };
      }
    );
    return { provider: 'MOPS_MCP', source: loaded.source, dataset: 'majorMessages', rows: filterAvailable(filterBySymbol(loaded.rows, symbol), asOf) };
  }

  async filingIndex({ year, symbol, asOf, quarters } = {}) {
    const loaded = await loadDriveOrFallback(
      () => this.drive.mopsRows('filingIndex', Number(year)),
      async error => {
        if (!this.allowPublicFallback) throw error || new Error('MOPS filing-index cache empty');
        const financials = await this.publicQuarterlyFinancials(year, { quarters, symbols: symbol ? [symbol] : [] });
        return {
          source: 'MOPS_OFFICIAL_XBRL_ARCHIVE_CONSERVATIVE_TIMING',
          rows: financials.map(row => ({
            dataset: 'filingIndex', stock_code: row.stock_code, stock_name: row.stock_name,
            fiscal_year: row.fiscal_year, quarter: row.quarter,
            filing_date: row.available_from.slice(0, 10), filing_time: '00:00:00+08:00',
            available_from: row.available_from, source: row.source, source_url: row.source_url,
            timing_policy: row.timing_policy || 'CONSERVATIVE_STATUTORY_DEADLINE_PLUS_ONE_DAY'
          }))
        };
      }
    );
    return { provider: 'MOPS_MCP', source: loaded.source, dataset: 'filingIndex', rows: filterAvailable(filterBySymbol(loaded.rows, symbol), asOf) };
  }

  tools() {
    const properties = { year: { type: 'integer' }, symbol: { type: 'string' }, asOf: { type: 'string' }, months: { type: 'array', items: { type: 'integer' } }, quarters: { type: 'array', items: { type: 'integer' } } };
    return [
      { name: 'mops_monthly_revenue', description: 'Read official MOPS monthly revenue; Drive cache first, then credentialless official monthly archive', inputSchema: { type: 'object', properties, required: ['year'] } },
      { name: 'mops_quarterly_financials', description: 'Read official MOPS quarterly financial history; Drive cache first, then official XBRL archive', inputSchema: { type: 'object', properties, required: ['year'] } },
      { name: 'mops_major_messages', description: 'Read MOPS material announcements point-in-time; credentialless fallback queries official historical page by symbol', inputSchema: { type: 'object', properties, required: ['year'] } },
      { name: 'mops_filing_index', description: 'Read filing index with exact cached timestamps or conservative XBRL timing fallback', inputSchema: { type: 'object', properties, required: ['year'] } }
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
  MopsMcpHistory, canonicalMonthlyArchiveRows, conservativeMonthlyAvailability, conservativeQuarterAvailability,
  factsFromRaw, filterAvailable, filterBySymbol, loadDriveOrFallback, mergeQuarterStatements,
  monthlyArchiveUrl, normalizeSymbol, numeric, parseCsv
};
