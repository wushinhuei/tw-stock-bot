'use strict';

const { scoreOfficialEvents } = require('./news');

const POSITIVE_EVENT = /增資|擴產|新訂單|得標|獲利|成長|創新高|庫藏股|股利|合作|投資|量產|通過|核准|處分利益|取得訂單/i;
const NEGATIVE_EVENT = /虧損|減損|停工|違約|訴訟|裁罰|下修|撤銷|終止|跳票|資金貸與|背書保證|重大損失|火災|事故|資安/i;
const RISK_EVENT = /停止交易|暫停交易|處置|變更交易方法|重大不確定|重整|破產|退票/i;

function finite(value) {
  if (value == null || value === '') return null;
  const number = Number(String(value).replace(/,/g, '').replace(/%/g, ''));
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

function rawValue(row, patterns) {
  const raw = row?.raw || {};
  for (const [key, value] of Object.entries(raw)) {
    if (patterns.some(pattern => pattern.test(String(key)))) {
      const number = finite(value);
      if (number != null) return number;
    }
  }
  return null;
}

function financialFact(row, metric) {
  const facts = Array.isArray(row?.facts) ? row.facts.filter(item => item.metric === metric && Number.isFinite(Number(item.value))) : [];
  if (!facts.length) return null;
  const sorted = facts.slice().sort((a, b) => String(b.end_date || b.instant || '').localeCompare(String(a.end_date || a.instant || '')));
  return Number(sorted[0].value);
}

function explicitFundamentalScore(row) {
  const sources = [row, row?.mops?.monthlyRevenue, row?.mops?.quarterlyFinancials].filter(Boolean);
  for (const source of sources) {
    const direct = firstFinite(source, [
      'historicalFactors.fundamentalScore', 'fundamentalScore', 'fundamental_score',
      'score.fundamental', 'components.fundamental'
    ]);
    const normalized = normalizeFraction(direct, 10);
    if (normalized != null) return { score: normalized, source: 'EXPLICIT_HISTORICAL_SCORE', quality: 1 };

    const ok = firstBoolean(source, ['fundamentalOk', 'fundamental_ok', 'flags.fundamentalOk']);
    if (ok != null) return { score: ok ? 1 : 0, source: 'EXPLICIT_HISTORICAL_BOOLEAN', quality: 1 };
  }
  return null;
}

function reconstructFundamentalScore(row) {
  const revenue = row?.mops?.monthlyRevenue;
  const financial = row?.mops?.quarterlyFinancials;
  if (!revenue || !financial) return null;

  const yoy = rawValue(revenue, [/去年同月.*增減.*%/i, /年增率/i, /YoY/i, /去年同月比/i]);
  const revenueValue = rawValue(revenue, [/當月營收/i, /^營業收入$/i, /本月營收/i]);
  const netIncome = financialFact(financial, 'net_income');
  const operatingIncome = financialFact(financial, 'operating_income');
  const operatingCashFlow = financialFact(financial, 'operating_cash_flow');
  const assets = financialFact(financial, 'assets');
  const liabilities = financialFact(financial, 'liabilities');

  const evidence = [];
  let score = 0.50;
  let evidenceCount = 0;

  if (yoy != null) {
    evidenceCount += 1;
    if (yoy >= 20) score += 0.20;
    else if (yoy >= 10) score += 0.15;
    else if (yoy > 0) score += 0.08;
    else if (yoy <= -20) score -= 0.20;
    else if (yoy <= -10) score -= 0.15;
    else if (yoy < 0) score -= 0.08;
    evidence.push({ metric: 'monthlyRevenueYoYPct', value: yoy });
  } else if (revenueValue != null) {
    evidenceCount += 1;
    evidence.push({ metric: 'monthlyRevenue', value: revenueValue, neutralOnly: true });
  }

  for (const [metric, value, weight] of [
    ['netIncome', netIncome, 0.10],
    ['operatingIncome', operatingIncome, 0.08],
    ['operatingCashFlow', operatingCashFlow, 0.07]
  ]) {
    if (value == null) continue;
    evidenceCount += 1;
    score += value > 0 ? weight : value < 0 ? -weight : 0;
    evidence.push({ metric, value });
  }

  if (assets != null && liabilities != null && assets > 0) {
    evidenceCount += 1;
    const ratio = liabilities / assets;
    if (ratio <= 0.50) score += 0.05;
    else if (ratio >= 0.80) score -= 0.08;
    evidence.push({ metric: 'liabilitiesToAssets', value: ratio });
  }

  if (evidenceCount < 2) return null;
  return {
    score: Math.max(0, Math.min(1, Math.round(score * 1000) / 1000)),
    source: 'MOPS_POINT_IN_TIME_RECONSTRUCTION_V1',
    quality: 0.75,
    evidence
  };
}

function messageTitle(message) {
  const raw = message?.raw || {};
  return String(message?.title || message?.subject || raw['主旨'] || raw['重大訊息主旨'] || raw['說明'] || '').trim();
}

function normalizeOfficialEvent(message) {
  const publishedAt = String(
    message?.available_from || message?.availableAt || message?.publishedAt || message?.publish_time || ''
  ).replace(' ', 'T');
  let impact = String(message?.impact || message?.eventImpact || message?.event_impact || '').toUpperCase();
  let type = String(message?.type || message?.eventType || message?.event_type || '').toUpperCase();
  const title = messageTitle(message);

  let quality = 1;
  if (!['POSITIVE', 'NEGATIVE', 'NEUTRAL'].includes(impact) && !['SUSPENDED', 'DISPOSITION', 'MATERIAL_RISK_UNCLEAR'].includes(type)) {
    quality = 0.75;
    if (RISK_EVENT.test(title)) type = /處置/.test(title) ? 'DISPOSITION' : /停止交易|暫停交易/.test(title) ? 'SUSPENDED' : 'MATERIAL_RISK_UNCLEAR';
    if (POSITIVE_EVENT.test(title) && !NEGATIVE_EVENT.test(title)) impact = 'POSITIVE';
    else if (NEGATIVE_EVENT.test(title) && !POSITIVE_EVENT.test(title)) impact = 'NEGATIVE';
    else impact = 'NEUTRAL';
  }
  return { publishedAt, impact, type, title, reconstructionQuality: quality };
}

function explicitOfficialNewsScore(row, asOf) {
  const direct = firstFinite(row, [
    'historicalFactors.officialNewsScore', 'officialNewsScore', 'official_news_score',
    'score.officialNews', 'components.officialNews'
  ]);
  const normalized = normalizeFraction(direct, 15);
  if (normalized != null) return { score: normalized, source: 'EXPLICIT_HISTORICAL_SCORE', events: [], quality: 1 };

  const messages = Array.isArray(row?.mops?.majorMessages) ? row.mops.majorMessages : [];
  const classified = messages.map(normalizeOfficialEvent);
  const scored = scoreOfficialEvents(classified, new Date(asOf));
  const quality = classified.length ? Math.min(...classified.map(event => event.reconstructionQuality || 1)) : 1;
  return {
    score: scored.score,
    source: messages.length ? 'MOPS_POINT_IN_TIME_EVENT_RECONSTRUCTION_V1' : 'NO_OFFICIAL_EVENT_BASELINE',
    quality,
    events: classified,
    blocked: scored.blocked,
    blockedReasons: scored.blockedReasons,
    reasons: scored.reasons
  };
}

function materializeHistoricalFactors(row) {
  const asOf = row.pointInTimeAsOf || `${row.tradeDate}T08:59:59+08:00`;
  const fundamental = explicitFundamentalScore(row) || reconstructFundamentalScore(row);
  const official = explicitOfficialNewsScore(row, asOf);
  const complete = Boolean(fundamental && official);
  const quality = complete ? Math.min(fundamental.quality ?? 1, official.quality ?? 1) : 0;
  return {
    ...row,
    historicalFactors: {
      materializedAt: new Date().toISOString(),
      pointInTimeAsOf: asOf,
      complete,
      reconstructionQuality: quality,
      fundamentalScore: fundamental?.score ?? null,
      fundamentalSource: fundamental?.source || null,
      fundamentalEvidence: fundamental?.evidence || [],
      officialNewsScore: official?.score ?? null,
      officialNewsSource: official?.source || null,
      officialRiskBlocked: Boolean(official?.blocked),
      officialRiskReasons: official?.blockedReasons || [],
      officialEventReasons: official?.reasons || [],
      rule: 'Prefer explicit historical values. When absent, reconstruct only from MOPS records visible at the replay timestamp using the frozen V1 adapter; no future filings are read and Q2 outcomes are never inputs.'
    }
  };
}

module.exports = {
  explicitFundamentalScore,
  explicitOfficialNewsScore,
  materializeHistoricalFactors,
  normalizeFraction,
  normalizeOfficialEvent,
  reconstructFundamentalScore
};
