'use strict';

const { MopsMcpHistory } = require('../src/mops_mcp_history');
const { TaiwanNewsMcp } = require('../src/taiwan_news_mcp');
const { DrivePrimaryWriter } = require('../src/drive_primary_writer');
const { rankGrowthCandidates } = require('../src/growth_candidates');

function taipeiParts(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(now).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  return { year: Number(parts.year), date: `${parts.year}-${parts.month}-${parts.day}` };
}
function rowsOf(result) { return Array.isArray(result?.structuredContent?.rows) ? result.structuredContent.rows : []; }
function symbolOf(row) { return String(row?.symbol || row?.stock_code || row?.companyCode || row?.raw?.['公司代號'] || '').trim(); }
function normalizeOfficialMessages(rows) {
  return (rows || []).map(row => {
    const symbol = symbolOf(row);
    return {
      source: 'MOPS_OFFICIAL',
      title: String(row?.title || row?.subject || row?.raw?.['主旨'] || row?.raw?.['重大訊息主旨'] || row?.raw?.['說明'] || '').trim(),
      publishedAt: row?.available_from || row?.availableAt || row?.publishedAt || row?.publish_time || null,
      relatedSymbols: /^\d{4}$/.test(symbol) ? [symbol] : [],
      eventKey: row?.eventKey || row?.id || `${symbol}|${row?.available_from || ''}|${row?.title || row?.subject || ''}`,
      url: row?.url || null,
      official: true
    };
  }).filter(row => row.relatedSymbols.length && row.title);
}

async function mirrorToGcs(payload) {
  const bucketName = String(process.env.GCS_BUCKET || '').trim();
  if (!bucketName) return { mirrored: false, reason: 'GCS_BUCKET_NOT_CONFIGURED' };
  const { Storage } = require('@google-cloud/storage');
  const file = new Storage().bucket(bucketName).file('public/growth_top10.json');
  await file.save(`${JSON.stringify(payload, null, 2)}\n`, {
    contentType: 'application/json; charset=utf-8',
    metadata: { cacheControl: 'no-store' },
    resumable: false
  });
  return { mirrored: true, object: 'public/growth_top10.json' };
}

async function main() {
  const now = new Date();
  const current = taipeiParts(now);
  const year = Number(process.env.GROWTH_SYNC_YEAR || current.year);
  const asOf = process.env.GROWTH_SYNC_AS_OF || `${current.date}T23:59:59+08:00`;
  const mops = new MopsMcpHistory();
  const newsMcp = new TaiwanNewsMcp();

  const [monthlyResult, quarterlyResult, messagesResult, newsResult] = await Promise.allSettled([
    mops.callTool('mops_monthly_revenue', { year, asOf }),
    mops.callTool('mops_quarterly_financials', { year, asOf }),
    mops.callTool('mops_major_messages', { year, asOf }),
    newsMcp.callTool('taiwan_financial_news', { source: 'ALL', scopeMode: 'GROWTH_DISCOVERY' })
  ]);

  const monthlyRevenue = monthlyResult.status === 'fulfilled' ? rowsOf(monthlyResult.value) : [];
  const quarterlyFinancials = quarterlyResult.status === 'fulfilled' ? rowsOf(quarterlyResult.value) : [];
  const majorMessages = messagesResult.status === 'fulfilled' ? rowsOf(messagesResult.value) : [];
  const news = newsResult.status === 'fulfilled' ? rowsOf(newsResult.value) : [];
  const officialEvents = normalizeOfficialMessages(majorMessages);
  const top10 = rankGrowthCandidates({ monthlyRevenue, quarterlyFinancials, news, officialEvents, limit: 10 });

  const sourceStatus = {
    mopsMonthlyRevenue: monthlyResult.status,
    mopsQuarterlyFinancials: quarterlyResult.status,
    mopsMajorMessages: messagesResult.status,
    taiwanFinancialNewsMcp: newsResult.status,
    configuredNewsRows: news.length,
    officialMessageRows: officialEvents.length
  };
  const payload = {
    schemaVersion: 2,
    generatedAt: now.toISOString(),
    asOf,
    methodology: 'Independent medium/long-term potential-stock screening. Fundamentals 60, verified news 30, growth-theme evidence 10. News events are classified by business-event type and impact horizon. Official MOPS/TWSE events or corroboration by at least two independent sources are required before news can affect ranking. Long-horizon growth events receive extra weight. Hard-risk events cap total score at 45.',
    universePolicy: 'ALL_MOPS_LISTED_COMPANIES_WITH_CURRENT_YEAR_MONTHLY_REVENUE; NOT_RESTRICTED_BY_TOP100_TRADING_POOL',
    layoutPolicy: 'POTENTIAL_TOP10_IS_A_MEDIUM_LONG_TERM_RESEARCH_WATCHLIST; NOT_A_BUY_SIGNAL; TECHNICAL_TRADING_POOL_AND_TOP100_DO_NOT_CONTROL_ELIGIBILITY',
    eventAnalysisPolicy: {
      stages: ['DEDUPLICATE', 'COMPANY_MAPPING', 'EVENT_CLASSIFICATION', 'SENTIMENT', 'IMPACT_HORIZON', 'SOURCE_VERIFICATION', 'FUNDAMENTAL_CROSS_CHECK'],
      categories: ['ORDER_DEMAND', 'CAPACITY_EXPANSION', 'NEW_PRODUCT_TECH', 'FINANCIAL_PERFORMANCE', 'PARTNERSHIP_INVESTMENT', 'GUIDANCE_OUTLOOK', 'REGULATORY_CORPORATE', 'RISK_EVENT', 'OTHER'],
      horizons: ['IMMEDIATE', 'MEDIUM', 'MEDIUM_LONG', 'LONG', 'UNKNOWN']
    },
    sourcePolicy: {
      fundamentals: 'MOPS_MCP_PRIMARY',
      officialEvents: 'MOPS_MCP_PRIMARY',
      media: 'TAIWAN_FINANCIAL_NEWS_MCP_LICENSED_METADATA',
      verification: 'OFFICIAL_OR_TWO_INDEPENDENT_SOURCES',
      predictionGuarantee: false
    },
    sourceStatus,
    top10
  };

  const writer = new DrivePrimaryWriter({
    parentFolderId: process.env.GROWTH_DRIVE_PARENT_FOLDER_ID || process.env.MCP_DRIVE_PARENT_FOLDER_ID || process.env.TWSE_DRIVE_PARENT_FOLDER_ID || '',
    folderName: process.env.GROWTH_DRIVE_FOLDER_NAME || 'GROWTH_CANDIDATES_TOP10'
  });
  const filename = `growth_top10_${current.date}.json`;
  const saved = await writer.upsertText(filename, `${JSON.stringify(payload, null, 2)}\n`);
  const gcs = await mirrorToGcs(payload);
  await writer.upsertText('manifest.json', `${JSON.stringify({ schemaVersion: 2, generatedAt: payload.generatedAt, latestDate: current.date, latestFile: filename, driveFileId: saved.id, count: top10.length, sourceStatus, gcs }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ok: true, date: current.date, filename, driveFileId: saved.id, count: top10.length, gcs, top10: top10.map(x => ({ symbol: x.symbol, score: x.score, confidence: x.confidence, longTermLayoutGrade: x.longTermLayoutGrade, suggestedHoldingHorizon: x.suggestedHoldingHorizon })) }, null, 2)}\n`);
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { mirrorToGcs, normalizeOfficialMessages, taipeiParts };
