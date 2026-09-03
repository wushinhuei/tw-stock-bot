'use strict';

const { enrichCandidatesWithLiveScores } = require('./live_scoring');
const { repositoryFromEnvironment } = require('./main');
const { MemoryRepository } = require('./repository');
const { blockEntriesForPretradeReadiness, preparePretradeTop100 } = require('./pretrade_prepare');
const { runTickWithHoldings } = require('./run_tick_with_holdings');

function buildSafeTestNow(realNow = new Date()) {
  const ymd = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(realNow);
  // 台灣無日光節約時間；02:00 UTC = 10:00 Asia/Taipei。
  return new Date(`${ymd}T02:00:00.000Z`);
}

async function saveReadiness(repository, report) {
  const stored = await repository.loadState().catch(() => ({}));
  await repository.saveState({ ...stored, pretradeReadiness: report });
}

async function runGuardedTick(options = {}) {
  const testMode = options.testMode === true || process.env.SIMULATOR_TEST_MODE === '1';
  const realRepository = options.repository || repositoryFromEnvironment();
  const repository = testMode
    ? new MemoryRepository(await realRepository.loadState().catch(() => ({})))
    : realRepository;
  const now = options.now || (testMode ? buildSafeTestNow() : new Date());

  // 每次交易前先刷新／檢核 Top100。08:50 起即開始預熱，09:10 後仍持續檢查。
  // 資料不完整時不是拿 0 分或猜值，而是直接封鎖新增買進。
  const report = await preparePretradeTop100({ now }).catch(error => ({
    ready: false,
    generatedAt: now.toISOString(),
    globalErrors: [`pretrade_prepare:${error}`],
    incompleteSymbols: [],
    policy: { tradingGate: '盤前資料準備失敗時禁止新增買進；既有持倉仍照常監控與出場' },
  }));
  await saveReadiness(repository, report).catch(() => {});

  const guardedScorer = async (candidates, scorerOptions = {}) => {
    const scored = await enrichCandidatesWithLiveScores(candidates, scorerOptions);
    return blockEntriesForPretradeReadiness(scored, report);
  };

  const result = await runTickWithHoldings({
    ...options,
    now,
    repository,
    isTradingDay: testMode ? async () => true : options.isTradingDay,
    enrichCandidates: guardedScorer,
  });

  // runTickWithHoldings 會保存 account/candidateRanking；再把盤前完整性報告合併回狀態，避免被覆寫。
  await saveReadiness(repository, report).catch(() => {});
  if (result && typeof result === 'object') {
    result.testMode = testMode;
    result.pretradeReadiness = {
      ready: report.ready,
      generatedAt: report.generatedAt,
      dataTradeDate: report.dataTradeDate || null,
      activeTop100Count: report.activeTop100Count ?? null,
      completeCount: report.completeCount ?? null,
      incompleteCount: report.incompleteCount ?? null,
      incompleteSymbols: report.incompleteSymbols || [],
      globalErrors: report.globalErrors || [],
    };
  }
  return result;
}

async function main() {
  const result = await runGuardedTick();
  console.log(JSON.stringify({
    event: result?.skipped ? 'tick-skipped' : 'run-complete',
    testMode: result?.testMode === true,
    dryRun: result?.testMode === true,
    generatedAt: result?.generatedAt,
    reason: result?.reason,
    positionsMonitored: Array.isArray(result?.positionMonitors) ? result.positionMonitors.length : 0,
    candidatesVisible: Array.isArray(result?.potentialStocks) ? result.potentialStocks.length : null,
    pretradeReady: result?.pretradeReadiness?.ready ?? false,
    top100Complete: result?.pretradeReadiness?.completeCount ?? 0,
    top100Incomplete: result?.pretradeReadiness?.incompleteCount ?? 0,
  }));
}

if (require.main === module) main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

module.exports = { buildSafeTestNow, runGuardedTick, saveReadiness };
