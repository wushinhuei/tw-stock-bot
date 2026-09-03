'use strict';

function minutes(time) { const [h, m] = String(time).split(':').map(Number); return h * 60 + m; }
function within(time, start, end) { const value = minutes(time); return value >= minutes(start) && value <= minutes(end); }

function entryDecision(candidate, strategy, context, config) {
  const reasons = [];
  if (candidate.grade !== 'A') reasons.push('僅允許A級進場');
  if (candidate.dataStatus && candidate.dataStatus !== 'COMPLETE') reasons.push('交易資料未完整');
  if (candidate.blockedReasons && candidate.blockedReasons.length) reasons.push(...candidate.blockedReasons);
  if (context.marketMode === 'DEFENSIVE') reasons.push('大盤防守');
  if (context.sameSymbolStrategy && context.sameSymbolStrategy !== strategy) reasons.push('同股已有其他策略部位');
  if (context.dailyStopped || context.weeklyStopped) reasons.push('帳戶風控已觸發');
  if (strategy === 'DAY_TRADE' && !within(context.time, config.tradingStart, config.dayTradeEntryCutoff)) reasons.push('不在當沖進場時段');
  if (strategy === 'OVERNIGHT') {
    if (!within(context.time, config.overnightEntryStart, config.forcedExitStart)) reasons.push('不在隔日沖進場時段');
    if (!candidate.closeNearHigh) reasons.push('尾盤未接近當日高點');
    if (Number(candidate.intradayReturnPct || 0) > 0.035) reasons.push('尾盤漲幅超過3.5%');
    if (Number(candidate.volumeRatio || 0) < 1) reasons.push('成交量不足');
  }
  return { allowed: reasons.length === 0, reasons };
}

function exitDecision(position, candidate, context, config) {
  const price = Number(candidate.bidPrice || candidate.price || 0);
  if (!Number.isFinite(price) || price <= 0) return { exit: false, emergency: false, reason: '無有效執行報價' };
  const pnlPct = position.averagePrice ? price / position.averagePrice - 1 : 0;
  if (position.strategy === 'DAY_TRADE') {
    if (pnlPct <= -0.01) return { exit: true, emergency: true, reason: '當沖停損-1%' };
    if (pnlPct >= 0.015) return { exit: true, emergency: false, reason: '當沖停利+1.5%' };
    if (minutes(context.time) >= minutes(config.forcedExitStart)) return { exit: true, emergency: true, reason: '13:20當沖強制平倉' };
  }
  if (position.strategy === 'OVERNIGHT') {
    if (pnlPct <= -0.02 || price < Number(position.previousClose || 0)) return { exit: true, emergency: true, reason: '隔日沖停損或跌破前收' };
    if (pnlPct >= 0.03) return { exit: true, emergency: false, reason: '隔日沖停利+3%' };
    if (position.holdingDays >= 3 && minutes(context.time) >= minutes(config.forcedExitStart)) return { exit: true, emergency: true, reason: '隔日沖第三日強制退出' };
  }
  if (position.strategy === 'SWING') {
    const high = Math.max(Number(position.highestPrice || position.averagePrice), price);
    if (price <= Number(position.stopPrice)) return { exit: true, emergency: true, reason: '波段初始停損' };
    if (position.partialTaken && (price <= high * 0.96 || (candidate.metrics && price < Number(candidate.metrics.ma20 || 0)))) return { exit: true, emergency: false, reason: '波段移動停利或跌破MA20' };
    if (!position.partialTaken && pnlPct >= 0.08) return { exit: true, partial: true, emergency: false, reason: '波段+8%先賣一半' };
  }
  return { exit: false, emergency: false, reason: '' };
}

function canAddOn(position, candidate, account, config) {
  if (position.strategy !== 'SWING' || position.addOnCount >= 1 || candidate.grade !== 'A') return false;
  if (candidate.dataStatus && candidate.dataStatus !== 'COMPLETE') return false;
  if (Array.isArray(candidate.blockedReasons) && candidate.blockedReasons.length) return false;
  if (Number(candidate.price) < Number(position.lastEntryPrice) * 1.02) return false;
  if (!candidate.metrics || !candidate.metrics.obv || !candidate.metrics.obv.bullish) return false;
  const currentPct = Number(position.marketValue || 0) / Number(account.equity || 1);
  return currentPct + config.addOnPct <= config.maxSymbolPct;
}

module.exports = { canAddOn, entryDecision, exitDecision, minutes, within };
