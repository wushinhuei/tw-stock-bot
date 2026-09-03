'use strict';

const { enrichCandidatesWithLiveScores } = require('./live_scoring');
const { repositoryFromEnvironment } = require('./main');
const { blockEntriesForPretradeReadiness, preparePretradeTop100 } = require('./pretrade_prepare');
const { runTickWithHoldings } = require('./run_tick_with_holdings');

async function saveReadiness(repository, report) {
  const stored = await repository.loadState().catch(() => ({}));
  await repository.saveState({ ...stored, pretradeReadiness: report });
}

async function runGuardedTick(options = {}) {
  const now = options.now || new Date();
  const repository = options.repository || repositoryFromEnvironment();

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
    enrichCandidates: guardedScorer,
  });

  // runTickWithHoldings 會保存 account/candidateRanking；再把盤前完整性報告合併回狀態，避免被覆寫。
  await saveReadiness(repository, report).catch(() => {});
  if (result && typeof result === 'object') {
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
    generatedAt: result?.generatedAt,
    reason: result?.reason,
    pretradeReady: result?.pretradeReadiness?.ready ?? false,
    top100Complete: result?.pretradeReadiness?.completeCount ?? 0,
    top100Incomplete: result?.pretradeReadiness?.incompleteCount ?? 0,
  }));
}

if (require.main === module) main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

module.exports = { runGuardedTick, saveReadiness };
