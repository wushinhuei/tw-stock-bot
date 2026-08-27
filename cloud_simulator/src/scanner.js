'use strict';

const { CONFIG } = require('./config');
const { scoreCandidate } = require('./scoring');

const TARGET_GROUPS = new Set(['AI設備', '半導體', '電力', '機器人', '自動化', '機器人／自動化']);

function buildUniverse(volumeRows, enrichmentBySymbol = {}, config = CONFIG) {
  return [...volumeRows]
    .filter(row => row.market === 'TWSE' && row.securityType === 'COMMON_STOCK')
    .sort((a, b) => Number(b.volume) - Number(a.volume))
    .slice(0, config.rawVolumeReviewLimit)
    .slice(0, config.topVolumeLimit)
    .filter(row => TARGET_GROUPS.has(row.group))
    .slice(0, config.maxCandidates)
    .map((row, index) => {
      const enriched = { ...row, ...(enrichmentBySymbol[row.symbol] || {}), volumeRank: index + 1 };
      return { ...enriched, ...scoreCandidate(enriched) };
    });
}

module.exports = { TARGET_GROUPS, buildUniverse };
