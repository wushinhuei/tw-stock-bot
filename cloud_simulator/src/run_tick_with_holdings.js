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

  // 已達 5 檔（含尚未成交的有效買單）後，不再增加任何新風險；
  // 舊持倉若目前超過 5 檔，讓既有出場規則自然降到 5 檔以下，不強制砍倉。
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

function decorateDashboard(dashboard, positionMonitors) {
  const monitors = Array.isArray(positionMonitors) ? positionMonitors : [];
  dashboard.positionMonitors = monitors;
  dashboard.positionPolicy = {
    maxOpenPositions: MAX_OPEN_POSITIONS,
    newEntryGrade: MIN_NEW_ENTRY_GRADE,
    mode: 'TOP_SCORE_ONLY',
  };
  if (Array.isArray(dashboard.scenario)) {
    dashboard.scenario = dashboard.scenario.map((day, index) => index === 0
      ? { ...day, positionMonitors: monitors }
      : day);
  }
  return dashboard;
}

async function publishDashboard(repository, engine, entryCandidates, positionMonitors, tradesBefore) {
  const dashboard = decorateDashboard(engine.dashboard(entryCandidates), positionMonitors);
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
  let entryCandidates = options.candidates || await loadCandidates();

  if (CONFIG.strategyMode !== 'LONG_ONLY') throw new Error(`Unsupported strategy mode: ${CONFIG.strategyMode}`);

  const minute = Number(decision.time.slice(3, 5));
  if (minute % 10 === 0) {
    const news = await engine.refreshNews().catch(error => ({ items: [], errors: [String(error)] }));
    if (news.errors.length) console.warn(JSON.stringify({ event: 'rss-warning', errors: news.errors }));
  }

  const hasPositions = Array.isArray(engine.account.positions) && engine.account.positions.length > 0;
  if (decision.time >= CONFIG.tradingStart && (entryCandidates.length || hasPositions)) {
    // 買進候選與持倉監控完全分流：持倉只加入行情/風控，不佔每日30檔候選名額。
    const symbols = [...new Set(
      entryCandidates.map(item => item.symbol)
        .concat((engine.account.positions || []).map(item => item.symbol))
    )];
    const quotes = options.quotes || await fetchQuotes(symbols);

    entryCandidates = entryCandidates.map(candidate => ({ ...candidate, ...(quotes[candidate.symbol] || {}) }));
    const liveScorer = options.enrichCandidates || enrichCandidatesWithLiveScores;
    if (entryCandidates.length) entryCandidates = await liveScorer(entryCandidates, { now });

    const positionMonitors = buildPositionMonitors(engine, entryCandidates, quotes);
    const riskCandidates = mergeRiskCandidates(entryCandidates, positionMonitors);
    const context = {
      date: taipeiDate(now),
      time: decision.time,
      signalTimestamp: now.toISOString(),
      marketMode: 'NORMAL'
    };
    const tradesBefore = engine.account.trades.length;

    // 新買進只從 A 級中按正式 score 由高到低挑選，總持股最多 5 檔。
    // 75–79 分小額試單不再用於新增持股；現有持倉超過 5 檔時完全停止新買進，等待正常出場降至 5 檔以下。
    const premiumEntries = selectPremiumEntryCandidates(engine, entryCandidates);
    if (premiumEntries.length) engine.processCandidates(premiumEntries, context);

    // 出場、停損、停利與市值更新仍使用「30檔 + 全部現有持倉」。
    engine.processQuotes(quotes, riskCandidates, context);

    await repository.saveSnapshot({ timestamp: now.toISOString(), quotes });
    await repository.saveState({ account: engine.account });
    return publishDashboard(repository, engine, entryCandidates, positionMonitors, tradesBefore);
  }

  const positionMonitors = buildPositionMonitors(engine, entryCandidates, {});
  return decorateDashboard(engine.dashboard(entryCandidates), positionMonitors);
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
  }));
}

if (require.main === module) main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

module.exports = {
  MAX_OPEN_POSITIONS,
  buildPositionMonitors,
  decorateDashboard,
  mergeRiskCandidates,
  occupiedPositionSymbols,
  runTickWithHoldings,
  selectPremiumEntryCandidates,
};