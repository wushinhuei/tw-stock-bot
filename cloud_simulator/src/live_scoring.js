'use strict';

const { CONFIG } = require('./config');
const { scoreCandidate } = require('./scoring');
const { callTool: callTwse } = require('./twse_mcp_history');
const { callTool: callYahoo } = require('./yahoo_mcp');
const { weeklyBars } = require('./yahoo');
const { MopsMcpHistory } = require('./mops_mcp_history');

const fundamentalCache = new Map();

function ymd(date) { return date.toISOString().slice(0, 10); }
function monthsBefore(date, months) {
  const value = new Date(date);
  value.setUTCMonth(value.getUTCMonth() - months);
  return ymd(value);
}

function ratio(current, previous) {
  const base = Number(previous);
  return Number.isFinite(base) && base !== 0 ? (Number(current || 0) - base) / Math.abs(base) : null;
}

function mcpChipSignals(rows, fallback = {}) {
  const latest = rows.at(-1);
  if (!latest) return fallback;
  return {
    ...fallback,
    source: 'TWSE MCP法人與信用交易',
    tradeDate: latest.trade_date,
    institutional: {
      totalNet: Number(latest.institutional_total_net || 0),
      foreignNet: Number(latest.foreign_net || 0),
      investmentTrustNet: Number(latest.investment_trust_net || 0),
      dealerNet: Number(latest.dealer_total_net || 0)
    },
    marginChangeRatio: ratio(latest.margin_current_balance, latest.margin_previous_balance),
    shortChangeRatio: ratio(latest.short_current_balance, latest.short_previous_balance),
    securitiesLendingChangeRatio: ratio(latest.sbl_current_balance, latest.sbl_previous_balance)
  };
}

async function fetchMcpTechnicalBars(candidate, options = {}) {
  const now = options.now || new Date();
  const symbol = String(candidate.metrics?.sourceSymbol || candidate.symbol).replace(/\.TW$/i, '');
  const start = monthsBefore(now, 18);
  const end = options.tradeDate || ymd(now);
  const yahoo = await (options.callYahoo || callYahoo)('yahoo_supplemental_history', { symbol: `${symbol}.TW`, dailyRange: '2y', intradayRange: '5d' }, options.yahoo || {});
  let official;
  try { official = await (options.callTwse || callTwse)('twse_stock_daily', { symbol, start, end }, options.twse || {}); }
  catch (error) { official = { rows: [] }; }
  const dailyBars = (official.rows || []).map(row => ({ ...row, timestamp: `${row.tradeDate}T00:00:00.000Z` }));
  const selectedDaily = dailyBars.length >= 50 ? dailyBars : (yahoo.dailyBars || []);
  return {
    bars5m: yahoo.bars5m || [], bars15m: yahoo.bars15m || [],
    dailyBars: selectedDaily,
    weeklyBars: weeklyBars(selectedDaily),
    chipSignals: candidate.metrics?.chip || {},
    provider: `${dailyBars.length >= 50 ? 'TWSE MCP日線' : 'Yahoo Finance MCP日線備援'} + Yahoo Finance MCP盤中K線`,
    sourceTimestamps: { fetchedAt: yahoo.fetchedAt || now.toISOString(), officialEnd: end }
  };
}

function fraction(value, maximum, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number > 1 ? number / maximum : number));
}

async function mopsFundamentalSummary(symbol, now = new Date(), options = {}) {
  const key = `${symbol}:${ymd(now)}`;
  if (fundamentalCache.has(key)) return fundamentalCache.get(key);
  const service = options.mopsService || new MopsMcpHistory(options.mops || {});
  const year = Number(ymd(now).slice(0, 4));
  try {
    const [revenue, financials] = await Promise.all([
      service.callTool('mops_monthly_revenue', { year, symbol, asOf: now.toISOString() }),
      service.callTool('mops_quarterly_financials', { year, symbol, asOf: now.toISOString() })
    ]);
    const revenueRows = revenue.structuredContent?.rows || [];
    const financialRows = financials.structuredContent?.rows || [];
    const factCount = new Set(financialRows.flatMap(row => (row.facts || []).map(fact => fact.metric))).size;
    const score = Math.min(1, (revenueRows.length ? 0.4 : 0) + Math.min(0.6, factCount / 8 * 0.6));
    const result = { score, missing: [...(!revenueRows.length ? ['monthly_revenue'] : []), ...(!financialRows.length ? ['quarterly_financials'] : [])], source: 'MOPS_MCP', fetchedAt: new Date().toISOString() };
    fundamentalCache.set(key, result);
    return result;
  } catch (error) {
    return { score: 0, missing: ['mops_summary'], source: 'MOPS_MCP', error: String(error.message || error), fetchedAt: new Date().toISOString() };
  }
}

