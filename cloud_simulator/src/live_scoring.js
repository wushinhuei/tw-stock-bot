'use strict';

const { CONFIG } = require('./config');
const { scoreCandidate } = require('./scoring');
const { fetchTechnicalBars } = require('./yahoo');

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
  const fetchBars = options.fetchBars || fetchTechnicalBars;
  const now = options.now || new Date();
  return mapWithConcurrency(candidates || [], options.concurrency || CONFIG.liveScoreConcurrency, async candidate => {
    try {
      const bars = await fetchBars(candidate.metrics?.sourceSymbol || candidate.symbol);
      if (!dataComplete(candidate.strategy, bars)) throw new Error('insufficient bars');
      const scored = scoreCandidate(scoringInput(candidate, bars, now));
      const eligibleData = scored.grade !== 'BLOCKED' && scored.blockedReasons.length === 0;
      const entryTier = eligibleData && scored.score >= CONFIG.scoreThresholds.A
        ? 'STANDARD'
        : eligibleData && scored.score >= CONFIG.trialScoreMin && scored.score < CONFIG.scoreThresholds.A
          && scored.components.technical >= CONFIG.trialMinTechnical
          && scored.components.volumeObv >= CONFIG.trialMinVolumeObv
          ? 'TRIAL' : 'NONE';
      return {
        ...candidate,
        ...scored,
        entryTier,
        dataStatus: 'COMPLETE',
        metrics: { ...candidate.metrics, ...scored.metrics, liveScoringProvider: bars.provider, liveScoredAt: now.toISOString() },
        scoringMethod: 'CLOUD_LIVE_V2'
      };
    } catch (error) {
      const blockedReasons = [...new Set([...(candidate.blockedReasons || []), '即時技術資料或OBV不足'])];
      return {
        ...candidate,
        grade: 'BLOCKED', entryTier: 'NONE', dataStatus: 'INCOMPLETE', blockedReasons,
        metrics: { ...candidate.metrics, liveScoredAt: now.toISOString(), liveScoringError: String(error) },
        scoringMethod: 'CLOUD_LIVE_V2'
      };
    }
  });
}

module.exports = { dataComplete, enrichCandidatesWithLiveScores, quoteIsFresh, scoringInput };
