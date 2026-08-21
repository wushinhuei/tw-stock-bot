'use strict';

const { CONFIG } = require('./config');
const { SimulationEngine, taipeiDate, taipeiTime } = require('./engine');
const { GoogleRepository, MemoryRepository } = require('./repository');
const { fetchQuotes } = require('./twse');
const { buildUniverse } = require('./scanner');
const { adaptCandidatePayload } = require('./candidate_adapter');

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
  const response = await fetch(process.env.CANDIDATE_SNAPSHOT_URL);
  if (!response.ok) throw new Error(`Candidate snapshot HTTP ${response.status}`);
  const payload = await response.json();
  if (Array.isArray(payload.volumeRows)) return buildUniverse(payload.volumeRows, payload.enrichmentBySymbol || {});
  return adaptCandidatePayload(payload, { time: taipeiTime() }).candidates;
}

async function runSession() {
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

async function runTick(options = {}) {
  const now = options.now || new Date();
  const decision = tickDecision(now);
  if (!decision.allowed) {
    return { skipped: true, reason: decision.reason, generatedAt: now.toISOString(), time: decision.time };
  }

  const repository = options.repository || repositoryFromEnvironment();
  const engine = options.engine || new SimulationEngine({ config: CONFIG, repository });
  await engine.restore();
  let candidates = options.candidates || await loadCandidates();

  // RSS is advisory-only and comparatively slow. Refresh on ten-minute boundaries;
  // quotes, positions and orders are still evaluated on every four-minute tick.
  const minute = Number(decision.time.slice(3, 5));
  if (minute % 10 === 0) {
    const news = await engine.refreshNews().catch(error => ({ items: [], errors: [String(error)] }));
    if (news.errors.length) console.warn(JSON.stringify({ event: 'rss-warning', errors: news.errors }));
  }

  if (decision.time >= CONFIG.tradingStart && candidates.length) {
    const symbols = [...new Set(candidates.map(item => item.symbol).concat(engine.account.positions.map(item => item.symbol)))];
    const quotes = options.quotes || await fetchQuotes(symbols);
    candidates = candidates.map(candidate => ({ ...candidate, ...(quotes[candidate.symbol] || {}) }));
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
  } else {
    throw new Error(`Unsupported RUN_MODE: ${mode}`);
  }
  console.log(JSON.stringify({
    event: result.skipped ? 'tick-skipped' : 'run-complete',
    generatedAt: result.generatedAt,
    reason: result.reason,
    equity: result.simulation && result.simulation.finalEquity
  }));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { compactDate, isWeekday, loadCandidates, repositoryFromEnvironment, runSession, runTick, tickDecision };
