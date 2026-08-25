'use strict';

const { CONFIG } = require('./config');
const { analyzeObv, atr, clamp, emaSeries, macd, rsi, sma, vwap } = require('./indicators');
const { scoreTaiwanMedia } = require('./news');
const { executionRiskReasons, scoreChipSignals } = require('./chip');

function gradeFor(score, blocked) {
  if (blocked) return 'BLOCKED';
  if (score >= CONFIG.scoreThresholds.A) return 'A';
  if (score >= CONFIG.scoreThresholds.B) return 'B';
  if (score >= CONFIG.scoreThresholds.C) return 'C';
  return 'BLOCKED';
}

function gradeWithMedia(total, totalWithoutMedia, blocked) {
  const grade = gradeFor(total, blocked);
  return grade === 'A' && totalWithoutMedia < CONFIG.scoreThresholds.A ? 'B' : grade;
}

function timeframeScore(bars, maxScore) {
  if (!Array.isArray(bars) || bars.length < 20) return { score: 0, reasons: ['技術資料不足'] };
  const closes = bars.map(row => Number(row.close));
  const current = closes[closes.length - 1];
  const ma20 = sma(closes, 20);
  const ma50 = sma(closes, 50);
  const ema9 = emaSeries(closes, 9).at(-1);
  const ema20 = emaSeries(closes, 20).at(-1);
  const momentum = macd(closes);
  const rsi14 = rsi(closes, 14);
  const currentAtr = atr(bars, 14);
  const currentVwap = vwap(bars.slice(-78));
  let points = 0;
  const reasons = [];
  if (ma20 && current > ma20) { points += 0.22; reasons.push('站上MA20'); }
  if (ma50 && current > ma50) { points += 0.18; reasons.push('站上MA50'); }
  if (ema9 && ema20 && ema9 >= ema20) { points += 0.15; reasons.push('EMA9高於EMA20'); }
  if (momentum.histogram != null && momentum.histogram >= 0) { points += 0.15; reasons.push('MACD動能偏多'); }
  if (rsi14 != null && rsi14 >= 50 && rsi14 <= 75) { points += 0.12; reasons.push('RSI位於多方區'); }
  if (currentVwap && current >= currentVwap) { points += 0.10; reasons.push('價格高於VWAP'); }
  if (currentAtr && currentAtr / current >= 0.006) { points += 0.08; reasons.push('波動足以覆蓋成本'); }
  return { score: Math.round(clamp(points, 0, 1) * maxScore), reasons, metrics: { ma20, ma50, ema9, ema20, rsi14, atr14: currentAtr, vwap: currentVwap, macdHistogram: momentum.histogram } };
}

function scoreCandidate(input) {
  const strategy = input.strategy || 'SWING';
  const fastBars = strategy === 'DAY_TRADE' ? input.bars5m : input.bars15m;
  const slowBars = strategy === 'SWING' ? input.weeklyBars : input.dailyBars;
  const fast = timeframeScore(fastBars || [], 18);
  const slow = timeframeScore(slowBars || input.dailyBars || [], 17);
  const dailyBars = input.dailyBars || [];
  const obv = analyzeObv(dailyBars, 42, 20);
  const volumes = dailyBars.map(row => Number(row.volume || 0));
  const volumeAverage = sma(volumes, 20);
  const latestVolume = volumes.at(-1) || 0;
  const volumeRatio = volumeAverage ? latestVolume / volumeAverage : 0;
  let volumeObv = 0;
  if (volumeRatio >= 1) volumeObv += 5;
  if (volumeRatio >= 1.5) volumeObv += 5;
  if (obv.aboveMa42) volumeObv += 4;
  if (obv.rising) volumeObv += 3;
  if (obv.breakoutConfirmed) volumeObv += 3;
  if (obv.topDivergence) volumeObv = Math.max(0, volumeObv - 5);

  const officialNewsBase = Math.round(clamp(input.officialNewsScore, 0, 1) * 15);
  const mediaNews = scoreTaiwanMedia(input.taiwanMediaItems, input.officialEventKeys, input.scoringTime ? new Date(input.scoringTime) : new Date());
  const chipResult = scoreChipSignals(input.chipSignals || input.metrics?.chip, input.chipScore);
  const components = {
    technical: clamp(fast.score + slow.score, 0, 35),
    volumeObv: clamp(volumeObv, 0, 20),
    chip: chipResult.score,
    fundamental: Math.round(clamp(input.fundamentalScore, 0, 1) * 10),
    officialNews: clamp(officialNewsBase + mediaNews.modifier, 0, 15),
    liquidity: Math.round(clamp(input.liquidityScore, 0, 1) * 5)
  };
  const total = Object.values(components).reduce((sum, value) => sum + value, 0);
  const blockedReasons = [...(input.blockedReasons || [])];
  if (!input.quoteFresh) blockedReasons.push('即時行情過期或缺漏');
  if (input.officialRiskBlocked) blockedReasons.push('官方重大風險尚未解除');
  if (Number(input.spreadPct || 0) > CONFIG.maxSpreadPct) blockedReasons.push('零股價差超標');
  blockedReasons.push(...executionRiskReasons(input));
  const totalWithoutMedia = total - components.officialNews + officialNewsBase;
  const grade = gradeWithMedia(total, totalWithoutMedia, blockedReasons.length > 0);
  return {
    score: total,
    grade,
    components,
    strategy,
    blockedReasons,
    technicalReasons: [...fast.reasons, ...slow.reasons],
    metrics: { ...fast.metrics, slow: slow.metrics, volumeRatio, obv, chip: { ...(input.chipSignals || input.metrics?.chip), scoring: chipResult.details }, mediaNews, officialNewsBase }
  };
}

module.exports = { gradeFor, gradeWithMedia, scoreCandidate, timeframeScore };
