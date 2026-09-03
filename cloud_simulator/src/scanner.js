'use strict';

const { CONFIG } = require('./config');
const { scoreCandidate } = require('./scoring');

function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 0));
}

function isTradableUniverseRow(row) {
  if (row.market !== 'TWSE' || row.securityType !== 'COMMON_STOCK') return false;
  if (!(Number(row.volume) > 0)) return false;
  if (row.dispositionActive || row.tradingSuspended || row.alteredTradingMethod) return false;
  const chip = row.chipSignals || row.metrics?.chip || {};
  if (chip.dispositionActive || chip.tradingSuspended || chip.alteredTradingMethod) return false;
  return true;
}

function candidateSelectionScore(row, config = CONFIG) {
  const weights = config.candidateSelectionWeights || { chip: 0.30, technical: 0.30, fundamental: 0.25, news: 0.15 };
  const scored = row.score != null && row.components ? row : { ...row, ...scoreCandidate(row) };
  const components = scored.components || {};

  // 正式評分中的各面向先標準化成 0~1，再依觀察名單權重重新加權。
  const chipFraction = clamp(Number(components.chip || 0) / 15);
  const technicalFraction = clamp((Number(components.technical || 0) + Number(components.volumeObv || 0)) / 55);
  const fundamentalFraction = clamp(Number(components.fundamental || 0) / 10);
  const newsFraction = clamp(Number(components.officialNews || 0) / 15);

  const chip = chipFraction * 100 * weights.chip;
  const technical = technicalFraction * 100 * weights.technical;
  const fundamental = fundamentalFraction * 100 * weights.fundamental;
  const news = newsFraction * 100 * weights.news;
  const total = chip + technical + fundamental + news;

  return {
    total: Math.round(total * 100) / 100,
    chip: Math.round(chip * 100) / 100,
    technical: Math.round(technical * 100) / 100,
    fundamental: Math.round(fundamental * 100) / 100,
    news: Math.round(news * 100) / 100,
  };
}

function buildUniverse(volumeRows, enrichmentBySymbol = {}, config = CONFIG) {
  // 第一層：只建立「可交易且具流動性」的 Top100 母池。
  // Top100 本身不代表優質股，更不代表交易訊號。
  const pool = [...volumeRows]
    .map(row => ({ ...row, ...(enrichmentBySymbol[row.symbol] || {}) }))
    .filter(isTradableUniverseRow)
    .sort((a, b) => Number(b.volume) - Number(a.volume))
    .slice(0, config.rawVolumeReviewLimit)
    .map((row, index) => {
      const scored = { ...row, volumeRank: index + 1, ...scoreCandidate(row) };
      return { ...scored, selectionScore: candidateSelectionScore(scored, config) };
    })
    .slice(0, config.candidateSelectionPoolLimit);

  // 第二層：Top100 內只用四大面向排觀察順位。
  // 成交量只負責進入母池，不再重複主導 Top30 排名。
  return pool
    .sort((a, b) => b.selectionScore.total - a.selectionScore.total || a.volumeRank - b.volumeRank)
    .slice(0, config.maxCandidates);
}

module.exports = { buildUniverse, candidateSelectionScore, isTradableUniverseRow };
