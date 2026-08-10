const { CONFIG } = require('./strategy_config');

function pct(value) {
  if (value == null || Number.isNaN(value)) return 'N/A';
  return `${(value * 100).toFixed(2)}%`;
}

function evaluateMarket(market) {
  const close = Number(market.close);
  const ma20 = Number(market.ma20);
  const ma50 = Number(market.ma50);
  const above20 = close > ma20;
  const above50 = close > ma50;

  if (above20 && above50) {
    return {
      mode: 'AGGRESSIVE',
      label: '積極做多',
      maxGrade: 'A',
      reasons: ['加權指數站上 20MA 與 50MA'],
      above20,
      above50,
    };
  }

  if (!above50) {
    return {
      mode: 'DEFENSIVE',
      label: '防守觀察',
      maxGrade: 'C',
      reasons: ['加權指數跌破 50MA，不做突破追價'],
      above20,
      above50,
    };
  }

  return {
    mode: 'LIGHT',
    label: '輕倉觀察',
    maxGrade: 'B',
    reasons: ['加權指數跌破 20MA，只能輕倉或只做高品質訊號'],
    above20,
    above50,
  };
}

function evaluateLossLimits(portfolio) {
  const dailyPct = Number(portfolio.dailyRealizedPnlPct || 0);
  const weeklyPct = Number(portfolio.weeklyRealizedPnlPct || 0);
  const stops = [];

  if (dailyPct <= CONFIG.risk.dailyStopLossPct) {
    stops.push(`單日虧損 ${pct(dailyPct)} 已達停手機制`);
  }

  if (weeklyPct <= CONFIG.risk.weeklyStopLossPct) {
    stops.push(`單週虧損 ${pct(weeklyPct)}，本週/下週訊號最多半倉或模擬`);
  }

  return {
    dailyPct,
    weeklyPct,
    isDailyStopped: dailyPct <= CONFIG.risk.dailyStopLossPct,
    isWeeklyLimited: weeklyPct <= CONFIG.risk.weeklyStopLossPct,
    stops,
  };
}

function evaluateGroupStrength(candidate, groups = {}) {
  const group = groups[candidate.group] || {};
  const strongPeers = Number(group.strongPeers || 0);
  const isStrong = strongPeers >= CONFIG.groupStrength.minStrongPeers;
  return {
    isStrong,
    strongPeers,
    note: isStrong
      ? `同族群 ${strongPeers} 檔同步轉強`
      : `同族群僅 ${strongPeers} 檔轉強，孤軍風險較高`,
  };
}

function isInBreakoutCooldown(candidate, breakoutHistory = {}, reportDate) {
  if (!CONFIG.breakoutCooldown.enabled) return null;
  const events = breakoutHistory[candidate.symbol] || [];
  const reportTime = new Date(reportDate).getTime();
  if (!Number.isFinite(reportTime)) return null;

  return events.find(event => {
    if (!event.fakeBreakoutDate) return false;
    if (event.lineKey && candidate.lineKey && event.lineKey !== candidate.lineKey) return false;
    const eventTime = new Date(event.fakeBreakoutDate).getTime();
    if (!Number.isFinite(eventTime)) return false;
    const days = Math.floor((reportTime - eventTime) / 86400000);
    return days >= 0 && days <= CONFIG.breakoutCooldown.cooldownDaysMax;
  }) || null;
}

function evaluateCandidateSignals(candidate, groupStrength) {
  const passed = [];
  const missing = [];

  const checks = [
    ['industry', candidate.industryOk, '產業題材/供應鏈位置'],
    ['fundamental', candidate.fundamentalOk, '基本面品質'],
    ['chip', candidate.chipOk, '5日與20日籌碼同步為正'],
    ['trend', candidate.trendOk, '均線與趨勢'],
    ['volumePrice', candidate.volumePriceOk, '量價突破'],
    ['momentum', candidate.momentumOk, 'MACD/RSI 動能'],
  ];

  checks.forEach(([, ok, label]) => {
    if (ok) passed.push(label);
    else missing.push(label);
  });

  if (groupStrength.isStrong) passed.push('族群同步轉強');
  else missing.push('族群同步轉強');

  return { passed, missing };
}

