'use strict';

const { fetchQuotes } = require('./twse');

async function callLiveTool(name, args = {}, options = {}) {
  if (name !== 'twse_live_quotes') throw new Error(`unknown live TWSE MCP tool: ${name}`);
  const symbols = [...new Set((args.symbols || []).map(value => String(value).replace(/\.TW$/i, '')).filter(value => /^\d{4}$/.test(value)))];
  const quotes = await fetchQuotes(symbols, options.fetchImpl || fetch);
  return {
    status: 'OK',
    symbols,
    quotes,
    rows: Object.values(quotes),
    source: 'TWSE_MIS',
    interface: 'TWSE_MCP_LIVE_ADAPTER'
  };
}

module.exports = { callLiveTool };
