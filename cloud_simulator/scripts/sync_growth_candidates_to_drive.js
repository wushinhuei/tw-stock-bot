'use strict';

const { MopsMcpHistory } = require('../src/mops_mcp_history');
const { TaiwanNewsMcp } = require('../src/taiwan_news_mcp');
const { DrivePrimaryWriter } = require('../src/drive_primary_writer');
const { DriveHistorySource } = require('../src/drive_history');
const { rankGrowthCandidates } = require('../src/growth_candidates');
const { applyStablePolicy, rescoreCandidate } = require('../src/potential_top10_policy');

function taipeiParts(now = new Date()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now).filter(p => p.type !== 'literal').map(p => [p.type, p.value]));
  return { year: Number(parts.year), date: `${parts.year}-${parts.month}-${parts.day}` };
}
function rowsOf(result) { return Array.isArray(result?.structuredContent?.rows) ? result.structuredContent.rows : []; }
function symbolOf(row) { return String(row?.symbol || row?.stock_code || row?.companyCode || row?.raw?.['公司代號'] || '').trim(); }
function normalizeOfficialMessages(rows) {
  return (rows || []).map(row => { const symbol = symbolOf(row); return { source:'MOPS_OFFICIAL', title:String(row?.title || row?.subject || row?.raw?.['主旨'] || row?.raw?.['重大訊息主旨'] || row?.raw?.['說明'] || '').trim(), publishedAt:row?.available_from || row?.availableAt || row?.publishedAt || row?.publish_time || null, relatedSymbols:/^\d{4}$/.test(symbol)?[symbol]:[], eventKey:row?.eventKey || row?.id || `${symbol}|${row?.available_from || ''}|${row?.title || row?.subject || ''}`, url:row?.url || null, official:true }; }).filter(row => row.relatedSymbols.length && row.title);
}
async function readPreviousFromGcs() {
  const bucketName = String(process.env.GCS_BUCKET || '').trim(); if (!bucketName) return {};
  try { const { Storage } = require('@google-cloud/storage'); const [buf] = await new Storage().bucket(bucketName).file('public/growth_top10.json').download(); return JSON.parse(buf.toString('utf8')); } catch (_) { return {}; }
}
async function mirrorToGcs(payload) {
  const bucketName = String(process.env.GCS_BUCKET || '').trim(); if (!bucketName) return { mirrored:false, reason:'GCS_BUCKET_NOT_CONFIGURED' };
  const { Storage } = require('@google-cloud/storage'); const file = new Storage().bucket(bucketName).file('public/growth_top10.json');
  await file.save(`${JSON.stringify(payload,null,2)}\n`, { contentType:'application/json; charset=utf-8', metadata:{cacheControl:'no-store'}, resumable:false });
  return { mirrored:true, object:'public/growth_top10.json' };
}
async function loadMarketFlow(year) {
  try { const source = new DriveHistorySource(); await source.manifest('marketFlow'); return await source.rows('marketFlow', year); } catch (error) { console.warn(`marketFlow unavailable: ${error.message}`); return []; }
}

