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

class MopsMcpHistory {
  constructor(options = {}) {
    this.drive = options.drive || new DriveHistorySource();
    this.client = options.client || new MopsClient();
  }

  async monthlyRevenue({ year, symbol, asOf } = {}) {
    const rows = await this.drive.mopsRows('monthlyRevenue', Number(year));
    return { provider: 'MOPS_MCP', dataset: 'monthlyRevenue', rows: filterAvailable(filterBySymbol(rows, symbol), asOf) };
  }

  async quarterlyFinancials({ year, symbol, asOf } = {}) {
    const rows = await this.drive.mopsRows('quarterlyFinancials', Number(year));
    return { provider: 'MOPS_MCP', dataset: 'quarterlyFinancials', rows: filterAvailable(filterBySymbol(rows, symbol), asOf) };
  }

  async majorMessages({ year, symbol, asOf } = {}) {
    const rows = await this.drive.mopsRows('majorMessages', Number(year));
    return { provider: 'MOPS_MCP', dataset: 'majorMessages', rows: filterAvailable(filterBySymbol(rows, symbol), asOf) };
  }

  async filingIndex({ year, symbol, asOf } = {}) {
    const rows = await this.drive.mopsRows('filingIndex', Number(year));
    return { provider: 'MOPS_MCP', dataset: 'filingIndex', rows: filterAvailable(filterBySymbol(rows, symbol), asOf) };
  }

  tools() {
    return [
      { name: 'mops_monthly_revenue', description: 'Read MOPS monthly revenue history from the official cached dataset', inputSchema: { type: 'object', properties: { year: { type: 'integer' }, symbol: { type: 'string' }, asOf: { type: 'string' } }, required: ['year'] } },
      { name: 'mops_quarterly_financials', description: 'Read MOPS quarterly financial history from the official cached dataset', inputSchema: { type: 'object', properties: { year: { type: 'integer' }, symbol: { type: 'string' }, asOf: { type: 'string' } }, required: ['year'] } },
      { name: 'mops_major_messages', description: 'Read MOPS material announcements point-in-time', inputSchema: { type: 'object', properties: { year: { type: 'integer' }, symbol: { type: 'string' }, asOf: { type: 'string' } }, required: ['year'] } },
      { name: 'mops_filing_index', description: 'Read MOPS filing index with filing timestamps', inputSchema: { type: 'object', properties: { year: { type: 'integer' }, symbol: { type: 'string' }, asOf: { type: 'string' } }, required: ['year'] } }
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

module.exports = { MopsMcpHistory, filterAvailable, filterBySymbol, normalizeSymbol };
