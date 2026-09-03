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
    schemaVersion: 1,
    generatedAt: now.toISOString(),
    asOf,
    methodology: 'Evidence-based growth screening. Fundamentals 60, verified news 30, growth-theme evidence 10. News must be official or corroborated by at least two independent sources before affecting score. Hard-risk events cap total score at 45.',
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
  await writer.upsertText('manifest.json', `${JSON.stringify({ schemaVersion: 1, generatedAt: payload.generatedAt, latestDate: current.date, latestFile: filename, driveFileId: saved.id, count: top10.length, sourceStatus }, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify({ ok: true, date: current.date, filename, driveFileId: saved.id, count: top10.length, top10: top10.map(x => ({ symbol: x.symbol, score: x.score, confidence: x.confidence })) }, null, 2)}\n`);
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { normalizeOfficialMessages, taipeiParts };
