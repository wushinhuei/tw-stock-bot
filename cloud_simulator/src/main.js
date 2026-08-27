'use strict';

const { CONFIG } = require('./config');
const { SimulationEngine, taipeiDate, taipeiTime } = require('./engine');
const { GoogleRepository, MemoryRepository } = require('./repository');
const { fetchQuotes } = require('./twse');
const { buildUniverse } = require('./scanner');
const { adaptCandidatePayload } = require('./candidate_adapter');
const { isTwseTradingDay } = require('./trading_calendar');
const { enrichCandidatesWithLiveScores } = require('./live_scoring');

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function compactDate(date) { return date.replace(/-/g, ''); }

function isWeekday(date) {
  const weekday = new Intl.DateTimeFormat('en-US', {
    timeZone: CONFIG.timezone,
    weekday: 'short'
  }).format(date);
  return weekday !== 'Sat' && weekday !== 'Sun';
}

function tickDecision(date = new Date()) {
  const time = taipeiTime(date);
  if (!isWeekday(date)) return { allowed: false, reason: 'NON_TRADING_DAY', time };
  if (time < CONFIG.sessionStart || time > CONFIG.sessionEnd) {
    return { allowed: false, reason: 'OUTSIDE_SESSION', time };
  }
  return { allowed: true, reason: 'TRADING_WINDOW', time };
}

function repositoryFromEnvironment() {
  if (!process.env.GCS_BUCKET) return new MemoryRepository();
  return new GoogleRepository({
    bucket: process.env.GCS_BUCKET,
    environment: process.env.SIMULATION_ENV || 'staging',
    databaseId: process.env.FIRESTORE_DATABASE_ID
  });
}

async function loadCandidates() {
  // Candidate bars and official-event enrichment are supplied by the daily scanner/backtest input.
  // The session runner intentionally refuses to manufacture missing prices or scores.
  if (!process.env.CANDIDATE_SNAPSHOT_URL) return [];
  const sourceUrl = candidateSourceUrl(process.env.CANDIDATE_SNAPSHOT_URL);
  const response = await fetch(sourceUrl, { cache: 'no-store', headers: { 'Cache-Control': 'no-cache, no-store, max-age=0', Pragma: 'no-cache' } });
  if (!response.ok) throw new Error(`Candidate snapshot HTTP ${response.status}`);
  const payload = await response.json();
  if (Array.isArray(payload.volumeRows)) return buildUniverse(payload.volumeRows, payload.enrichmentBySymbol || {});
  return adaptCandidatePayload(payload, { time: taipeiTime() }).candidates;
}

async function runSession() {
  const sessionNow = new Date();
  if (!isWeekday(sessionNow) || !await isTwseTradingDay(sessionNow, { ymd: taipeiDate(sessionNow) })) {
    return { skipped: true, reason: 'NON_TRADING_DAY', generatedAt: sessionNow.toISOString(), time: taipeiTime(sessionNow) };
  }
  const repository = repositoryFromEnvironment();
  const engine = new SimulationEngine({ config: CONFIG, repository });
  await engine.restore();
  let candidates = await loadCandidates();
  let lastNewsAt = 0;
  while (taipeiTime() <= CONFIG.sessionEnd) {
    const now = new Date();
    const time = taipeiTime(now);
    const date = taipeiDate(now);
    if (Date.now() - lastNewsAt >= CONFIG.rssPollMs) {
      const news = await engine.refreshNews().catch(error => ({ items: [], errors: [String(error)] }));
      if (news.errors.length) console.warn(JSON.stringify({ event: 'rss-warning', errors: news.errors }));
      lastNewsAt = Date.now();
    }
    if (time >= CONFIG.tradingStart && candidates.length) {
      const symbols = [...new Set(candidates.map(item => item.symbol).concat(engine.account.positions.map(item => item.symbol)))];
      const quotes = await fetchQuotes(symbols);
      candidates = candidates.map(candidate => ({ ...candidate, ...(quotes[candidate.symbol] || {}) }));
      candidates = await enrichCandidatesWithLiveScores(candidates, { now });
      const context = { date, time, signalTimestamp: now.toISOString(), marketMode: 'NORMAL' };
      engine.processCandidates(candidates, context);
      engine.processQuotes(quotes, candidates, context);
      await repository.saveSnapshot({ timestamp: now.toISOString(), quotes });
      await repository.saveState({ account: engine.account });
      if (repository.publishDashboard) await repository.publishDashboard(engine.dashboard(candidates));
    }
    await sleep(CONFIG.marketPollMs);
  }
  return engine.dashboard(candidates);
}

function candidateSourceUrl(value) {
  const url = new URL(value);
  if (url.hostname === 'script.google.com' && /\/macros\/s\//.test(url.pathname)) {
    url.searchParams.set('action', 'refresh');
    url.searchParams.set('force', '1');
    url.searchParams.set('_', String(Date.now()));
  }
  return url.toString();
}

