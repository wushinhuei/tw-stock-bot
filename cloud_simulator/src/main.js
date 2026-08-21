'use strict';

const { CONFIG } = require('./config');
const { SimulationEngine, taipeiDate, taipeiTime } = require('./engine');
const { GoogleRepository, MemoryRepository } = require('./repository');
const { fetchQuotes } = require('./twse');
const { buildUniverse } = require('./scanner');

function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }
function compactDate(date) { return date.replace(/-/g, ''); }

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
  return (payload.candidates || []).slice(0, CONFIG.maxCandidates);
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

async function main() {
  const mode = process.env.RUN_MODE || 'session';
  let result;
  if (mode === 'backtest') {
    const { loadReplay, runBacktest } = require('./backtest');
    result = await runBacktest(await loadReplay(process.env.BACKTEST_INPUT_URL));
  } else if (mode === 'session') {
    result = await runSession();
  } else {
    throw new Error(`Unsupported RUN_MODE: ${mode}`);
  }
  console.log(JSON.stringify({ event: 'session-complete', generatedAt: result.generatedAt, equity: result.simulation.finalEquity }));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });

module.exports = { compactDate, loadCandidates, repositoryFromEnvironment, runSession };