function rawGrade(candidate, signals) {
  const hasCoreBacking = candidate.industryOk || candidate.fundamentalOk || candidate.chipOk;
  const allResonance = [
    candidate.industryOk,
    candidate.fundamentalOk,
    candidate.chipOk,
    candidate.trendOk,
    candidate.volumePriceOk,
    candidate.momentumOk,
  ].every(Boolean);

  if (allResonance) return 'A';
  if (candidate.trendOk && candidate.volumePriceOk && candidate.momentumOk && hasCoreBacking) return 'B';
  if (candidate.trendOk || candidate.volumePriceOk || candidate.momentumOk || signals.passed.length > 0) return 'C';
  return 'C';
}

function capGradeByMarket(grade, marketState) {
  const order = ['C', 'B', 'A'];
  const gradeIndex = order.indexOf(grade);
  const maxIndex = order.indexOf(marketState.maxGrade);
  if (gradeIndex < 0 || maxIndex < 0) return grade;
  return order[Math.min(gradeIndex, maxIndex)];
}

function evaluateCandidate(candidate, context) {
  const groupStrength = evaluateGroupStrength(candidate, context.groups);
  const cooldown = isInBreakoutCooldown(candidate, context.breakoutHistory, context.date);
  const signals = evaluateCandidateSignals(candidate, groupStrength);
  const blockedReasons = [];

  if (context.lossLimits.isDailyStopped) {
    blockedReasons.push('已觸發單日最大虧損，停止交易');
  }

  if (cooldown) {
    blockedReasons.push(`假突破冷卻中：${cooldown.fakeBreakoutDate} 跌回 ${cooldown.lineKey || '關鍵價'} 下方`);
  }

  if (candidate.eventRisk) {
    blockedReasons.push(`事件風險：${candidate.eventRisk}`);
  }

  if (context.marketState.mode === 'DEFENSIVE') {
    blockedReasons.push('大盤跌破 50MA，禁止突破追價');
  }

  let grade = rawGrade(candidate, signals);
  const raw = grade;
  grade = capGradeByMarket(grade, context.marketState);

  if (context.lossLimits.isWeeklyLimited && grade === 'A') {
    grade = 'B';
  }

  if (blockedReasons.length) {
    grade = 'BLOCKED';
  }

  const positionPct = grade === 'A'
    ? CONFIG.risk.standardPositionPct
    : grade === 'B'
      ? CONFIG.risk.halfPositionPct
      : 0;

  return {
    ...candidate,
    rawGrade: raw,
    grade,
    canBuy: CONFIG.grades[grade].canBuy,
    positionLabel: CONFIG.grades[grade].positionLabel,
    positionPct,
    groupStrength,
    signals,
    blockedReasons,
    cooldown,
  };
}

function evaluateWatchlist(input) {
  const marketState = evaluateMarket(input.market);
  const lossLimits = evaluateLossLimits(input.portfolio || {});
  const context = {
    date: input.date,
    groups: input.groups || {},
    breakoutHistory: input.breakoutHistory || {},
    marketState,
    lossLimits,
  };
  const candidates = (input.candidates || []).map(candidate => evaluateCandidate(candidate, context));
  candidates.sort((a, b) => {
    const order = { A: 0, B: 1, C: 2, BLOCKED: 3 };
    return (order[a.grade] ?? 9) - (order[b.grade] ?? 9) || a.symbol.localeCompare(b.symbol);
  });
  return { date: input.date, marketState, lossLimits, candidates };
}

module.exports = {
  evaluateMarket,
  evaluateLossLimits,
  evaluateGroupStrength,
  isInBreakoutCooldown,
  evaluateCandidate,
  evaluateWatchlist,
  pct,
};

