'use strict';

const TWSE_BASE = 'https://www.twse.com.tw/rwd/zh';
const OPENAPI_BASE = 'https://openapi.twse.com.tw/v1';
const USER_AGENT = 'tw-stock-bot-twse-mcp/1.0';

function compact(date) { return String(date || '').replaceAll('-', ''); }
function isoDate(value) {
  const text = String(value || '');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) throw new Error(`invalid date: ${text}`);
  return text;
}
function stockCode(value) {
  const code = String(value || '').replace(/\.TW$/i, '');
  if (!/^\d{4}$/.test(code)) throw new Error(`invalid listed stock symbol: ${value}`);
  return code;
}
function number(value) {
  const cleaned = String(value ?? '').replaceAll(',', '').replace(/[+X]/g, '').trim();
  if (!cleaned || cleaned === '--') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function monthsBetween(start, end) {
  const first = new Date(`${isoDate(start).slice(0, 7)}-01T00:00:00Z`);
  const last = new Date(`${isoDate(end).slice(0, 7)}-01T00:00:00Z`);
  const output = [];
  for (let cursor = new Date(first); cursor <= last; cursor.setUTCMonth(cursor.getUTCMonth() + 1)) {
    output.push(`${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, '0')}-01`);
  }
  return output;
}

async function fetchJson(url, options = {}) {
  const fetchImpl = options.fetchImpl || fetch;
  const retries = options.retries ?? 4;
  const retryDelayMs = options.retryDelayMs ?? 1200;
  for (let attempt = 1; attempt <= retries; attempt += 1) {
    const response = await fetchImpl(url, {
      headers: { accept: 'application/json', 'user-agent': USER_AGENT, ...(options.headers || {}) },
      signal: AbortSignal.timeout(options.timeoutMs || 30000)
    });
    if (response.ok) return response.json();
    if (attempt === retries) throw new Error(`TWSE HTTP ${response.status}: ${url}`);
    await sleep(response.status === 403 || response.status === 429 ? Math.max(retryDelayMs, 5000) : retryDelayMs * attempt);
  }
  throw new Error(`TWSE request failed: ${url}`);
}

function findTable(payload, requiredFields) {
  const required = requiredFields.map(field => field.replace(/\s/g, ''));
  return (payload.tables || []).find(table => {
    const fields = (table.fields || []).map(field => String(field).replace(/\s/g, ''));
    return required.every(field => fields.includes(field));
  }) || null;
}

function tableIndex(table) {
  return Object.fromEntries((table.fields || []).map((field, index) => [String(field).replace(/\s/g, ''), index]));
}

async function marketDaily(date, options = {}) {
  const day = isoDate(date);
  const url = `${TWSE_BASE}/afterTrading/MI_INDEX?response=json&date=${compact(day)}&type=ALLBUT0999`;
  const payload = await fetchJson(url, options);
  if (payload.stat !== 'OK') return { date: day, rows: [], status: payload.stat || 'NO_DATA', sourceUrl: url };
  const table = findTable(payload, ['證券代號', '成交股數', '收盤價']);
  if (!table) return { date: day, rows: [], status: 'NO_STOCK_TABLE', sourceUrl: url };
  const index = tableIndex(table);
  const rows = (table.data || []).map(row => ({
    tradeDate: day,
    symbol: String(row[index['證券代號']] || '').trim(),
    name: String(row[index['證券名稱']] || '').trim(),
    volume: number(row[index['成交股數']]),
    transactions: number(row[index['成交筆數']]),
    value: number(row[index['成交金額']]),
    open: number(row[index['開盤價']]),
    high: number(row[index['最高價']]),
    low: number(row[index['最低價']]),
    close: number(row[index['收盤價']]),
    change: number(row[index['漲跌價差']]),
    bid: number(row[index['最後揭示買價']]),
    ask: number(row[index['最後揭示賣價']]),
    pe: number(row[index['本益比']])
  })).filter(row => /^\d{4}$/.test(row.symbol) && row.close != null);
  return { date: day, rows, status: 'OK', source: 'TWSE_MI_INDEX', sourceUrl: url };
}

async function stockDaily(symbol, start, end, options = {}) {
  const code = stockCode(symbol);
  const from = isoDate(start);
  const to = isoDate(end);
  if (from > to) throw new Error('start must be <= end');
  const rows = [];
  const sourceUrls = [];
  for (const month of monthsBetween(from, to)) {
    const url = `${TWSE_BASE}/afterTrading/STOCK_DAY?response=json&date=${compact(month)}&stockNo=${code}`;
    sourceUrls.push(url);
    const payload = await fetchJson(url, options);
    if (payload.stat !== 'OK' || !Array.isArray(payload.data)) continue;
    const fields = payload.fields || [];
    const index = Object.fromEntries(fields.map((field, i) => [String(field).replace(/\s/g, ''), i]));
    for (const row of payload.data) {
      const roc = String(row[index['日期']] || '').split('/').map(Number);
      if (roc.length !== 3) continue;
      const tradeDate = `${roc[0] + 1911}-${String(roc[1]).padStart(2, '0')}-${String(roc[2]).padStart(2, '0')}`;
      if (tradeDate < from || tradeDate > to) continue;
      rows.push({
        tradeDate, symbol: code,
        volume: number(row[index['成交股數']]),
        value: number(row[index['成交金額']]),
        open: number(row[index['開盤價']]),
        high: number(row[index['最高價']]),
        low: number(row[index['最低價']]),
        close: number(row[index['收盤價']]),
        change: number(row[index['漲跌價差']]),
        transactions: number(row[index['成交筆數']])
      });
    }
  }
  rows.sort((a, b) => a.tradeDate.localeCompare(b.tradeDate));
  return { symbol: code, period: { start: from, end: to }, rows, source: 'TWSE_STOCK_DAY', sourceUrls };
}

async function institutionalDaily(date, options = {}) {
  const day = isoDate(date);
  const url = `${TWSE_BASE}/fund/T86?response=json&date=${compact(day)}&selectType=ALLBUT0999`;
  const payload = await fetchJson(url, options);
  if (payload.stat !== 'OK') return { date: day, rows: [], status: payload.stat || 'NO_DATA', sourceUrl: url };
  const fields = payload.fields || [];
  const index = Object.fromEntries(fields.map((field, i) => [String(field).replace(/\s/g, ''), i]));
  const rows = (payload.data || []).map(row => ({
    tradeDate: day,
    symbol: String(row[index['證券代號']] || '').trim(),
    name: String(row[index['證券名稱']] || '').trim(),
    foreignNet: number(row[index['外陸資買賣超股數(不含外資自營商)']]),
    investmentTrustNet: number(row[index['投信買賣超股數']]),
    dealerNet: number(row[index['自營商買賣超股數']]),
    institutionalTotalNet: number(row[index['三大法人買賣超股數']])
  })).filter(row => /^\d{4}$/.test(row.symbol));
  return { date: day, rows, status: 'OK', source: 'TWSE_T86', sourceUrl: url };
}

async function marginDaily(date, options = {}) {
  const day = isoDate(date);
  const url = `${TWSE_BASE}/marginTrading/MI_MARGN?response=json&date=${compact(day)}&selectType=ALL`;
  const payload = await fetchJson(url, options);
  if (payload.stat !== 'OK') return { date: day, rows: [], status: payload.stat || 'NO_DATA', sourceUrl: url };
  const table = findTable(payload, ['股票代號', '融資今日餘額', '融券今日餘額']);
  if (!table) return { date: day, rows: [], status: 'NO_STOCK_TABLE', sourceUrl: url };
  const index = tableIndex(table);
  const rows = (table.data || []).map(row => ({
    tradeDate: day,
    symbol: String(row[index['股票代號']] || '').trim(),
    name: String(row[index['股票名稱']] || '').trim(),
    marginPreviousBalance: number(row[index['融資前日餘額']]),
    marginBuy: number(row[index['融資買進']]),
    marginSell: number(row[index['融資賣出']]),
    marginCurrentBalance: number(row[index['融資今日餘額']]),
    shortPreviousBalance: number(row[index['融券前日餘額']]),
    shortSell: number(row[index['融券賣出']]),
    shortBuy: number(row[index['融券買進']]),
    shortCurrentBalance: number(row[index['融券今日餘額']])
  })).filter(row => /^\d{4}$/.test(row.symbol));
  return { date: day, rows, status: 'OK', source: 'TWSE_MI_MARGN', sourceUrl: url };
}

async function holidays(year, options = {}) {
  const target = Number(year);
  if (!Number.isInteger(target) || target < 2010 || target > 2100) throw new Error(`invalid year: ${year}`);
  const url = `${OPENAPI_BASE}/holidaySchedule/holidaySchedule`;
  const payload = await fetchJson(url, options);
  const rows = (Array.isArray(payload) ? payload : []).filter(row => String(row.Date || row.date || '').startsWith(String(target)));
  return { year: target, rows, source: 'TWSE_OPENAPI_HOLIDAY', sourceUrl: url };
}

const TOOL_DEFINITIONS = Object.freeze([
  {
    name: 'twse_market_daily',
    description: '讀取指定交易日全部上市普通股盤後 OHLCV、成交值、收盤買賣價等官方歷史資料。',
    inputSchema: { type: 'object', properties: { date: { type: 'string', description: 'YYYY-MM-DD' } }, required: ['date'], additionalProperties: false }
  },
  {
    name: 'twse_stock_daily',
    description: '讀取單一上市股票在指定日期區間的官方日線歷史資料。',
    inputSchema: { type: 'object', properties: { symbol: { type: 'string' }, start: { type: 'string' }, end: { type: 'string' } }, required: ['symbol', 'start', 'end'], additionalProperties: false }
  },
  {
    name: 'twse_institutional_daily',
    description: '讀取指定交易日上市股票三大法人買賣超歷史資料。',
    inputSchema: { type: 'object', properties: { date: { type: 'string' } }, required: ['date'], additionalProperties: false }
  },
  {
    name: 'twse_margin_daily',
    description: '讀取指定交易日上市股票融資融券餘額歷史資料。',
    inputSchema: { type: 'object', properties: { date: { type: 'string' } }, required: ['date'], additionalProperties: false }
  },
  {
    name: 'twse_holidays',
    description: '讀取證交所官方開休市日期資料。',
    inputSchema: { type: 'object', properties: { year: { type: 'integer' } }, required: ['year'], additionalProperties: false }
  }
]);

async function callTool(name, args = {}, options = {}) {
  if (name === 'twse_market_daily') return marketDaily(args.date, options);
  if (name === 'twse_stock_daily') return stockDaily(args.symbol, args.start, args.end, options);
  if (name === 'twse_institutional_daily') return institutionalDaily(args.date, options);
  if (name === 'twse_margin_daily') return marginDaily(args.date, options);
  if (name === 'twse_holidays') return holidays(args.year, options);
  throw new Error(`unknown tool: ${name}`);
}

function mcpSuccess(id, result) { return { jsonrpc: '2.0', id, result }; }
function mcpError(id, code, message) { return { jsonrpc: '2.0', id: id ?? null, error: { code, message } }; }

async function handleMcpMessage(message, options = {}) {
  const id = message && Object.prototype.hasOwnProperty.call(message, 'id') ? message.id : null;
  try {
    if (!message || message.jsonrpc !== '2.0') return mcpError(id, -32600, 'Invalid Request');
    if (message.method === 'initialize') {
      return mcpSuccess(id, {
        protocolVersion: message.params?.protocolVersion || '2025-06-18',
        capabilities: { tools: {} },
        serverInfo: { name: 'tw-stock-bot-twse-history', version: '1.0.0' },
        instructions: 'TWSE official historical-data MCP interface. Read-only. Trading strategy is not modified.'
      });
    }
    if (message.method === 'notifications/initialized') return null;
    if (message.method === 'ping') return mcpSuccess(id, {});
    if (message.method === 'tools/list') return mcpSuccess(id, { tools: TOOL_DEFINITIONS });
    if (message.method === 'tools/call') {
      const result = await callTool(message.params?.name, message.params?.arguments || {}, options);
      return mcpSuccess(id, {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result,
        isError: false
      });
    }
    return mcpError(id, -32601, `Method not found: ${message.method}`);
  } catch (error) {
    if (message?.method === 'tools/call') {
      return mcpSuccess(id, { content: [{ type: 'text', text: String(error.message || error) }], isError: true });
    }
    return mcpError(id, -32603, String(error.message || error));
  }
}

function startStdioServer(options = {}) {
  process.stdin.setEncoding('utf8');
  let buffer = '';
  process.stdin.on('data', chunk => {
    buffer += chunk;
    let newline;
    while ((newline = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, newline).trim();
      buffer = buffer.slice(newline + 1);
      if (!line) continue;
      Promise.resolve().then(async () => {
        let message;
        try { message = JSON.parse(line); }
        catch { process.stdout.write(`${JSON.stringify(mcpError(null, -32700, 'Parse error'))}\n`); return; }
        const response = await handleMcpMessage(message, options);
        if (response) process.stdout.write(`${JSON.stringify(response)}\n`);
      }).catch(error => process.stderr.write(`[twse-mcp] ${String(error)}\n`));
    }
  });
  process.stderr.write('[twse-mcp] TWSE historical MCP server ready on stdio\n');
}

module.exports = {
  TOOL_DEFINITIONS,
  callTool,
  fetchJson,
  handleMcpMessage,
  holidays,
  institutionalDaily,
  marginDaily,
  marketDaily,
  startStdioServer,
  stockDaily
};
