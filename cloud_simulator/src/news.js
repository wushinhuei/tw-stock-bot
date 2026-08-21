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

module.exports = { classify, deduplicateNews, fetchInvestingRss, parseRss, scoreOfficialEvents };
