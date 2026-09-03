'use strict';

const HARD_RISK = /停止交易|暫停交易|處置|變更交易方法|重大不確定|重整|破產|退票|違約|重大損失|資安重大事件/i;
const POSITIVE_NEWS = /新訂單|重大訂單|取得.*訂單|得標|擴產|量產|上修|成長|創新高|投資|合作|需求強勁|市占|新品|認證|核准|營收.*增|獲利.*增/i;
const NEGATIVE_NEWS = /下修|衰退|虧損|減損|停工|違約|訴訟|裁罰|需求疲弱|砍單|庫存|重大損失/i;

const EVENT_RULES = [
  ['ORDER_DEMAND', /訂單|得標|客戶|需求|出貨|拉貨|接單|bookings?/i, 'MEDIUM_LONG'],
  ['CAPACITY_EXPANSION', /擴產|新廠|產能|量產|設備到位|投產|產線/i, 'LONG'],
  ['NEW_PRODUCT_TECH', /新品|新產品|新技術|AI|人工智慧|先進封裝|CoWoS|HBM|液冷|光通訊|機器人|認證|核准/i, 'LONG'],
  ['FINANCIAL_PERFORMANCE', /營收|獲利|毛利|EPS|財報|盈餘|淨利|現金流/i, 'MEDIUM_LONG'],
  ['PARTNERSHIP_INVESTMENT', /合作|策略聯盟|投資|入股|合資|併購|M&A/i, 'LONG'],
  ['GUIDANCE_OUTLOOK', /展望|上修|下修|財測|法說|預估|能見度/i, 'MEDIUM_LONG'],
  ['REGULATORY_CORPORATE', /重大訊息|董事會|股利|增資|減資|主管機關|裁罰|訴訟/i, 'MEDIUM'],
  ['RISK_EVENT', HARD_RISK, 'IMMEDIATE']
];

function num(value) {
  if (value == null || value === '') return null;
  const n = Number(String(value).replace(/,/g, '').replace(/%/g, ''));
  return Number.isFinite(n) ? n : null;
}
function rawValue(row, patterns) {
  for (const [key, value] of Object.entries(row?.raw || row || {})) {
    if (patterns.some(pattern => pattern.test(String(key)))) {
      const n = num(value);
      if (n != null) return n;
    }
  }
  return null;
}
function fact(row, metric) {
  const rows = Array.isArray(row?.facts) ? row.facts.filter(x => x.metric === metric && num(x.value) != null) : [];
  if (!rows.length) return null;
  rows.sort((a, b) => String(b.end_date || b.instant || '').localeCompare(String(a.end_date || a.instant || '')));
  return num(rows[0].value);
}
function symbolOf(row) {
  return String(row?.symbol || row?.stock_code || row?.companyCode || row?.raw?.['公司代號'] || '').trim();
}
function yoyOf(row) {
  return rawValue(row, [/去年同月.*增減.*%/i, /年增率/i, /YoY/i, /去年同月比/i]);
}
function monthOf(row) {
  return num(row?.month || row?.fiscal_month || row?.raw?.['資料年月'] || row?.raw?.['月份']);
}
function yearOf(row) {
  return num(row?.year || row?.fiscal_year || row?.raw?.['年度'] || row?.raw?.['年']);
}
function scoreFundamental(revenues, financial) {
  const sorted = (revenues || []).slice().sort((a,b) => (yearOf(b)*100 + monthOf(b)) - (yearOf(a)*100 + monthOf(a)));
  const latestYoy = yoyOf(sorted[0]);
  const prevYoy = yoyOf(sorted[1]);
  let revenueGrowth = latestYoy == null ? 0 : latestYoy >= 40 ? 25 : latestYoy >= 25 ? 22 : latestYoy >= 15 ? 18 : latestYoy >= 8 ? 13 : latestYoy > 0 ? 8 : latestYoy <= -20 ? -12 : latestYoy < 0 ? -6 : 0;
  let acceleration = 0;
  if (latestYoy != null && prevYoy != null) {
    const diff = latestYoy - prevYoy;
    acceleration = diff >= 15 ? 10 : diff >= 8 ? 7 : diff >= 3 ? 4 : diff <= -15 ? -8 : diff <= -8 ? -5 : 0;
  }
  const ni = fact(financial, 'net_income');
  const oi = fact(financial, 'operating_income');
  const ocf = fact(financial, 'operating_cash_flow');
  let quality = 0;
  for (const v of [ni, oi, ocf]) quality += v == null ? 0 : v > 0 ? 5 : v < 0 ? -5 : 0;
  const assets = fact(financial, 'assets');
  const liabilities = fact(financial, 'liabilities');
  let balance = 0;
  if (assets != null && liabilities != null && assets > 0) {
    const ratio = liabilities / assets;
    balance = ratio <= .4 ? 10 : ratio <= .55 ? 7 : ratio <= .7 ? 3 : ratio >= .85 ? -8 : 0;
  }
  return {
    score: Math.max(0, Math.min(60, Math.round(revenueGrowth + acceleration + quality + balance))),
    evidence: { latestRevenueYoYPct: latestYoy, previousRevenueYoYPct: prevYoy, netIncome: ni, operatingIncome: oi, operatingCashFlow: ocf, liabilitiesToAssets: assets && liabilities != null ? liabilities/assets : null }
  };
}

