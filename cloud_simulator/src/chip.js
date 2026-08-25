'use strict';

const { clamp } = require('./indicators');

function finite(value) {
  if (value == null || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function scoreChipSignals(signals, fallbackScore = 0) {
  const chip = signals || {};
  const hasDetailedData = Boolean(chip.institutional || chip.margin || chip.shortLending || finite(chip.dayTradeRatio) != null);
  if (!hasDetailedData) return { score: Math.round(clamp(fallbackScore, 0, 1) * 15), details: null };

  const institutional = chip.institutional || {};
  const totalNet = finite(institutional.totalNet);
  const foreignNet = finite(institutional.foreignNet);
  const trustNet = finite(institutional.trustNet);
  const institutionalRatio = finite(chip.institutionalNetRatio);
  let institutionalPoints = 3;
  if (totalNet != null) {
    institutionalPoints = totalNet > 0 ? 4 : totalNet < 0 ? 1 : 2;
    if ((foreignNet || 0) > 0 || (trustNet || 0) > 0) institutionalPoints += 1;
    if ((institutionalRatio || 0) >= 0.03) institutionalPoints += 1;
  }

  const marginRatio = finite(chip.marginChangeRatio);
  const marginPoints = marginRatio == null ? 2 : marginRatio <= 0 ? 3 : marginRatio <= 0.02 ? 2 : marginRatio <= 0.05 ? 1 : 0;
  const shortRatio = Math.max(
    finite(chip.shortChangeRatio) ?? -Infinity,
    finite(chip.securitiesLendingChangeRatio) ?? -Infinity
  );
  const shortPoints = shortRatio === -Infinity ? 2 : shortRatio <= 0 ? 3 : shortRatio <= 0.03 ? 2 : shortRatio <= 0.08 ? 1 : 0;
  const dayTradeRatio = finite(chip.dayTradeRatio);
  const dayTradePoints = dayTradeRatio == null ? 2 : dayTradeRatio <= 0.35 ? 3 : dayTradeRatio <= 0.50 ? 2 : dayTradeRatio <= 0.60 ? 1 : 0;
  const score = clamp(Math.min(6, institutionalPoints) + marginPoints + shortPoints + dayTradePoints, 0, 15);
  return { score, details: { institutionalPoints: Math.min(6, institutionalPoints), marginPoints, shortPoints, dayTradePoints } };
}

function executionRiskReasons(input) {
  const reasons = [];
  const chip = input.chipSignals || input.metrics?.chip || {};
  if (input.dispositionActive || chip.dispositionActive) reasons.push('證交所處置股票，阻擋新交易');
  if (input.tradingSuspended || chip.tradingSuspended) reasons.push('證交所暫停交易，阻擋新交易');
  if (input.alteredTradingMethod || chip.alteredTradingMethod) reasons.push('變更交易方法股票，阻擋新交易');
  if (input.noticeActive || chip.noticeActive) {
    const notice = String(input.noticeReason || chip.noticeReason || '官方注意交易資訊');
    reasons.push(`證交所注意股票：${notice}`);
  }
  if ((input.strategy || 'SWING') === 'DAY_TRADE' && (input.dayTradeEligible === false || chip.dayTradeEligible === false)) {
    reasons.push('非當日沖銷標的或已暫停先賣後買');
  }
  if (Number(chip.dayTradeRatio) > 0.60) reasons.push('近一期當沖成交量占比超過60%');
  return [...new Set(reasons)];
}

module.exports = { executionRiskReasons, scoreChipSignals };
