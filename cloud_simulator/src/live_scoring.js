'use strict';

const { CONFIG } = require('./config');
const { scoreCandidate } = require('./scoring');
const { DriveHistorySource } = require('./drive_history');
const { fetchIntradayBars, weeklyBars } = require('./yahoo');

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

function driveChipSignals(rows, fallback = {}) {
  const latest = rows.at(-1);
  if (!latest) return fallback;
  return {
    ...fallback,
    source: 'Google Drive TWSE每日籌碼',
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

async function fetchDriveTechnicalBars(candidate, options) {
  const now = options.now || new Date();
  const source = options.driveSource;
  const symbol = String(candidate.metrics?.sourceSymbol || candidate.symbol).replace(/\.TW$/i, '');
  const start = monthsBefore(now, 18);
  const [intraday, dailyBars, marketFlow] = await Promise.all([
    (options.fetchIntradayBars || fetchIntradayBars)(candidate.metrics?.sourceSymbol || candidate.symbol),
    source.adjustedDailyBars(symbol, start, options.driveTradeDate),
    source.marketFlowRows(symbol, start, options.driveTradeDate)
  ]);
  return {
    ...intraday,
    dailyBars,
    weeklyBars: weeklyBars(dailyBars),
    chipSignals: driveChipSignals(marketFlow, candidate.metrics?.chip),
    provider: `${intraday.provider} + Google Drive TWSE日線`,
    driveTradeDate: options.driveTradeDate
  };
}

function fraction(value, maximum, fallback = 0) {
  const number = Number(value);
  if (!Number.isFinite(number)) return fallback;
  return Math.max(0, Math.min(1, number > 1 ? number / maximum : number));
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
    chipScore: fraction(candidate.components?.chip, 15, candidate.chipOk ? 1 : 0),
    fundamentalScore: fraction(candidate.components?.fundamental, 10, candidate.fundamentalOk ? 1 : 0),
    officialNewsScore: fraction(candidate.components?.officialNews, 15, 8 / 15),
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
  const driveSource = options.driveSource || (options.fetchBars ? null : new DriveHistorySource());
  const driveStatus = options.driveStatus || (driveSource ? await driveSource.analysisStatus() : { tradeDate: null });
  const fetchBars = options.fetchBars || (candidate => fetchDriveTechnicalBars(candidate, {
    ...options, now, driveSource, driveTradeDate: driveStatus.tradeDate
  }));
  return mapWithConcurrency(candidates || [], options.concurrency || CONFIG.liveScoreConcurrency, async candidate => {
    try {
      const bars = await fetchBars(candidate);
      if (!dataComplete(candidate.strategy, bars)) throw new Error('insufficient bars');
      const scored = scoreCandidate(scoringInput({
        ...candidate, metrics: { ...candidate.metrics, chip: bars.chipSignals || candidate.metrics?.chip }
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
          driveTradeDate: bars.driveTradeDate || driveStatus.tradeDate, liveScoredAt: now.toISOString()
        },
        scoringMethod: 'CLOUD_DRIVE_LONG_ONLY_V1'
      };
    } catch (error) {
      const blockedReasons = [...new Set([...(candidate.blockedReasons || []), '即時技術資料或OBV不足'])];
      return {
        ...candidate,
        grade: 'BLOCKED', entryTier: 'NONE', dataStatus: 'INCOMPLETE', blockedReasons,
        metrics: { ...candidate.metrics, liveScoredAt: now.toISOString(), liveScoringError: String(error) },
        scoringMethod: 'CLOUD_DRIVE_LONG_ONLY_V1'
      };
    }
  });
}

module.exports = { dataComplete, driveChipSignals, enrichCandidatesWithLiveScores, fetchDriveTechnicalBars, quoteIsFresh, scoringInput };