function classifyEvent(text) {
  for (const [category, pattern, horizon] of EVENT_RULES) {
    if (pattern.test(text)) return { category, horizon };
  }
  return { category: 'OTHER', horizon: 'UNKNOWN' };
}

function normalizeNewsItem(item) {
  const text = `${item?.title || ''} ${item?.summary || ''} ${item?.description || ''}`.trim();
  const classified = classifyEvent(text);
  const explicit = String(item?.sentiment || item?.impact || '').toUpperCase();
  const positive = explicit === 'POSITIVE' || (!explicit && POSITIVE_NEWS.test(text)) || POSITIVE_NEWS.test(text);
  const negative = explicit === 'NEGATIVE' || (!explicit && NEGATIVE_NEWS.test(text)) || NEGATIVE_NEWS.test(text);
  return {
    ...item,
    text,
    source: String(item?.source || item?.provider || 'UNKNOWN'),
    eventKey: String(item?.eventKey || item?.hash || item?.url || item?.title || ''),
    publishedAt: item?.publishedAt || item?.available_from || item?.availableAt || null,
    positive,
    negative,
    hardRisk: HARD_RISK.test(text),
    eventCategory: item?.eventCategory || classified.category,
    impactHorizon: item?.impactHorizon || classified.horizon
  };
}

function eventWeight(category, horizon) {
  let weight = 1;
  if (['ORDER_DEMAND', 'CAPACITY_EXPANSION', 'NEW_PRODUCT_TECH', 'GUIDANCE_OUTLOOK'].includes(category)) weight += 0.35;
  if (horizon === 'LONG' || horizon === 'MEDIUM_LONG') weight += 0.25;
  if (category === 'RISK_EVENT') weight = 1.5;
  return weight;
}

function scoreNews(items) {
  const normalized = (items || []).map(normalizeNewsItem);
  const groups = new Map();
  for (const item of normalized) {
    const key = item.eventKey;
    if (!key) continue;
    const arr = groups.get(key) || [];
    if (!arr.some(x => x.source === item.source)) arr.push(item);
    groups.set(key, arr);
  }
  let points = 0;
  const evidence = [];
  const uniqueSources = new Set();
  const categoryCounts = {};
  const horizonCounts = {};
  let verifiedEvents = 0;
  let hardRisk = false;
  for (const [eventKey, rows] of groups) {
    rows.forEach(r => uniqueSources.add(r.source));
    const official = rows.some(r => /MOPS|TWSE|官方/i.test(r.source));
    const verified = official || rows.length >= 2;
    const rowRisk = rows.some(r => r.hardRisk);
    if (rowRisk) hardRisk = true;
    const category = rows.find(r => r.eventCategory)?.eventCategory || 'OTHER';
    const horizon = rows.find(r => r.impactHorizon)?.impactHorizon || 'UNKNOWN';
    if (!verified) {
      evidence.push({ eventKey, verified: false, sources: rows.map(r=>r.source), category, horizon, reason: 'SINGLE_SOURCE_UNVERIFIED' });
      continue;
    }
    verifiedEvents += 1;
    categoryCounts[category] = (categoryCounts[category] || 0) + 1;
    horizonCounts[horizon] = (horizonCounts[horizon] || 0) + 1;
    const pos = rows.filter(r=>r.positive && !r.negative).length;
    const neg = rows.filter(r=>r.negative && !r.positive).length;
    const weight = eventWeight(category, horizon);
    const rawDelta = rowRisk ? -15 : pos > neg ? Math.min(6, 2 + rows.length) : neg > pos ? -Math.min(8, 3 + rows.length) : 0;
    const delta = Math.round(rawDelta * weight);
    points += delta;
    evidence.push({
      eventKey,
      title: rows.find(r => r.title)?.title || null,
      verified: true,
      official,
      sources: rows.map(r=>r.source),
      category,
      horizon,
      sentiment: rowRisk ? 'NEGATIVE' : pos > neg ? 'POSITIVE' : neg > pos ? 'NEGATIVE' : 'NEUTRAL',
      delta
    });
  }
  return {
    score: Math.max(0, Math.min(30, 15 + points)),
    verifiedEvents,
    uniqueSourceCount: uniqueSources.size,
    hardRisk,
    categoryCounts,
    horizonCounts,
    evidence
  };
}

