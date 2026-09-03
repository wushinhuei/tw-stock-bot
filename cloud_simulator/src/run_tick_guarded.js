'use strict';

const { enrichCandidatesWithLiveScores } = require('./live_scoring');
const { readDataHealth, isDataHealthy } = require('./data_health');
const { repositoryFromEnvironment } = require('./main');
const { MemoryRepository } = require('./repository');
const { blockEntriesForPretradeReadiness, preparePretradeTop100 } = require('./pretrade_prepare');
const { runTickWithHoldings } = require('./run_tick_with_holdings');

function buildSafeTestNow(realNow = new Date()) {
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit' }).format(realNow);
  return new Date(`${ymd}T02:00:00.000Z`);
}

async function saveReadiness(repository, report) {
  const stored = await repository.loadState().catch(() => ({}));
  await repository.saveState({ ...stored, pretradeReadiness: report });
}

async function runGuardedTick(options = {}) {
  const testMode = options.testMode === true || process.env.SIMULATOR_TEST_MODE === '1';
  const realRepository = options.repository || repositoryFromEnvironment();
  const repository = testMode ? new MemoryRepository(await realRepository.loadState().catch(() => ({}))) : realRepository;
  const now = options.now || (testMode ? buildSafeTestNow() : new Date());

  const report = await preparePretradeTop100({ now }).catch(error => ({
    ready: false, generatedAt: now.toISOString(), globalErrors: [`pretrade_prepare:${error}`], incompleteSymbols: [],
    policy: { tradingGate: '盤前資料準備失敗時禁止新增買進；既有持倉仍照常監控與出場' },
  }));

  const dataHealth = testMode ? { ok: true, status: 'COMPLETE', testMode: true } : await readDataHealth(process.env.GCS_BUCKET);
  if (!isDataHealthy(dataHealth)) {
    report.ready = false;
    report.globalErrors = [...(report.globalErrors || []), `global_data_health:${dataHealth.status || 'UNKNOWN'}:${(dataHealth.failedChecks || []).join(',')}`];
    report.policy = { ...(report.policy || {}), globalDataGate: '全系統資料完整性未通過時禁止新增買進；既有持倉仍可依風控監控與出場' };
  }
  report.globalDataHealth = { status: dataHealth.status || 'UNKNOWN', ok: Boolean(dataHealth.ok), generatedAt: dataHealth.generatedAt || null, latestCompleteTradeDate: dataHealth.latestCompleteTradeDate || null, failedChecks: dataHealth.failedChecks || [] };
  await saveReadiness(repository, report).catch(() => {});

  const guardedScorer = async (candidates, scorerOptions = {}) => blockEntriesForPretradeReadiness(await enrichCandidatesWithLiveScores(candidates, scorerOptions), report);
  const result = await runTickWithHoldings({ ...options, now, repository, isTradingDay: testMode ? async () => true : options.isTradingDay, enrichCandidates: guardedScorer });

  await saveReadiness(repository, report).catch(() => {});
  if (result && typeof result === 'object') {
    result.testMode = testMode;
    result.dataHealth = report.globalDataHealth;
    result.pretradeReadiness = {
      ready: report.ready, generatedAt: report.generatedAt, dataTradeDate: report.dataTradeDate || null,
      activeTop100Count: report.activeTop100Count ?? null, completeCount: report.completeCount ?? null,
      incompleteCount: report.incompleteCount ?? null, incompleteSymbols: report.incompleteSymbols || [], globalErrors: report.globalErrors || [],
    };
  }
  return result;
}

async function main() {
  const result = await runGuardedTick();
  console.log(JSON.stringify({
    event: result?.skipped ? 'tick-skipped' : 'run-complete', testMode: result?.testMode === true, dryRun: result?.testMode === true,
    generatedAt: result?.generatedAt, reason: result?.reason, positionsMonitored: Array.isArray(result?.positionMonitors) ? result.positionMonitors.length : 0,
    candidatesVisible: Array.isArray(result?.potentialStocks) ? result.potentialStocks.length : null,
    pretradeReady: result?.pretradeReadiness?.ready ?? false, dataHealth: result?.dataHealth?.status || 'UNKNOWN',
    top100Complete: result?.pretradeReadiness?.completeCount ?? 0, top100Incomplete: result?.pretradeReadiness?.incompleteCount ?? 0,
  }));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
module.exports = { buildSafeTestNow, runGuardedTick, saveReadiness };