async function runTick(options = {}) {
  const now = options.now || new Date();
  const decision = tickDecision(now);
  if (!decision.allowed) {
    return { skipped: true, reason: decision.reason, generatedAt: now.toISOString(), time: decision.time };
  }

  const tradingDay = options.isTradingDay
    ? await options.isTradingDay(now)
    : await isTwseTradingDay(now, { ymd: taipeiDate(now) }).catch(error => {
      console.warn(JSON.stringify({ event: 'trading-calendar-warning', error: String(error) }));
      return true;
    });
  if (!tradingDay) {
    return { skipped: true, reason: 'TWSE_MARKET_CLOSED', generatedAt: now.toISOString(), time: decision.time };
  }

  const repository = options.repository || repositoryFromEnvironment();
  const engine = options.engine || new SimulationEngine({ config: CONFIG, repository });
  await engine.restore();
  let candidates = options.candidates || await loadCandidates();

  // RSS is advisory-only and comparatively slow. Refresh on ten-minute boundaries;
  // quotes, positions and orders are still evaluated on every five-minute tick.
  const minute = Number(decision.time.slice(3, 5));
  if (minute % 10 === 0) {
    const news = await engine.refreshNews().catch(error => ({ items: [], errors: [String(error)] }));
    if (news.errors.length) console.warn(JSON.stringify({ event: 'rss-warning', errors: news.errors }));
  }

  if (decision.time >= CONFIG.tradingStart && candidates.length) {
    const symbols = [...new Set(candidates.map(item => item.symbol).concat(engine.account.positions.map(item => item.symbol)))];
    const quotes = options.quotes || await fetchQuotes(symbols);
    candidates = candidates.map(candidate => ({ ...candidate, ...(quotes[candidate.symbol] || {}) }));
    const liveScorer = options.enrichCandidates || enrichCandidatesWithLiveScores;
    candidates = await liveScorer(candidates, { now });
    const context = {
      date: taipeiDate(now), time: decision.time, signalTimestamp: now.toISOString(), marketMode: 'NORMAL'
    };
    engine.processCandidates(candidates, context);
    engine.processQuotes(quotes, candidates, context);
    await repository.saveSnapshot({ timestamp: now.toISOString(), quotes });
    await repository.saveState({ account: engine.account });
    if (repository.publishDashboard) await repository.publishDashboard(engine.dashboard(candidates));
  }
  return engine.dashboard(candidates);
}

async function main() {
  const mode = process.env.RUN_MODE || 'tick';
  let result;
  if (mode === 'backtest') {
    const { loadReplay, runBacktest } = require('./backtest');
    result = await runBacktest(await loadReplay(process.env.BACKTEST_INPUT_URL));
  } else if (mode === 'tick') {
    result = await runTick();
  } else if (mode === 'session') {
    result = await runSession();
  } else if (mode === 'api') {
    require('./api').startDashboardApi();
    return;
  } else if (mode === 'monthly-archive') {
    if (!process.env.GCS_BUCKET) throw new Error('GCS_BUCKET is required for monthly archive');
    const { Storage } = require('@google-cloud/storage');
    const { createMonthlyArchive } = require('./monthly_archive');
    result = await createMonthlyArchive({
      bucket: new Storage().bucket(process.env.GCS_BUCKET),
      month: process.env.ARCHIVE_MONTH || undefined
    });
  } else if (mode === 'drive-check') {
    const { DriveHistorySource } = require('./drive_history');
    const source = new DriveHistorySource();
    const status = await source.analysisStatus();
    result = {
      generatedAt: new Date().toISOString(),
      source: 'google-drive-history',
      ...status
    };
    console.log(JSON.stringify({ event: 'drive-history-check', ...result }));
  } else if (mode === 'drive-backtest') {
    const { runDriveBacktest } = require('./drive_backtest');
    result = await runDriveBacktest({
      start: process.env.BACKTEST_START || '2023-08-25',
      end: process.env.BACKTEST_END || '2026-08-24'
    });
    console.log(JSON.stringify({ event: 'drive-backtest-result', ...result, tradeLog: undefined }));
  } else if (mode === 'mops-history') {
    const { downloadMopsHistory } = require('./mops_history');
    result = await downloadMopsHistory({
      startYear: process.env.START_YEAR || 2016,
      endYear: process.env.END_YEAR || new Date().getFullYear(),
      outputDir: process.env.OUTPUT_DIR || '/tmp/mops-history',
      driveParentId: process.env.DRIVE_PARENT_FOLDER_ID || null,
      delayMs: process.env.REQUEST_DELAY_MS || 1500,
      downloadXbrlArchives: process.env.DOWNLOAD_XBRL_ARCHIVES === '1'
    });
  } else {
    throw new Error(`Unsupported RUN_MODE: ${mode}`);
  }
  console.log(JSON.stringify({
    event: mode === 'monthly-archive' ? 'monthly-archive-complete' : (result.skipped ? 'tick-skipped' : 'run-complete'),
    generatedAt: result.generatedAt,
    reason: result.reason,
    equity: result.simulation && result.simulation.finalEquity,
    month: result.month,
    destination: result.destination,
    count: result.count,
    source: result.source
  }));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { candidateSourceUrl, compactDate, isWeekday, loadCandidates, repositoryFromEnvironment, runSession, runTick, tickDecision };
