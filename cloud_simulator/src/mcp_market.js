'use strict';

const { CONFIG } = require('./config');
const { callTool: callTwse } = require('./twse_mcp_history');
const { callLiveTool } = require('./twse_mcp_live');
const { callTool: callYahoo } = require('./yahoo_mcp');

function ymd(value) { return value.toISOString().slice(0, 10); }
function daysAgo(value, days) { const out = new Date(value); out.setUTCDate(out.getUTCDate() - days); return out; }
function listedCommonStock(row) {
  const symbol = String(row.symbol || '').trim();
  const name = String(row.name || '').trim();
  return /^\d{4}$/.test(symbol) && !symbol.startsWith('00') && !/^91/.test(symbol)
    && !/(ETF|ETN|指數|存託|-DR\b)/i.test(name);
}
function marketRow(row) {
  const close = Number(row.close || 0);
  return {
    ...row,
    market: 'TWSE', securityType: 'COMMON_STOCK', price: close,
    alteredTradingMethod: /[*＊]$/.test(String(row.name || '').trim()),
    bidPrice: Number(row.bid || close), askPrice: Number(row.ask || close),
    priceChangePct: close && Number.isFinite(Number(row.change)) ? Number(row.change) / (close - Number(row.change)) : 0,
    timestamp: `${row.tradeDate}T13:30:00+08:00`,
    provider: 'TWSE MCP MI_INDEX',
    metrics: { sourceTimestamp: `${row.tradeDate}T13:30:00+08:00`, marketDataSource: 'TWSE_MCP' }
  };
}

function balanceRatio(current, previous) {
  const base = Number(previous);
  return Number.isFinite(base) && base !== 0 ? (Number(current || 0) - base) / Math.abs(base) : null;
}

function attachChip(rows, institutionalRows = [], marginRows = []) {
  const institutions = new Map(institutionalRows.map(row => [String(row.symbol), row]));
  const margins = new Map(marginRows.map(row => [String(row.symbol), row]));
  return rows.map(row => {
    const institution = institutions.get(row.symbol) || {};
    const margin = margins.get(row.symbol) || {};
    const chipSignals = {
      source: 'TWSE MCP', tradeDate: row.tradeDate,
      institutional: {
        totalNet: institution.institutionalTotalNet,
        foreignNet: institution.foreignNet,
        trustNet: institution.investmentTrustNet,
        dealerNet: institution.dealerNet
      },
      marginChangeRatio: balanceRatio(margin.marginCurrentBalance, margin.marginPreviousBalance),
      shortChangeRatio: balanceRatio(margin.shortCurrentBalance, margin.shortPreviousBalance)
    };
    return { ...row, chipSignals, metrics: { ...row.metrics, chip: chipSignals, chipDataSource: 'TWSE_MCP' } };
  });
}

async function latestMarketSnapshot(now = new Date(), options = {}) {
  for (let offset = 0; offset <= 10; offset += 1) {
    const date = ymd(daysAgo(now, offset));
    const result = await (options.callTwse || callTwse)('twse_market_daily', { date }, options.twse || {});
    const rows = (result.rows || []).filter(listedCommonStock);
    if (rows.length) {
      const [institutional, margin] = await Promise.all([
        (options.callTwse || callTwse)('twse_institutional_daily', { date }, options.twse || {}).catch(() => ({ rows: [] })),
        (options.callTwse || callTwse)('twse_margin_daily', { date }, options.twse || {}).catch(() => ({ rows: [] }))
      ]);
      return { date, rows: attachChip(rows.map(marketRow), institutional.rows, margin.rows), source: 'TWSE_MCP', fetchedAt: new Date().toISOString() };
    }
  }
  throw new Error('TWSE MCP近10日沒有可用MI_INDEX資料');
}

function yahooQuote(symbol, result) {
  const row = (result.rows || []).at(-1);
  if (!row) return null;
  const price = Number(row.close || 0);
  if (!(price > 0) || !row.timestamp) return null;
  return { symbol, price, bidPrice: price, askPrice: price, timestamp: row.timestamp, provider: 'Yahoo Finance MCP', quoteFallbackUsed: true };
}

async function mcpLiveQuotes(symbols, options = {}) {
  let primary = { quotes: {} };
  try { primary = await (options.callLive || callLiveTool)('twse_live_quotes', { symbols }, options.twse || {}); } catch (error) { primary = { quotes: {}, error: String(error) }; }
  const quotes = { ...(primary.quotes || {}) };
  await Promise.all(symbols.filter(symbol => !quotes[symbol]?.timestamp).map(async symbol => {
    try {
      const result = await (options.callYahoo || callYahoo)('yahoo_chart', { symbol: `${symbol}.TW`, range: '1d', interval: '1m' }, options.yahoo || {});
      const quote = yahooQuote(symbol, result);
      if (quote) quotes[symbol] = quote;
    } catch (error) { /* missing quote remains blocked by freshness validation */ }
  }));
  return quotes;
}

module.exports = { attachChip, latestMarketSnapshot, listedCommonStock, marketRow, mcpLiveQuotes, yahooQuote };
