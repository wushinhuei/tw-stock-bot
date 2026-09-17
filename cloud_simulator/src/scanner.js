'use strict';

const { CONFIG } = require('./config');
const { scoreCandidate } = require('./scoring');
const { scoreMotherPool } = require('./universe_liquidity');

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

function candidateSelectionScore(row, rankOrConfig = CONFIG, poolLimit) {
  const config = rankOrConfig && typeof rankOrConfig === 'object' ? rankOrConfig : CONFIG;
  const volumeRank = Number(typeof rankOrConfig === 'number' ? rankOrConfig : row.volumeRank || config.candidateSelectionPoolLimit);
  const sourceLimit = Number(poolLimit || config.candidateSelectionPoolLimit || 50);
  const weights = config.candidateSelectionWeights || { chip: 0.50, technical: 0.30, liquidity: 0.20 };
  const scored = row.score != null && row.components ? row : { ...row, ...scoreCandidate(row) };
  const components = scored.components || {};

  // 這組權重只決定 Top10 觀察順位；正式交易仍使用完整 100 分心法。
  const chipFraction = row.chipSelectionScore != null
    ? clamp(row.chipSelectionScore)
    : row.chipScore != null ? clamp(row.chipScore) : row.chipOk === true ? 1 : clamp(Number(components.chip || 0) / 18);
  const liquidityFraction = clamp(Number(row.liquidityScore || 0) / 100);
  const changePct = Number(row.priceChangePct ?? row.changePct);
  const momentumFraction = Number.isFinite(changePct) ? clamp((changePct + 0.05) / 0.10) : 0.5;

  const chip = chipFraction * 100 * weights.chip;
  const technical = momentumFraction * 100 * weights.technical;
  const liquidity = liquidityFraction * 100 * weights.liquidity;
  const total = chip + technical + liquidity;

  return {
    total: Math.round(total * 100) / 100,
    chip: Math.round(chip * 100) / 100,
    technical: Math.round(technical * 100) / 100,
    liquidity: Math.round(liquidity * 100) / 100,
  };
}

function buildUniverse(volumeRows, enrichmentBySymbol = {}, config = CONFIG) {
  // 第一層：只建立「可交易且具流動性」的 Top50 母池。
  // Top50 本身不代表優質股，更不代表交易訊號。
  const pool = scoreMotherPool(volumeRows, {
    coreLimit: config.coreLiquidityLimit,
    emergingLimit: config.emergingLiquidityLimit,
    minimumActiveDays: config.motherPoolMinActiveDays,
  })
    .map(row => ({ ...row, ...(enrichmentBySymbol[row.symbol] || {}) }))
    .filter(isTradableUniverseRow)
    .map((row, index) => {
      const scored = { ...row, volumeRank: index + 1, ...scoreCandidate(row) };
      return { ...scored, selectionScore: candidateSelectionScore(scored, config) };
    })
    .slice(0, config.candidateSelectionPoolLimit);

  // 第二層：Top50 內依籌碼、技術動能與流動性品質排觀察順位。
  return pool
    .sort((a, b) => b.selectionScore.total - a.selectionScore.total || a.volumeRank - b.volumeRank)
    .slice(0, config.maxCandidates);
}

module.exports = { buildUniverse, candidateSelectionScore, isTradableUniverseRow };