function quoteIsFresh(candidate, now = new Date()) {
  const time = new Date(candidate.timestamp || candidate.metrics?.latestQuoteTime || 0).getTime();
  return Number.isFinite(time) && Math.abs(now.getTime() - time) <= CONFIG.quoteMaxAgeMs;
}

function scoringInput(candidate, bars, now = new Date()) {
  const spread = Number(candidate.askPrice) > 0 && Number(candidate.bidPrice) > 0
    ? (Number(candidate.askPrice) - Number(candidate.bidPrice)) / ((Number(candidate.askPrice) + Number(candidate.bidPrice)) / 2)
    : 1;
  return {
    ...candidate,
    bars5m: bars.bars5m,
    bars15m: bars.bars15m,
    dailyBars: bars.dailyBars,
    weeklyBars: bars.weeklyBars,
    quoteFresh: quoteIsFresh(candidate, now),
    spreadPct: spread,
    chipSignals: candidate.metrics?.chip,
    chipScore: fraction(candidate.components?.chip, 18, candidate.chipOk ? 1 : 0),
    fundamentalScore: fraction(candidate.components?.fundamental, 12, candidate.fundamentalOk ? 1 : 0),
    liquidityScore: spread <= CONFIG.maxSpreadPct ? 1 : 0,
    scoringTime: now.toISOString()
  };
}

function dataComplete(strategy, bars) {
  const fast = strategy === 'DAY_TRADE' ? bars.bars5m : bars.bars15m;
  const slow = strategy === 'SWING' ? bars.weeklyBars : bars.dailyBars;
  return bars.dailyBars.length >= 50 && fast.length >= 20 && slow.length >= 20;
}

async function mapWithConcurrency(rows, limit, mapper) {
  const output = new Array(rows.length);
  let cursor = 0;
  async function worker() {
    while (cursor < rows.length) {
      const index = cursor;
      cursor += 1;
      output[index] = await mapper(rows[index], index);
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, rows.length) }, worker));
  return output;
}

async function enrichCandidatesWithLiveScores(candidates, options = {}) {
  const now = options.now || new Date();
  const mopsService = options.mopsService || (options.fetchBars ? null : new MopsMcpHistory(options.mops || {}));
  const fetchBars = options.fetchBars || (candidate => fetchMcpTechnicalBars(candidate, { ...options, now }));
  return mapWithConcurrency(candidates || [], options.concurrency || CONFIG.liveScoreConcurrency, async candidate => {
    try {
      const bars = await fetchBars(candidate);
      if (!dataComplete(candidate.strategy, bars)) throw new Error('insufficient bars');
      const fundamental = options.fetchFundamental
        ? await options.fetchFundamental(candidate, now)
        : options.fetchBars
          ? { score: fraction(candidate.components?.fundamental, 12, candidate.fundamentalOk ? 1 : 0), missing: [], source: 'TEST_INJECTED', fetchedAt: now.toISOString() }
          : await mopsFundamentalSummary(candidate.symbol, now, { ...options, mopsService });
      const scored = scoreCandidate(scoringInput({
        ...candidate, fundamentalScore: fundamental.score,
        metrics: { ...candidate.metrics, chip: bars.chipSignals || candidate.metrics?.chip }
      }, bars, now));
      const eligibleData = scored.grade !== 'BLOCKED' && scored.blockedReasons.length === 0;
      const entryTier = eligibleData && scored.grade === 'A' ? 'STANDARD' : 'NONE';
      return {
        ...candidate,
        ...scored,
        entryTier,
        dataStatus: 'COMPLETE',
        metrics: {
          ...candidate.metrics, ...scored.metrics, liveScoringProvider: bars.provider,
          sourceTimestamps: { ...bars.sourceTimestamps, fundamental: fundamental.fetchedAt },
          fundamentalDataSource: fundamental.source, fundamentalMissing: fundamental.missing,
          liveScoredAt: now.toISOString()
        },
        scoringMethod: 'MCP_LIVE_LONG_ONLY_V2'
      };
    } catch (error) {
      const blockedReasons = [...new Set([...(candidate.blockedReasons || []), '即時技術資料或OBV不足'])];
      return {
        ...candidate,
        grade: 'BLOCKED', entryTier: 'NONE', dataStatus: 'INCOMPLETE', blockedReasons,
        metrics: { ...candidate.metrics, liveScoredAt: now.toISOString(), liveScoringError: String(error) },
        scoringMethod: 'MCP_LIVE_LONG_ONLY_V2'
      };
    }
  });
}

module.exports = { dataComplete, driveChipSignals: mcpChipSignals, enrichCandidatesWithLiveScores, fetchDriveTechnicalBars: fetchMcpTechnicalBars, fetchMcpTechnicalBars, mcpChipSignals, mopsFundamentalSummary, quoteIsFresh, scoringInput };
