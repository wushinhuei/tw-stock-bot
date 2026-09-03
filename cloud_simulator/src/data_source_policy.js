'use strict';

const { callTool } = require('./twse_mcp_history');
const { callLiveTool } = require('./twse_mcp_live');

const POLICY = Object.freeze({
  primary: 'TWSE_MCP',
  fallbackOrder: Object.freeze(['GOOGLE_DRIVE_CACHE', 'OTHER_PROVIDER']),
  persistPrimaryToDrive: true,
  fallbackOnlyWhenPrimaryUnavailable: true
});

function hasRows(result) {
  return Boolean(result && Array.isArray(result.rows) && result.rows.length > 0);
}

async function primaryCall(tool, args, options = {}) {
  if (tool === 'twse_live_quotes') return callLiveTool(tool, args, options.twse || {});
  return callTool(tool, args, options.twse || {});
}

async function twsePrimary(tool, args, options = {}) {
  let result;
  try { result = await primaryCall(tool, args, options); }
  catch (error) { result = { status: 'ERROR', rows: [], error: String(error.message || error) }; }

  if (hasRows(result) || result?.status === 'OK' || tool === 'twse_holidays') {
    return { ...result, dataSource: 'TWSE_MCP', fallbackUsed: false };
  }
  if (typeof options.driveFallback === 'function') {
    const fallback = await options.driveFallback();
    if (fallback && (Array.isArray(fallback) ? fallback.length : true)) {
      return { rows: Array.isArray(fallback) ? fallback : fallback.rows, dataSource: 'GOOGLE_DRIVE_CACHE', fallbackUsed: true, primaryResult: result };
    }
  }
  if (typeof options.otherFallback === 'function') {
    const fallback = await options.otherFallback();
    if (fallback && (Array.isArray(fallback) ? fallback.length : true)) {
      return { ...(Array.isArray(fallback) ? { rows: fallback } : fallback), dataSource: 'OTHER_PROVIDER', fallbackUsed: true, primaryResult: result };
    }
  }
  return { ...result, dataSource: 'TWSE_MCP', fallbackUsed: false };
}

async function liveQuotes(symbols, options = {}) {
  const result = await twsePrimary('twse_live_quotes', { symbols }, options);
  return result.quotes || Object.fromEntries((result.rows || []).map(row => [String(row.symbol), row]));
}

module.exports = { POLICY, hasRows, liveQuotes, primaryCall, twsePrimary };
