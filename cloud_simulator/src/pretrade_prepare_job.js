'use strict';

const { preparePretradeTop50 } = require('./pretrade_prepare');
const { repositoryFromEnvironment } = require('./main');
const { syncTop10DailyHistory, top10DailyStoreFromEnvironment } = require('./top10_daily_history');

async function saveReadiness(repository, report) {
  const stored = await repository.loadState().catch(() => ({}));
  await repository.saveState({
    ...stored,
    pretradeReadiness: report,
    pretradePreparationSchedule: {
      timezone: 'Asia/Taipei',
      afterClose: '14:00',
      preOpen: '08:00',
      note: '前一交易日收盤後先準備一次，交易日08:00再刷新一次。',
    },
  });
}

async function runPretradePrepareJob(options = {}) {
  const now = options.now || new Date();
  const repository = options.repository || repositoryFromEnvironment();
  const report = await preparePretradeTop50({ now });
  const historyStore = options.historyStore === undefined ? top10DailyStoreFromEnvironment() : options.historyStore;
  if (historyStore && report.dataTradeDate) {
    const history = await syncTop10DailyHistory({
      candidates: report.checks,
      tradeDate: report.dataTradeDate,
      now,
      store: historyStore,
      fetchDaily: options.fetchDaily
    });
    report.top10DailyHistory = history;
    if (!history.complete) {
      report.ready = false;
      report.globalErrors.push('top10_daily_history_incomplete');
    }
  }
  await saveReadiness(repository, report);
  return report;
}

async function main() {
  const report = await runPretradePrepareJob();
  console.log(JSON.stringify({
    event: 'pretrade-prepare-complete',
    generatedAt: report.generatedAt,
    ready: report.ready,
    dataTradeDate: report.dataTradeDate || null,
    activeTop50Count: report.activeTop50Count,
    completeCount: report.completeCount,
    incompleteCount: report.incompleteCount,
    incompleteSymbols: report.incompleteSymbols,
    globalErrors: report.globalErrors,
    top10DailyHistoryComplete: report.top10DailyHistory?.complete ?? null,
    top10DailyHistoryTradeDate: report.top10DailyHistory?.tradeDate || null,
  }));
  if (!report.ready) process.exitCode = 2;
}

if (require.main === module) main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

module.exports = { runPretradePrepareJob, saveReadiness };
