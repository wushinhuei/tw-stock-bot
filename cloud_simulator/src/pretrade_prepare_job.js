'use strict';

const { preparePretradeTop100 } = require('./pretrade_prepare');
const { repositoryFromEnvironment } = require('./main');

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
  const report = await preparePretradeTop100({ now });
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
    activeTop100Count: report.activeTop100Count,
    completeCount: report.completeCount,
    incompleteCount: report.incompleteCount,
    incompleteSymbols: report.incompleteSymbols,
    globalErrors: report.globalErrors,
  }));
  if (!report.ready) process.exitCode = 2;
}

if (require.main === module) main().catch(error => {
  console.error(error);
  process.exitCode = 1;
});

module.exports = { runPretradePrepareJob, saveReadiness };
