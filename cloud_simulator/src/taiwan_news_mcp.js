'use strict';

const crypto = require('node:crypto');
const { classify, deduplicateNews, newsScopeDecision } = require('./news');

const SOURCES = Object.freeze({
  UDN_ECONOMIC_DAILY: Object.freeze({ source: '經濟日報', host: 'money.udn.com', automatedMethods: Object.freeze(['LICENSED_API', 'RSS']) }),
  CTEE: Object.freeze({ source: '工商時報', host: 'ctee.com.tw', automatedMethods: Object.freeze(['LICENSED_API', 'RSS']) })
});

function normalizeItem(item, sourceConfig) {
  const title = String(item?.title || '').trim();
  const url = String(item?.url || item?.link || '').trim();
  const publishedAt = new Date(item?.publishedAt || item?.pubDate || item?.date || 0).toISOString();
  const summary = String(item?.summary || item?.description || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 500);
  const classification = classify(`${title} ${summary}`);
  const relatedSymbols = Array.isArray(item?.relatedSymbols) ? item.relatedSymbols.map(String) : [];
  const normalized = {
    source: sourceConfig.source, title, summary, url, publishedAt, fetchedAt: new Date().toISOString(),
    acquisitionMethod: String(item?.acquisitionMethod || 'LICENSED_API').toUpperCase(), relatedSymbols,
    top100Related: item?.top100Related === true, marketScope: item?.marketScope || item?.scope || null,
    eventKey: item?.eventKey || crypto.createHash('sha256').update(`${sourceConfig.source}|${title}|${publishedAt}`).digest('hex').slice(0, 24),
    hash: crypto.createHash('sha256').update(`${url}|${title}|${publishedAt}`).digest('hex'), ...classification
  };
  const scope = newsScopeDecision(normalized);
  return { ...normalized, ...scope };
}

function validateConfiguredEndpoint(name, endpoint) {
  const config = SOURCES[name];
  if (!config) throw new Error(`Unsupported Taiwan news source: ${name}`);
  if (!endpoint) return { enabled: false, source: config.source, reason: 'NO_LICENSED_ENDPOINT_CONFIGURED' };
  const url = new URL(endpoint);
  return { enabled: true, source: config.source, endpoint: url.toString() };
}

async function fetchJsonEndpoint(name, endpoint, options = {}) {
  const status = validateConfiguredEndpoint(name, endpoint);
  if (!status.enabled) return { source: status.source, rows: [], status: 'NOT_CONFIGURED', reason: status.reason };
  const config = SOURCES[name];
  const response = await (options.fetchImpl || fetch)(status.endpoint, {
    headers: { accept: 'application/json', 'user-agent': 'tw-stock-taiwan-news-mcp/1.0', ...(options.token ? { authorization: `Bearer ${options.token}` } : {}) },
    signal: AbortSignal.timeout(Number(options.timeoutMs || 15000))
  });
  if (!response.ok) throw new Error(`${config.source} licensed endpoint HTTP ${response.status}`);
  const json = await response.json();
  const rawRows = Array.isArray(json) ? json : Array.isArray(json.items) ? json.items : Array.isArray(json.rows) ? json.rows : [];
  const normalized = deduplicateNews(rawRows.map(row => normalizeItem(row, config)));
  const scopeMode = String(options.scopeMode || 'TRADING_RISK').toUpperCase();
  const rows = scopeMode === 'GROWTH_DISCOVERY' ? normalized : normalized.filter(row => row.eligible);
  return {
    source: config.source, status: 'OK', rows, suppressedCount: rawRows.length - rows.length,
    policy: scopeMode === 'GROWTH_DISCOVERY' ? 'MARKET_WIDE_GROWTH_DISCOVERY' : 'TOP100_RELATED_OR_GLOBAL_MAJOR_ONLY', licensedOnly: true
  };
}

class TaiwanNewsMcp {
  constructor(options = {}) {
    this.fetchImpl = options.fetchImpl || fetch;
    this.endpoints = { UDN_ECONOMIC_DAILY: options.udnEndpoint || process.env.UDN_ECONOMIC_DAILY_NEWS_ENDPOINT || '', CTEE: options.cteeEndpoint || process.env.CTEE_NEWS_ENDPOINT || '' };
    this.tokens = { UDN_ECONOMIC_DAILY: options.udnToken || process.env.UDN_ECONOMIC_DAILY_NEWS_TOKEN || '', CTEE: options.cteeToken || process.env.CTEE_NEWS_TOKEN || '' };
  }
  listTools() {
    return { tools: [
      { name: 'taiwan_financial_news', description: 'Read licensed Taiwan financial news metadata. Trading-risk mode keeps Top100/global-major only; growth-discovery mode allows market-wide discovery.', inputSchema: { type: 'object', properties: { source: { type: 'string', enum: ['ALL', 'UDN_ECONOMIC_DAILY', 'CTEE'] }, scopeMode: { type: 'string', enum: ['TRADING_RISK', 'GROWTH_DISCOVERY'] } } } },
      { name: 'taiwan_financial_news_sources', description: 'Show configured licensed Taiwan financial news MCP sources.', inputSchema: { type: 'object', properties: {} } }
    ] };
  }
  async callTool(name, args = {}) {
    if (name === 'taiwan_financial_news_sources') return { structuredContent: { rows: Object.entries(SOURCES).map(([key, config]) => ({ key, source: config.source, configured: Boolean(this.endpoints[key]), licensedOnly: true })) } };
    if (name !== 'taiwan_financial_news') throw new Error(`Unknown Taiwan news MCP tool: ${name}`);
    const requested = String(args.source || 'ALL').toUpperCase();
    const scopeMode = String(args.scopeMode || 'TRADING_RISK').toUpperCase();
    const keys = requested === 'ALL' ? Object.keys(SOURCES) : [requested];
    const results = await Promise.allSettled(keys.map(key => fetchJsonEndpoint(key, this.endpoints[key], { fetchImpl: this.fetchImpl, token: this.tokens[key], scopeMode })));
    const rows = [], sources = [], errors = [];
    results.forEach((result, index) => {
      const key = keys[index];
      if (result.status === 'fulfilled') { sources.push({ key, ...result.value, rows: undefined }); rows.push(...(result.value.rows || [])); }
      else errors.push({ key, error: String(result.reason) });
    });
    return { structuredContent: { status: errors.length ? 'PARTIAL' : 'OK', rows: deduplicateNews(rows), sources, errors, policy: scopeMode === 'GROWTH_DISCOVERY' ? 'MARKET_WIDE_GROWTH_DISCOVERY' : 'TOP100_RELATED_OR_GLOBAL_MAJOR_ONLY', licensedOnly: true } };
  }
}

function startStdioServer(service = new TaiwanNewsMcp()) {
  let buffer = '';
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', async chunk => {
    buffer += chunk;
    let index;
    while ((index = buffer.indexOf('\n')) >= 0) {
      const line = buffer.slice(0, index).trim(); buffer = buffer.slice(index + 1); if (!line) continue;
      try {
        const request = JSON.parse(line); let result;
        if (request.method === 'tools/list') result = service.listTools();
        else if (request.method === 'tools/call') result = await service.callTool(request.params?.name, request.params?.arguments || {});
        else throw new Error(`Unsupported method: ${request.method}`);
        process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: request.id, result })}\n`);
      } catch (error) { process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id: null, error: { code: -32000, message: String(error.message || error) } })}\n`); }
    }
  });
}

module.exports = { SOURCES, TaiwanNewsMcp, fetchJsonEndpoint, normalizeItem, startStdioServer, validateConfiguredEndpoint };
