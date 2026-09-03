'use strict';

const crypto = require('node:crypto');

const TOPICS = [
  ['AI設備', /\b(ai|artificial intelligence|data cent(?:er|re)|cloud|server|nvidia|gpu)\b/i],
  ['半導體', /\b(chip|semiconductor|foundry|wafer|tsmc|nvidia|amd|micron|export control)\b/i],
  ['電力', /\b(power|grid|electricity|energy|copper|transformer|renewable)\b/i],
  ['機器人', /\b(robot|robotics|automation|machine vision|industrial automation)\b/i]
];
const HIGH = /war|invasion|sanction|tariff|export ban|emergency|default|recession|rate hike|cyberattack|earthquake/i;
const NEGATIVE = /fall|drop|cut|ban|loss|risk|warning|weak|slump|layoff|probe|lawsuit|shortage/i;
const POSITIVE = /rise|gain|growth|beat|upgrade|record|expand|order|investment|recovery|surge/i;
const GLOBAL_MAJOR = /war|invasion|military|missile|sanction|tariff|export ban|export control|emergency|default|recession|rate hike|rate cut|fed|central bank|oil shock|energy crisis|cyberattack|earthquake|tsunami|pandemic|strait|geopolitic/i;

const TAIWAN_MEDIA_SOURCES = Object.freeze({
  '中央通訊社': { weight: 1.00, automatedMethods: ['RSS', 'LICENSED_API'], rss: 'https://feeds.feedburner.com/rsscna/finance' },
  '經濟日報': { weight: 0.90, automatedMethods: ['LICENSED_API'] },
  '工商時報': { weight: 0.90, automatedMethods: ['LICENSED_API'] },
  'MoneyDJ': { weight: 0.85, automatedMethods: ['LICENSED_API'] },
  'DIGITIMES': { weight: 0.95, automatedMethods: ['LICENSED_API'] }
});

function decodeXml(value) {
  return String(value || '')
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
}

