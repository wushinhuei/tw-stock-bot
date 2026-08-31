'use strict';

const { CONFIG } = require('./config');
const { scoreCandidate } = require('./scoring');
const { scoreChipSignals } = require('./chip');

function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 0));
}

function candidateSelectionScore(row, volumeRank, poolSize, config = CONFIG) {
  const weights = config.candidateSelectionWeights || { chip: 0.5, volume: 0.3, momentum: 0.2 };
  const chipInput = row.chipSignals || row.metrics?.chip || row.chip || {};
  const chipFraction = scoreChipSignals(chipInput, row.chipOk ? 1 : 0).score / 15;
  const volumeFraction = clamp((poolSize - volumeRank + 1) / poolSize);
  const changePct = Number(row.changePct ?? row.priceChangePct ?? row.metrics?.priceChangePct);
  const momentumFraction = Number.isFinite(changePct) ? clamp((changePct + 0.05) / 0.10) : 0.5;
  const total = 100 * (weights.chip * chipFraction + weights.volume * volumeFraction + weights.momentum * momentumFraction);
  return {
    total: Math.round(total * 100) / 100,
    chip: Math.round(chipFraction * 50 * 100) / 100,
    volume: Math.round(volumeFraction * 30 * 100) / 100,
    momentum: Math.round(momentumFraction * 20 * 100) / 100
  };
}

function buildUniverse(volumeRows, enrichmentBySymbol = {}, config = CONFIG) {
  const pool = [...volumeRows]
    .filter(row => row.market === 'TWSE' && row.securityType === 'COMMON_STOCK')
    .sort((a, b) => Number(b.volume) - Number(a.volume))
    .slice(0, config.rawVolumeReviewLimit)
    .map((row, index) => {
      const enriched = { ...row, ...(enrichmentBySymbol[row.symbol] || {}), volumeRank: index + 1 };
      return { ...enriched, selectionScore: candidateSelectionScore(enriched, index + 1, config.candidateSelectionPoolLimit, config) };
    })
    .slice(0, config.candidateSelectionPoolLimit);
  const chipAligned = enrichmentBySymbol._meta?.alignedToUniverseDate !== false;
  const selected = chipAligned
    ? pool.sort((a, b) => b.selectionScore.total - a.selectionScore.total || a.volumeRank - b.volumeRank)
    : pool.sort((a, b) => a.volumeRank - b.volumeRank);
  return selected.slice(0, config.maxCandidates).map(row => ({ ...row, ...scoreCandidate(row) }));
}

module.exports = { buildUniverse, candidateSelectionScore };
