'use strict';

const { scoreOfficialEvents } = require('./news');

function finite(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function firstFinite(row, paths) {
  for (const path of paths) {
    const value = path.split('.').reduce((obj, key) => obj?.[key], row);
    const number = finite(value);
    if (number != null) return number;
  }
  return null;
}

function firstBoolean(row, paths) {
  for (const path of paths) {
    const value = path.split('.').reduce((obj, key) => obj?.[key], row);
    if (value === true || value === false) return value;
    if (String(value).toLowerCase() === 'true') return true;
    if (String(value).toLowerCase() === 'false') return false;
  }
  return null;
}

function normalizeFraction(value, maxPoints) {
  const number = finite(value);
  if (number == null) return null;
  if (number >= 0 && number <= 1) return number;
  if (number >= 0 && number <= maxPoints) return number / maxPoints;
  return null;
}

function explicitFundamentalScore(row) {
  const sources = [row, row?.mops?.monthlyRevenue, row?.mops?.quarterlyFinancials].filter(Boolean);
  for (const source of sources) {
    const direct = firstFinite(source, [
      'historicalFactors.fundamentalScore', 'fundamentalScore', 'fundamental_score',
      'score.fundamental', 'components.fundamental'
    ]);
    const normalized = normalizeFraction(direct, 10);
    if (normalized != null) return { score: normalized, source: 'EXPLICIT_HISTORICAL_SCORE' };

    const ok = firstBoolean(source, ['fundamentalOk', 'fundamental_ok', 'flags.fundamentalOk']);
    if (ok != null) return { score: ok ? 1 : 0, source: 'EXPLICIT_HISTORICAL_BOOLEAN' };
  }
  return null;
}

function normalizeOfficialEvent(message) {
  const publishedAt = String(
    message?.available_from || message?.availableAt || message?.publishedAt || message?.publish_time || ''
  ).replace(' ', 'T');
  const impact = String(message?.impact || message?.eventImpact || message?.event_impact || '').toUpperCase();
  const type = String(message?.type || message?.eventType || message?.event_type || '').toUpperCase();
  const raw = message?.raw || {};
  const title = String(
    message?.title || message?.subject || raw['主旨'] || raw['重大訊息主旨'] || raw['說明'] || ''
  ).trim();
  const hasClassification = ['POSITIVE', 'NEGATIVE', 'NEUTRAL'].includes(impact)
    || ['SUSPENDED', 'DISPOSITION', 'MATERIAL_RISK_UNCLEAR'].includes(type);
  if (!hasClassification) return null;
  return { publishedAt, impact, type, title };
}

function explicitOfficialNewsScore(row, asOf) {
  const direct = firstFinite(row, [
    'historicalFactors.officialNewsScore', 'officialNewsScore', 'official_news_score',
    'score.officialNews', 'components.officialNews'
  ]);
  const normalized = normalizeFraction(direct, 15);
  if (normalized != null) return { score: normalized, source: 'EXPLICIT_HISTORICAL_SCORE', events: [] };

  const messages = Array.isArray(row?.mops?.majorMessages) ? row.mops.majorMessages : [];
  const classified = messages.map(normalizeOfficialEvent).filter(Boolean);
  const unclassifiedCount = messages.length - classified.length;
  if (unclassifiedCount > 0) return null;
  const scored = scoreOfficialEvents(classified, new Date(asOf));
  return {
    score: scored.score,
    source: messages.length ? 'MOPS_CLASSIFIED_OFFICIAL_EVENTS' : 'NO_OFFICIAL_EVENT_BASELINE',
    events: classified,
    blocked: scored.blocked,
    blockedReasons: scored.blockedReasons,
    reasons: scored.reasons
  };
}

function materializeHistoricalFactors(row) {
  const asOf = row.pointInTimeAsOf || `${row.tradeDate}T08:59:59+08:00`;
  const fundamental = explicitFundamentalScore(row);
  const official = explicitOfficialNewsScore(row, asOf);
  const complete = Boolean(fundamental && official);
  return {
    ...row,
    historicalFactors: {
      materializedAt: new Date().toISOString(),
      pointInTimeAsOf: asOf,
      complete,
      fundamentalScore: fundamental?.score ?? null,
      fundamentalSource: fundamental?.source || null,
      officialNewsScore: official?.score ?? null,
      officialNewsSource: official?.source || null,
      officialRiskBlocked: Boolean(official?.blocked),
      officialRiskReasons: official?.blockedReasons || [],
      officialEventReasons: official?.reasons || [],
      rule: 'Only explicit historical score/boolean fields or already-classified official events may be materialized. Missing semantics are blocked, never inferred from future data or guessed.'
    }
  };
}

module.exports = {
  explicitFundamentalScore,
  explicitOfficialNewsScore,
  materializeHistoricalFactors,
  normalizeFraction,
  normalizeOfficialEvent
};
