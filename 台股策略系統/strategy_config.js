const CONFIG = {
  market: {
    indexName: 'TAIEX',
    aggressiveAbove: ['ma20', 'ma50'],
    lightBelow: 'ma20',
    defensiveBelow: 'ma50',
  },
  risk: {
    dailyStopLossPct: -0.02,
    weeklyStopLossPct: -0.05,
    standardPositionPct: 0.20,
    halfPositionPct: 0.10,
    observePositionPct: 0,
    perTradeRiskPctMin: 0.01,
    perTradeRiskPctMax: 0.02,
  },
  groupStrength: {
    minStrongPeers: 2,
  },
  breakoutCooldown: {
    enabled: true,
    cooldownDaysMin: 1,
    cooldownDaysMax: 3,
  },
  technical: {
    minBreakoutVolumeRatio: 2,
    rsiBullLine: 50,
    idealChip20MinPct: 1,
    idealChip20MaxPct: 5,
  },
  grades: {
    A: {
      positionLabel: '標準部位',
      canBuy: true,
    },
    B: {
      positionLabel: '半部位',
      canBuy: true,
    },
    C: {
      positionLabel: '只觀察',
      canBuy: false,
    },
    BLOCKED: {
      positionLabel: '禁止交易',
      canBuy: false,
    },
  },
};

module.exports = { CONFIG };

