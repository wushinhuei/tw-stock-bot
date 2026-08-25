'use strict';

const { CONFIG } = require('./config');
const { clamp } = require('./indicators');
const { executionRiskReasons, scoreChipSignals } = require('./chip');

function latestScenario(payload) {
  const rows = Array.isArray(payload && payload.scenario) ? payload.scenario : [];
  return rows.length ? rows[rows.length - 1] : null;
}

function strategyFor(candidate, time = '09:10') {
  if (candidate.dayTradeOk && time <= CONFIG.dayTradeEntryCutoff) return 'DAY_TRADE';
  if (candidate.overnightOk && time >= CONFIG.overnightEntryStart) return 'OVERNIGHT';
  return 'SWING';
}

function legacyComponents(candidate) {
  const metrics = candidate.metrics || {};
  const price = Number(candidate.price || 0);
  let technical = 0;
  if (candidate.trendOk) technical += 15;
  if (candidate.momentumOk) technical += 10;
  if (price && Number(metrics.ma20) && price >= Number(metrics.ma20)) technical += 5;
  if (price && Number(metrics.ma50) && price >= Number(metrics.ma50)) technical += 5;

  let volumeObv = candidate.volumePriceOk ? 10 : 0;
  if (Number(metrics.volumeRatio || 0) >= 1) volumeObv += 3;
  if (Number(metrics.volumeRatio || 0) >= 1.5) volumeObv += 2;
  if (metrics.obv && metrics.obv.aboveMa42) volumeObv += 3;
  if (metrics.obv && metrics.obv.rising) volumeObv += 2;

  const chipMetrics = metrics.chip || {};
  const chip = scoreChipSignals(chipMetrics, candidate.chipOk ? 1 : 0).score;
  const spread = Number(metrics.spreadPct ?? candidate.executionPlan?.spreadPct ?? 1);
  return {
    technical: clamp(technical, 0, 35), volumeObv: clamp(volumeObv, 0, 20),
    chip: clamp(chip, 0, 15), fundamental: candidate.fundamentalOk ? 10 : 0,
    officialNews: 8, liquidity: spread <= CONFIG.maxSpreadPct ? 5 : 0
  };
}

function adaptCandidate(candidate, context = {}) {
  const components = candidate.components || legacyComponents(candidate);
  const score = Object.values(components).reduce((sum, value) => sum + Number(value || 0), 0);
  const blockedReasons = [...(candidate.blockedReasons || [])];
  const quoteTime = candidate.metrics && candidate.metrics.latestQuoteTime;
  if (!candidate.bidPrice || !candidate.askPrice) blockedReasons.push('缺少零股買一或賣一價');
  if (Number(candidate.metrics?.spreadPct ?? candidate.executionPlan?.spreadPct ?? 0) > CONFIG.maxSpreadPct) blockedReasons.push('零股價差超標');
  blockedReasons.push(...executionRiskReasons({ ...candidate, chipSignals: candidate.metrics?.chip }));
  const grade = blockedReasons.length ? 'BLOCKED' : score >= 80 ? 'A' : score >= 65 ? 'B' : score >= 50 ? 'C' : 'BLOCKED';
  return {
    ...candidate, score, grade, components, blockedReasons,
    strategy: candidate.strategy || strategyFor(candidate, context.time),
    quoteFresh: Boolean(quoteTime),
    sourceGrade: candidate.grade,
    scoringMethod: candidate.components ? 'CLOUD_NATIVE' : 'APPS_SCRIPT_ADAPTER_V1'
  };
}

function adaptCandidatePayload(payload, context = {}) {
  if (Array.isArray(payload && payload.volumeRows)) return { mode: 'VOLUME_ROWS', candidates: null };
  const scenario = latestScenario(payload);
  const source = scenario || payload || {};
  const rows = Array.isArray(source.candidates) ? source.candidates : [];
  return {
    mode: scenario ? 'APPS_SCRIPT_SCENARIO' : 'ROOT_CANDIDATES',
    generatedAt: payload.generatedAt || source.generatedAt,
    date: source.date,
    candidates: rows
      .filter(row => !row.metrics?.volumeRank || Number(row.metrics.volumeRank) <= CONFIG.topVolumeLimit)
      .slice(0, CONFIG.maxCandidates)
      .map(row => adaptCandidate(row, context))
  };
}

module.exports = { adaptCandidate, adaptCandidatePayload, latestScenario, legacyComponents, strategyFor };