function confidenceScore(fundamental, news) {
  let score = 35;
  const e = fundamental.evidence || {};
  if (e.latestRevenueYoYPct != null) score += 20;
  if (e.previousRevenueYoYPct != null) score += 10;
  if (e.netIncome != null && e.operatingIncome != null) score += 15;
  if (e.operatingCashFlow != null) score += 5;
  score += Math.min(15, news.verifiedEvents * 5);
  return Math.max(0, Math.min(100, score));
}

function longTermProfile(fundamental, news) {
  const longEvents = (news.horizonCounts?.LONG || 0) + (news.horizonCounts?.MEDIUM_LONG || 0);
  let score = Math.round(fundamental.score * 0.75 + news.score * 0.55 + Math.min(15, longEvents * 4));
  score = Math.max(0, Math.min(100, score));
  const grade = news.hardRisk ? 'RISK' : score >= 70 ? 'A' : score >= 55 ? 'B' : 'C';
  const horizon = longEvents >= 2 ? '6-24M' : longEvents === 1 ? '3-12M' : 'WATCH';
  return { score, grade, horizon };
}

function rankGrowthCandidates({ monthlyRevenue = [], quarterlyFinancials = [], news = [], officialEvents = [], limit = 10 } = {}) {
  const revenuesBySymbol = new Map();
  for (const row of monthlyRevenue) {
    const symbol = symbolOf(row); if (!/^\d{4}$/.test(symbol)) continue;
    const arr = revenuesBySymbol.get(symbol) || []; arr.push(row); revenuesBySymbol.set(symbol, arr);
  }
  const financialBySymbol = new Map();
  for (const row of quarterlyFinancials) { const s = symbolOf(row); if (/^\d{4}$/.test(s)) financialBySymbol.set(s, row); }
  const newsBySymbol = new Map();
  for (const item of [...news, ...officialEvents]) {
    const symbols = Array.isArray(item?.relatedSymbols) ? item.relatedSymbols : (String(item?.symbol || '').match(/\d{4}/g) || []);
    for (const s of symbols.map(String)) { const arr = newsBySymbol.get(s) || []; arr.push(item); newsBySymbol.set(s, arr); }
  }
  const candidates = [];
  for (const [symbol, revenues] of revenuesBySymbol) {
    const fundamental = scoreFundamental(revenues, financialBySymbol.get(symbol));
    const newsScore = scoreNews(newsBySymbol.get(symbol) || []);
    const confidence = confidenceScore(fundamental, newsScore);
    const growthTheme = newsScore.verifiedEvents > 0 ? Math.min(10, newsScore.verifiedEvents * 2) : 0;
    const longTerm = longTermProfile(fundamental, newsScore);
    let total = Math.max(0, Math.min(100, fundamental.score + newsScore.score + growthTheme));
    if (newsScore.hardRisk) total = Math.min(total, 45);
    candidates.push({
      symbol,
      score: Math.round(total),
      confidence,
      fundamentalScore: fundamental.score,
      newsScore: newsScore.score,
      growthThemeScore: growthTheme,
      verifiedNewsEvents: newsScore.verifiedEvents,
      newsSourceCount: newsScore.uniqueSourceCount,
      eventCategoryCounts: newsScore.categoryCounts,
      impactHorizonCounts: newsScore.horizonCounts,
      longTermLayoutScore: longTerm.score,
      longTermLayoutGrade: longTerm.grade,
      suggestedHoldingHorizon: longTerm.horizon,
      hardRisk: newsScore.hardRisk,
      evidence: { fundamentals: fundamental.evidence, news: newsScore.evidence },
      label: total >= 80 && confidence >= 70 ? 'HIGH_GROWTH_WATCH' : total >= 65 ? 'GROWTH_WATCH' : 'WATCH',
      disclaimer: 'Ranking is evidence-based screening for research and medium/long-term layout consideration, not a buy signal or guaranteed return.'
    });
  }
  return candidates.sort((a,b) => b.score-a.score || b.longTermLayoutScore-a.longTermLayoutScore || b.confidence-a.confidence || a.symbol.localeCompare(b.symbol)).slice(0, Math.max(1, Number(limit)||10));
}

module.exports = { classifyEvent, confidenceScore, longTermProfile, normalizeNewsItem, rankGrowthCandidates, scoreFundamental, scoreNews };