function tag(block, name) {
  const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/${name}>`, 'i'));
  return match ? decodeXml(match[1]) : '';
}

function classify(text) {
  const relatedIndustries = TOPICS.filter(([, pattern]) => pattern.test(text)).map(([name]) => name);
  const negative = NEGATIVE.test(text);
  const positive = POSITIVE.test(text);
  return {
    category: relatedIndustries[0] || (/oil|gold|copper|commodity/i.test(text) ? '原物料' : /fed|inflation|rate|bond|dollar/i.test(text) ? '總體經濟' : '全球市場'),
    relatedIndustries,
    riskLevel: HIGH.test(text) ? 'HIGH' : relatedIndustries.length ? 'MEDIUM' : 'LOW',
    sentiment: negative && !positive ? 'NEGATIVE' : positive && !negative ? 'POSITIVE' : negative && positive ? 'UNCERTAIN' : 'NEUTRAL'
  };
}

function normalizeSymbols(value) {
  const input = Array.isArray(value) ? value : value == null ? [] : [value];
  return [...new Set(input.flatMap(item => String(item || '').match(/\b\d{4}\b/g) || []))];
}

function isMajorInternationalEvent(item) {
  const scope = String(item?.marketScope || item?.scope || '').toUpperCase();
  const category = String(item?.category || '');
  const riskLevel = String(item?.riskLevel || item?.impact || '').toUpperCase();
  const text = `${item?.title || ''} ${item?.summary || ''} ${item?.description || ''}`;
  const explicitlyGlobal = ['GLOBAL', 'INTERNATIONAL', 'MACRO'].includes(scope) || /全球市場|總體經濟|國際/.test(category);
  return (riskLevel === 'HIGH' && (explicitlyGlobal || GLOBAL_MAJOR.test(text)))
    || (explicitlyGlobal && GLOBAL_MAJOR.test(text));
}

function newsScopeDecision(item) {
  const top100Related = item?.top100Related === true || item?.inTop100 === true || item?.poolRelevant === true;
  const globalMajor = isMajorInternationalEvent(item);
  return {
    eligible: top100Related || globalMajor,
    top100Related,
    globalMajor,
    relatedSymbols: normalizeSymbols(item?.relatedSymbols || item?.symbols || item?.stockCodes),
    reason: top100Related ? 'TOP100_RELATED' : globalMajor ? 'GLOBAL_MAJOR_EVENT' : 'OUTSIDE_TOP100_AND_NOT_GLOBAL_MAJOR'
  };
}

function scopeNewsItems(items) {
  return (items || []).map(item => ({ item, scope: newsScopeDecision(item) })).filter(row => row.scope.eligible);
}

function parseRss(xml, source = 'Investing.com') {
  const blocks = String(xml || '').match(/<item(?:\s[^>]*)?>[\s\S]*?<\/item>/gi) || [];
  return blocks.map(block => {
    const title = tag(block, 'title');
    const summary = tag(block, 'description').slice(0, 500);
    const url = tag(block, 'link') || tag(block, 'guid');
    const publishedAt = new Date(tag(block, 'pubDate') || 0).toISOString();
    const classification = classify(`${title} ${summary}`);
    return {
      source, title, summary, publishedAt, fetchedAt: new Date().toISOString(), url,
      hash: crypto.createHash('sha256').update(`${url}|${title}|${publishedAt}`).digest('hex'),
      ...classification,
      advisoryOnly: true
    };
  }).filter(item => item.title && item.url);
}

function deduplicateNews(items) {
  const seen = new Set();
  return (items || []).filter(item => {
    const key = item.hash || `${item.url}|${item.title}|${item.publishedAt}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function scoreOfficialEvents(events, now = new Date()) {
  let score = 0.5;
  const blockedReasons = [];
  const reasons = [];
  for (const event of events || []) {
    const published = new Date(event.publishedAt || 0);
    if (published > now) continue;
    const type = String(event.type || '').toUpperCase();
    const impact = String(event.impact || '').toUpperCase();
    if (['SUSPENDED', 'DISPOSITION', 'MATERIAL_RISK_UNCLEAR'].includes(type)) blockedReasons.push(event.title || type);
    if (impact === 'POSITIVE') { score += 0.12; reasons.push(event.title || '官方正面事件'); }
    if (impact === 'NEGATIVE') { score -= 0.18; reasons.push(event.title || '官方負面事件'); }
  }
  return { score: Math.max(0, Math.min(1, score)), blocked: blockedReasons.length > 0, blockedReasons, reasons };
}

function validateTaiwanMediaItem(item) {
  const source = TAIWAN_MEDIA_SOURCES[item && item.source];
  if (!source) return { accepted: false, reason: '非核准台灣財經媒體' };
  const method = String(item.acquisitionMethod || 'MANUAL').toUpperCase();
  if (method !== 'MANUAL' && !source.automatedMethods.includes(method)) {
    return { accepted: false, reason: '來源未提供可自動使用的RSS或授權介面' };
  }
  if (!item.title || !item.url || !item.publishedAt || !item.eventKey) {
    return { accepted: false, reason: '缺少標題、網址、時間或事件識別碼' };
  }
  return { accepted: true, weight: source.weight, method };
}

function scoreTaiwanMedia(items, officialEventKeys = [], now = new Date()) {
  const scoped = scopeNewsItems(items);
  const suppressed = (items || []).filter(item => !newsScopeDecision(item).eligible);
  const accepted = scoped.map(row => row.item).filter(item => {
    const check = validateTaiwanMediaItem(item);
    return check.accepted && new Date(item.publishedAt) <= now;
  });
  const groups = new Map();
  for (const item of accepted) {
    const rows = groups.get(item.eventKey) || [];
    if (!rows.some(row => row.source === item.source)) rows.push(item);
    groups.set(item.eventKey, rows);
  }
  let modifier = 0;
  const evidence = suppressed.map(item => ({
    eventKey: item.eventKey || null,
    sources: item.source ? [item.source] : [],
    scored: false,
    reason: '非Top100相關新聞且非國際重大事件，忽略'
  }));
  for (const [eventKey, rows] of groups.entries()) {
    const officialConfirmed = officialEventKeys.includes(eventKey);
    const corroborated = officialConfirmed || rows.length >= 2;
    if (!corroborated) {
      evidence.push({ eventKey, sources: rows.map(row => row.source), scored: false, reason: '僅單一媒體，列提示不計分' });
      continue;
    }
    const averageWeight = rows.reduce((sum, row) => sum + TAIWAN_MEDIA_SOURCES[row.source].weight, 0) / rows.length;
    const sentiments = rows.map(row => String(row.sentiment || 'NEUTRAL').toUpperCase());
    const positive = sentiments.filter(value => value === 'POSITIVE').length;
    const negative = sentiments.filter(value => value === 'NEGATIVE').length;
    const impact = rows.some(row => String(row.impact || '').toUpperCase() === 'HIGH' || isMajorInternationalEvent(row)) ? 1.5 : 1;
    const delta = positive > negative ? averageWeight * impact : negative > positive ? -averageWeight * impact : 0;
    modifier += delta;
    evidence.push({
      eventKey,
      sources: rows.map(row => row.source),
      scored: true,
      scope: rows.some(isMajorInternationalEvent) ? 'GLOBAL_MAJOR_EVENT' : 'TOP100_RELATED',
      delta: Math.round(delta * 100) / 100
    });
  }
  return {
    modifier: Math.max(-3, Math.min(3, Math.round(modifier))),
    evidence,
    acceptedCount: accepted.length,
    suppressedCount: suppressed.length,
    policy: 'TOP100_RELATED_OR_GLOBAL_MAJOR_ONLY'
  };
}

async function fetchInvestingRss(urls, fetchImpl = fetch) {
  const results = await Promise.allSettled((urls || []).map(async url => {
    const response = await fetchImpl(url, { headers: { 'User-Agent': 'tw-stock-simulation-rss-reader/1.0' } });
    if (!response.ok) throw new Error(`RSS ${response.status}: ${url}`);
    return parseRss(await response.text());
  }));
  return {
    items: deduplicateNews(results.flatMap(result => result.status === 'fulfilled' ? result.value : [])),
    errors: results.filter(result => result.status === 'rejected').map(result => String(result.reason))
  };
}

async function fetchTaiwanMediaRss(sources, fetchImpl = fetch) {
  const results = await Promise.allSettled((sources || []).map(async source => {
    const response = await fetchImpl(source.url, { headers: { 'User-Agent': 'tw-stock-simulation-rss-reader/1.0' } });
    if (!response.ok) throw new Error(`RSS ${response.status}: ${source.url}`);
    return parseRss(await response.text(), source.source).map(item => ({ ...item, acquisitionMethod: source.acquisitionMethod || 'RSS', advisoryOnly: false }));
  }));
  return {
    items: deduplicateNews(results.flatMap(result => result.status === 'fulfilled' ? result.value : [])),
    errors: results.filter(result => result.status === 'rejected').map(result => String(result.reason))
  };
}

module.exports = {
  TAIWAN_MEDIA_SOURCES, classify, deduplicateNews, fetchInvestingRss, fetchTaiwanMediaRss,
  isMajorInternationalEvent, newsScopeDecision, normalizeSymbols, parseRss,
  scopeNewsItems, scoreOfficialEvents, scoreTaiwanMedia, validateTaiwanMediaItem
};
