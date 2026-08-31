'use strict';

const { CONFIG } = require('./config');
const { scoreCandidate } = require('./scoring');

function buildUniverse(volumeRows, enrichmentBySymbol = {}, config = CONFIG) {
  return [...volumeRows]
    .filter(row => row.market === 'TWSE' && row.securityType === 'COMMON_STOCK')
    .sort((a, b) => Number(b.volume) - Number(a.volume))
    .slice(0, config.rawVolumeReviewLimit)
    .slice(0, config.topVolumeLimit)
    .slice(0, config.maxCandidates)
    .map((row, index) => {
      const enriched = { ...row, ...(enrichmentBySymbol[row.symbol] || {}), volumeRank: index + 1 };
      return { ...enriched, ...scoreCandidate(enriched) };
    });
}

module.exports = { buildUniverse };
