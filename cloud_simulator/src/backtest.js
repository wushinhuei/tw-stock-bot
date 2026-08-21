'use strict';

const { SimulationEngine } = require('./engine');
const { MemoryRepository } = require('./repository');

async function loadReplay(url, fetchImpl = fetch) {
  if (!url) throw new Error('BACKTEST_INPUT_URL is required');
  const response = await fetchImpl(url);
  if (!response.ok) throw new Error(`Backtest input HTTP ${response.status}`);
  const payload = await response.json();
  if (!Array.isArray(payload.frames)) throw new Error('Backtest input must contain frames[]');
  return payload.frames;
}

async function runBacktest(frames, options = {}) {
  const engine = new SimulationEngine({ repository: new MemoryRepository(), config: options.config });
  for (const frame of [...frames].sort((a, b) => a.timestamp.localeCompare(b.timestamp))) {
    const context = { date: frame.date, time: frame.time, signalTimestamp: frame.timestamp, marketMode: frame.marketMode || 'NORMAL' };
    engine.processCandidates(frame.candidates || [], context);
    engine.processQuotes(frame.quotes || {}, frame.candidates || [], context);
  }
  const dashboard = engine.dashboard(frames.at(-1)?.candidates || []);
  const initial = dashboard.simulation.initialCapital;
  return {
    ...dashboard,
    validation: {
      totalReturn: dashboard.simulation.finalEquity / initial - 1,
      monthlyTargetPassed: dashboard.simulation.finalEquity / initial - 1 >= 0.03,
      maxDrawdownLimit: -0.10,
      note: '需以完整三年資料另行計算月報酬與最大回撤；Investing RSS 不回填歷史分數。'
    }
  };
}

module.exports = { loadReplay, runBacktest };
