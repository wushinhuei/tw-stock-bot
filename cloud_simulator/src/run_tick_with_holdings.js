'use strict';

const { spawnSync } = require('node:child_process');
const { CONFIG } = require('./config');
const { SimulationEngine, taipeiDate } = require('./engine');
const { loadCandidates, repositoryFromEnvironment, tickDecision } = require('./main');
const { fetchQuotes } = require('./twse');
const { isTwseTradingDay } = require('./trading_calendar');
const { enrichCandidatesWithLiveScores } = require('./live_scoring');
const { triggerStaticBackupOnTrades } = require('./static_backup');

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

function decorateDashboard(dashboard, positionMonitors) {
  const monitors = Array.isArray(positionMonitors) ? positionMonitors : [];
  dashboard.positionMonitors = monitors;
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

    // 新買進仍只看原本的30檔；持倉監控清單不會被送進 processCandidates。
    if (entryCandidates.length) engine.processCandidates(entryCandidates, context);
    // 出場、停損、停利與市值更新則使用「30檔 + 全部現有持倉」。
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
    positionsMonitored: Array.isArray(result.positionMonitors) ? result.positionMonitors.length : 0
  }));
}

if (require.main === module) main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

module.exports = {
  buildPositionMonitors,
  decorateDashboard,
  mergeRiskCandidates,
  runTickWithHoldings,
};