async function main() {
  const now = new Date(); const current = taipeiParts(now); const year = Number(process.env.GROWTH_SYNC_YEAR || current.year); const asOf = process.env.GROWTH_SYNC_AS_OF || `${current.date}T23:59:59+08:00`;
  const mops = new MopsMcpHistory(); const newsMcp = new TaiwanNewsMcp();
  const [monthlyResult, quarterlyResult, messagesResult, newsResult, marketFlow, previous] = await Promise.all([
    mops.callTool('mops_monthly_revenue',{year,asOf}).then(value=>({status:'fulfilled',value}),reason=>({status:'rejected',reason})),
    mops.callTool('mops_quarterly_financials',{year,asOf}).then(value=>({status:'fulfilled',value}),reason=>({status:'rejected',reason})),
    mops.callTool('mops_major_messages',{year,asOf}).then(value=>({status:'fulfilled',value}),reason=>({status:'rejected',reason})),
    newsMcp.callTool('taiwan_financial_news',{source:'ALL',scopeMode:'GROWTH_DISCOVERY'}).then(value=>({status:'fulfilled',value}),reason=>({status:'rejected',reason})),
    loadMarketFlow(year), readPreviousFromGcs()
  ]);
  const monthlyRevenue = monthlyResult.status==='fulfilled'?rowsOf(monthlyResult.value):[]; const quarterlyFinancials=quarterlyResult.status==='fulfilled'?rowsOf(quarterlyResult.value):[]; const majorMessages=messagesResult.status==='fulfilled'?rowsOf(messagesResult.value):[]; const news=newsResult.status==='fulfilled'?rowsOf(newsResult.value):[]; const officialEvents=normalizeOfficialMessages(majorMessages);
  const rawCandidates = rankGrowthCandidates({monthlyRevenue,quarterlyFinancials,news,officialEvents,limit:5000});
  const flowBySymbol = new Map(); for (const row of marketFlow) { const s=symbolOf(row); if(!/^\d{4}$/.test(s) || String(row.trade_date||'')>current.date) continue; const a=flowBySymbol.get(s)||[]; a.push(row); flowBySymbol.set(s,a); }
  const rescored = rawCandidates.map(c=>rescoreCandidate(c,flowBySymbol.get(c.symbol)||[]));
  const stable = applyStablePolicy(rescored,previous,current.date); const top10=stable.top10;
  const sourceStatus={mopsMonthlyRevenue:monthlyResult.status,mopsQuarterlyFinancials:quarterlyResult.status,mopsMajorMessages:messagesResult.status,taiwanFinancialNewsMcp:newsResult.status,marketFlowRows:marketFlow.length,configuredNewsRows:news.length,officialMessageRows:officialEvents.length};
  const payload={schemaVersion:3,generatedAt:now.toISOString(),asOf,methodology:'Potential Top10 v2: fundamentals 50 + verified news events 25 + institutional accumulation 25. Entry requires total >=70, fundamentals >=30, and fundamentals+news >=50 or fundamentals+institutional >=50. New candidates must qualify for 2 weekly evaluations. Existing members use 65-point exit hysteresis; normal replacement is monthly, challenger must lead incumbent by >=5 points, maximum 3 normal replacements per month. Hard risk is immediate.',universePolicy:'ALL_MOPS_LISTED_COMPANIES_WITH_CURRENT_YEAR_MONTHLY_REVENUE; NOT_RESTRICTED_BY_TOP100_TRADING_POOL',layoutPolicy:'6-24M_MEDIUM_LONG_TERM_RESEARCH_WATCHLIST; DAILY_DATA; WEEKLY_SCORE; MONTHLY_REBALANCE; NOT_A_BUY_SIGNAL',selectionPolicy:stable.policy,sourcePolicy:{fundamentals:'MOPS_MCP_PRIMARY',officialEvents:'MOPS_MCP_PRIMARY',media:'TAIWAN_FINANCIAL_NEWS_MCP_LICENSED_METADATA',institutional:'TWSE_T86_MARKET_FLOW_DRIVE_HISTORY',verification:'OFFICIAL_OR_TWO_INDEPENDENT_SOURCES'},sourceStatus,top10,reserve5:stable.reserve5,selectionState:stable.selectionState,lastRebalanceMonth:stable.lastRebalanceMonth};
  const writer=new DrivePrimaryWriter({parentFolderId:process.env.GROWTH_DRIVE_PARENT_FOLDER_ID||process.env.MCP_DRIVE_PARENT_FOLDER_ID||process.env.TWSE_DRIVE_PARENT_FOLDER_ID||'',folderName:process.env.GROWTH_DRIVE_FOLDER_NAME||'GROWTH_CANDIDATES_TOP10'}); const filename=`growth_top10_${current.date}.json`; const saved=await writer.upsertText(filename,`${JSON.stringify(payload,null,2)}\n`); const gcs=await mirrorToGcs(payload); await writer.upsertText('manifest.json',`${JSON.stringify({schemaVersion:3,generatedAt:payload.generatedAt,latestDate:current.date,latestFile:filename,driveFileId:saved.id,count:top10.length,reserveCount:stable.reserve5.length,sourceStatus,gcs},null,2)}\n`); process.stdout.write(`${JSON.stringify({ok:true,date:current.date,filename,driveFileId:saved.id,count:top10.length,gcs,top10:top10.map(x=>({symbol:x.symbol,score:x.score,fundamentalScore:x.fundamentalScore,newsScore:x.newsScore,institutionalScore:x.institutionalScore,institutionalGrade:x.institutionalGrade,status:x.status}))},null,2)}\n`);
}
if(require.main===module) main().catch(error=>{console.error(error);process.exitCode=1;});
module.exports={loadMarketFlow,mirrorToGcs,normalizeOfficialMessages,readPreviousFromGcs,taipeiParts};
