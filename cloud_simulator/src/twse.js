'use strict';

const { liveQuotes, twsePrimary } = require('./data_source_policy');

async function fetchQuotes(symbols) {
  return liveQuotes(symbols);
}

async function fetchTopVolume(dateCompact, limit = 50) {
  const date = `${dateCompact.slice(0, 4)}-${dateCompact.slice(4, 6)}-${dateCompact.slice(6, 8)}`;
  const result = await twsePrimary('twse_market_daily', { date });
  return (result.rows || [])
    .filter(row => /^\d{4}$/.test(String(row.symbol || '')) && Number(row.volume) > 0)
    .sort((a, b) => Number(b.volume) - Number(a.volume))
    .slice(0, limit)
    .map(row => ({ symbol: row.symbol, name: row.name, volume: Number(row.volume || 0), provider: result.dataSource || 'TWSE_MCP' }));
}

module.exports = { fetchQuotes, fetchTopVolume };
