'use strict';

const { spawnSync } = require('node:child_process');
const { CONFIG } = require('./config');
const { SimulationEngine, taipeiDate } = require('./engine');
const { loadCandidates, repositoryFromEnvironment, tickDecision } = require('./main');
const { fetchQuotes } = require('./twse');
const { isTwseTradingDay } = require('./trading_calendar');
const { enrichCandidatesWithLiveScores } = require('./live_scoring');
const { triggerStaticBackupOnTrades } = require('./static_backup');

const MAX_OPEN_POSITIONS = 5;
const MIN_NEW_ENTRY_GRADE = 'A';
const CANDIDATE_RANKING_INTERVAL_MINUTES = Number(CONFIG.candidateRankingIntervalMinutes || 60);

function activeOrderStatuses() {
  return new Set(['NEW', 'OPEN', 'PARTIAL', 'CANCEL_PENDING']);
}

function validQuotePrice(quote) {
  const values = [quote?.bidPrice, quote?.price, quote?.askPrice];
  for (const value of values) {
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric;
  }
  return 0;
}

function candidateRankingKey(now, intervalMinutes = CANDIDATE_RANKING_INTERVAL_MINUTES) {
  const time = new Intl.DateTimeFormat('en-GB', {
    timeZone: CONFIG.timezone,
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).format(now);
  const [hour, minute] = time.split(':').map(Number);
  const bucket = Math.floor(minute / intervalMinutes) * intervalMinutes;
  return `${taipeiDate(now)}T${String(hour).padStart(2, '0')}:${String(bucket).padStart(2, '0')}`;
}

async function loadHourlyCandidateRanking(repository, options, now) {
  const rankingKey = candidateRankingKey(now);
  const stored = await repository.loadState().catch(() => ({}));
  const previous = stored?.candidateRanking;

  if (Array.isArray(options.candidates)) {
    return {
      candidates: options.candidates,
      cache: {
        rankingKey,
        updatedAt: now.toISOString(),
        candidates: options.candidates,
        sourcePoolSize: CONFIG.candidateSelectionPoolLimit,
        limit: CONFIG.maxCandidates,
      },
      refreshed: true,
    };
  }

  if (previous?.rankingKey === rankingKey && Array.isArray(previous.candidates) && previous.candidates.length) {
    return { candidates: previous.candidates, cache: previous, refreshed: false };
  }

  const fresh = await loadCandidates();
  if (Array.isArray(fresh) && fresh.length) {
    const cache = {
      rankingKey,
      updatedAt: now.toISOString(),
      candidates: fresh,
      sourcePoolSize: CONFIG.candidateSelectionPoolLimit,
      limit: CONFIG.maxCandidates,
    };
    return { candidates: fresh, cache, refreshed: true };
  }

  // 若整點更新來源暫時失敗，沿用上一版候選名單，但標記為 stale；
  // 不因短暫資料錯誤把觀察名單清空，也不因此自動產生交易。
  if (Array.isArray(previous?.candidates) && previous.candidates.length) {
    return {
      candidates: previous.candidates,
      cache: { ...previous, stale: true, refreshFailedAt: now.toISOString() },
      refreshed: false,
    };
  }

  return {
    candidates: [],
    cache: { rankingKey, updatedAt: now.toISOString(), candidates: [], sourcePoolSize: CONFIG.candidateSelectionPoolLimit, limit: CONFIG.maxCandidates },
    refreshed: true,
  };
}

function buildPositionMonitors(engine, candidates, quotes) {
  const bySymbol = new Map((Array.isArray(candidates) ? candidates : []).map(item => [String(item.symbol), item]));
  return (engine.account.positions || []).map(position => {
    const symbol = String(position.symbol);
    const candidate = bySymbol.get(symbol) || {};
    const quote = quotes?.[symbol] || {};
    const quotePrice = validQuotePrice(quote);
    return {
      ...candidate,
      ...quote,
      symbol,
      name: candidate.name || position.name || symbol,
      strategy: position.strategy,
      grade: candidate.grade || 'HOLDING',
      dataStatus: quotePrice > 0 ? (candidate.dataStatus || 'QUOTE_ONLY') : 'NO_QUOTE',
      monitoringOnly: true,
      heldPosition: true,
      price: Number(quote.price || candidate.price || quote.bidPrice || quote.askPrice || 0),
      bidPrice: Number(quote.bidPrice || candidate.bidPrice || quote.price || candidate.price || 0),
      askPrice: Number(quote.askPrice || candidate.askPrice || quote.price || candidate.price || 0),
    };
  });
}

function mergeRiskCandidates(candidates, positionMonitors) {
  const merged = [...(Array.isArray(candidates) ? candidates : [])];
  const seen = new Set(merged.map(item => String(item.symbol)));
  for (const monitor of positionMonitors) {
    const symbol = String(monitor.symbol);
    if (!seen.has(symbol)) {
      merged.push(monitor);
      seen.add(symbol);
    }
  }
  return merged;
}

function occupiedPositionSymbols(engine) {
  const held = new Set((engine.account.positions || []).map(position => String(position.symbol)));
  const active = activeOrderStatuses();
  for (const order of engine.account.orders || []) {
    if (String(order.side || '').toUpperCase() !== 'BUY' || !active.has(order.status)) continue;
    held.add(String(order.symbol));
  }
  return held;
}

function selectPremiumEntryCandidates(engine, candidates) {
  const rows = Array.isArray(candidates) ? candidates : [];
  const occupied = occupiedPositionSymbols(engine);

  if (occupied.size >= MAX_OPEN_POSITIONS) return [];

  const remainingSlots = MAX_OPEN_POSITIONS - occupied.size;
  return rows
    .filter(candidate => {
      const symbol = String(candidate?.symbol || '');
      if (!symbol || occupied.has(symbol)) return false;
      if (candidate?.grade !== MIN_NEW_ENTRY_GRADE) return false;
      if (candidate?.dataStatus && candidate.dataStatus !== 'COMPLETE') return false;
      if (Array.isArray(candidate?.blockedReasons) && candidate.blockedReasons.length) return false;
      return Number.isFinite(Number(candidate?.score));
    })
    .sort((a, b) => Number(b.score || 0) - Number(a.score || 0))
    .slice(0, remainingSlots);
}

function decorateDashboard(dashboard, positionMonitors, candidateRanking) {
  const monitors = Array.isArray(positionMonitors) ? positionMonitors : [];
  dashboard.positionMonitors = monitors;
  dashboard.positionPolicy = {
    maxOpenPositions: MAX_OPEN_POSITIONS,
    newEntryGrade: MIN_NEW_ENTRY_GRADE,
    mode: 'TOP_SCORE_ONLY',
  };
  dashboard.candidatePolicy = {
    purpose: 'WATCHLIST_ONLY',
    source: 'TWSE_TOP_VOLUME_100',
    sourcePoolSize: CONFIG.candidateSelectionPoolLimit,
    displayLimit: CONFIG.maxCandidates,
    rankingIntervalMinutes: CANDIDATE_RANKING_INTERVAL_MINUTES,
    rankingUpdatedAt: candidateRanking?.updatedAt || null,
    rankingKey: candidateRanking?.rankingKey || null,
    stale: Boolean(candidateRanking?.stale),
    note: '候選名單僅供觀察與排序，不代表買進、賣出或任何交易指令。',
  };
  if (Array.isArray(dashboard.scenario)) {
    dashboard.scenario = dashboard.scenario.map((day, index) => index === 0
      ? { ...day, positionMonitors: monitors, candidatePolicy: dashboard.candidatePolicy }
      : day);
  }
  return dashboard;
}

async function publishDashboard(repository, engine, watchlistCandidates, positionMonitors, candidateRanking, tradesBefore) {
  const dashboard = decorateDashboard(engine.dashboard(watchlistCandidates), positionMonitors, candidateRanking);
  if (repository.publishDashboard) await repository.publishDashboard(dashboard);
  const newTrades = engine.account.trades.slice(tradesBefore);
  if (newTrades.length) await triggerStaticBackupOnTrades(newTrades);
  return dashboard;
}

async function runTickWithHoldings(options = {}) {
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

  // 候選觀察名單與交易判斷分開：從成交量 Top100 建池，每小時只重新排序一次並固定該小時的30檔名單。
  const ranking = await loadHourlyCandidateRanking(repository, options, now);
  let watchlistCandidates = ranking.candidates;

  if (CONFIG.strategyMode !== 'LONG_ONLY') throw new Error(`Unsupported strategy mode: ${CONFIG.strategyMode}`);

  const minute = Number(decision.time.slice(3, 5));
  if (minute % 10 === 0) {
    const news = await engine.refreshNews().catch(error => ({ items: [], errors: [String(error)] }));
    if (news.errors.length) console.warn(JSON.stringify({ event: 'rss-warning', errors: news.errors }));
  }

  const hasPositions = Array.isArray(engine.account.positions) && engine.account.positions.length > 0;
  if (decision.time >= CONFIG.tradingStart && (watchlistCandidates.length || hasPositions)) {
    const symbols = [...new Set(
      watchlistCandidates.map(item => item.symbol)
        .concat((engine.account.positions || []).map(item => item.symbol))
    )];
    const quotes = options.quotes || await fetchQuotes(symbols);

    // 名單順位一小時內不重排，但報價與正式交易評分仍可隨每個 tick 更新。
    watchlistCandidates = watchlistCandidates.map(candidate => ({ ...candidate, ...(quotes[candidate.symbol] || {}) }));
    const liveScorer = options.enrichCandidates || enrichCandidatesWithLiveScores;
    if (watchlistCandidates.length) watchlistCandidates = await liveScorer(watchlistCandidates, { now });

    const positionMonitors = buildPositionMonitors(engine, watchlistCandidates, quotes);
    const riskCandidates = mergeRiskCandidates(watchlistCandidates, positionMonitors);
    const context = {
      date: taipeiDate(now),
      time: decision.time,
      signalTimestamp: now.toISOString(),
      marketMode: 'NORMAL'
    };
    const tradesBefore = engine.account.trades.length;

    // 候選名單本身不是交易指令。只有另外通過 A 級、資料完整、無阻擋、資金與5檔上限等條件，才進入下單判斷。
    const premiumEntries = selectPremiumEntryCandidates(engine, watchlistCandidates);
    if (premiumEntries.length) engine.processCandidates(premiumEntries, context);

    engine.processQuotes(quotes, riskCandidates, context);

    await repository.saveSnapshot({ timestamp: now.toISOString(), quotes });
    await repository.saveState({ account: engine.account, candidateRanking: ranking.cache });
    return publishDashboard(repository, engine, watchlistCandidates, positionMonitors, ranking.cache, tradesBefore);
  }

  const positionMonitors = buildPositionMonitors(engine, watchlistCandidates, {});
  await repository.saveState({ account: engine.account, candidateRanking: ranking.cache });
  return decorateDashboard(engine.dashboard(watchlistCandidates), positionMonitors, ranking.cache);
}

async function main() {
  const mode = process.env.RUN_MODE || 'tick';
  if (mode !== 'tick') {
    const result = spawnSync(process.execPath, ['cloud_simulator/src/main.js'], {
      stdio: 'inherit',
      env: process.env
    });
    process.exitCode = result.status == null ? 1 : result.status;
    return;
  }

  const result = await runTickWithHoldings();
  console.log(JSON.stringify({
    event: result.skipped ? 'tick-skipped' : 'run-complete',
    generatedAt: result.generatedAt,
    reason: result.reason,
    equity: result.simulation && result.simulation.finalEquity,
    positionsMonitored: Array.isArray(result.positionMonitors) ? result.positionMonitors.length : 0,
    maxOpenPositions: MAX_OPEN_POSITIONS,
    candidateRankingIntervalMinutes: CANDIDATE_RANKING_INTERVAL_MINUTES,
    candidateRankingUpdatedAt: result.candidatePolicy?.rankingUpdatedAt || null,
  }));
}

if (require.main === module) main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

module.exports = {
  CANDIDATE_RANKING_INTERVAL_MINUTES,
  MAX_OPEN_POSITIONS,
  buildPositionMonitors,
  candidateRankingKey,
  decorateDashboard,
  loadHourlyCandidateRanking,
  mergeRiskCandidates,
  occupiedPositionSymbols,
  runTickWithHoldings,
  selectPremiumEntryCandidates,
};
