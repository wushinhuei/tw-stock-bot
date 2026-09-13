'use strict';

const { CONFIG } = require('./config');
const { loadCandidates } = require('./main');

async function preparePretradeTop50(options = {}) {
  const now = options.now || new Date();
  const expected = Number(options.expectedCount || CONFIG.maxCandidates || 10);
  const candidates = await (options.loadCandidates || loadCandidates)({ now, ...(options.marketOptions || {}) });
  const checks = (candidates || []).map(candidate => ({
    symbol: candidate.symbol, name: candidate.name || candidate.symbol, ready: true,
    quoteSource: candidate.provider || candidate.metrics?.marketDataSource || 'TWSE_MCP',
    sourceTimestamp: candidate.timestamp || candidate.metrics?.sourceTimestamp || null,
    missing: candidate.fundamentalScore ? [] : ['fundamental_summary']
  }));
  return {
    ready: checks.length >= expected, generatedAt: now.toISOString(), dataTradeDate: candidates?.[0]?.tradeDate || null,
    activeTop50Count: Number(CONFIG.candidateSelectionPoolLimit), completeCount: checks.length,
    incompleteCount: 0, incompleteSymbols: [], globalErrors: checks.length >= expected ? [] : [`top10_count:${checks.length}/${expected}`],
    policy: {
      universe: 'TWSE MCP MI_INDEX上市普通股成交量Top50；不依賴Drive或analysis_ready',
      ranking: 'Top50內按籌碼50%、成交量30%、動能20%取Top10',
      fundamental: 'MOPS MCP當下摘要；缺漏給0分並標示，不啟動歷史回填',
      tradingGate: '個別報價過期或風險阻擋才禁止該股票下單，不以Drive完整性阻擋全池'
    }, checks
  };
}

function blockEntriesForPretradeReadiness(candidates) { return candidates || []; }

const preparePretradeTop100 = preparePretradeTop50;
module.exports = { blockEntriesForPretradeReadiness, preparePretradeTop50, preparePretradeTop100 };
