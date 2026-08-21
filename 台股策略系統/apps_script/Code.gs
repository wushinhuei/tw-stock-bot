const SETTINGS_SPREADSHEET_ID = '1TLouSeqNnj6K0xgl9-euBtLOEoj-hSHgJuZMtWQgopA';
const SETTINGS_SHEET_NAME = '策略設定';
const LOG_SHEET_NAME = '設定異動紀錄';
const WEEKLY_REPORT_SHEET_NAME = '週檢討報告';
const THIRTY_DAY_REPORT_SHEET_NAME = '30日檢討報告';
const STATE_KEY = 'TW_STOCK_SIM_STATE';

const DEFAULT_SETTINGS = {
  initialCapital: 100000,
  monthlyTargetReturnMin: 0.03,
  monthlyTargetReturnMax: 0.05,
  minCashReservePct: 0.3,
  cashCautionPct: 0.4,
  standardPositionPct: 0.25,
  halfPositionPct: 0.15,
  dayTradeCapitalPct: 0.25,
  overnightPositionPct: 0.15,
  dailyProfitLockPct: 0.006,
  dailySoftStopLossPct: -0.006,
  dailyStopLossPct: -0.012,
  weeklyStopLossPct: -0.025,
  maxChasePct: 0.008,
  maxMarketOrderSpreadPct: 0.003,
  maxLimitOrderSpreadPct: 0.0015,
  topVolumeLimit: 100,
  maxScanCandidates: 30,
  allowDayTrade: true,
  allowOvernight: true,
  allowChasing: false,
  allowMarketableOrders: false,
  allowAutoBuy: true,
  allowAutoSell: true,
  simulationMode: true
};

function doGet(e) {
  const params = (e && e.parameter) || {};
  const action = params.action || 'read';
  try {
    let payload;
    if (action === 'settings') payload = { ok: true, settings: readSettings() };
    else if (action === 'initSettings') payload = { ok: true, settings: initSettings() };
    else if (action === 'reset') payload = { ok: true, data: resetState() };
    else if (action === 'status') payload = { ok: true, ...readStatus() };
    else if (action === 'refresh') payload = { ok: true, data: refreshData(params.force === '1') };
    else payload = { ok: true, data: readData() };
    return jsonOutput(payload, params.callback);
  } catch (err) {
    return jsonOutput({ ok: false, error: String(err && err.message ? err.message : err) }, params.callback);
  }
}

function initSettings() {
  const ss = SpreadsheetApp.openById(SETTINGS_SPREADSHEET_ID);
  const settingsSheet = getOrCreateSheet_(ss, SETTINGS_SHEET_NAME);
  settingsSheet.clear();
  settingsSheet.getRange(1, 1, 1, 4).setValues([['參數', '目前值', '預設值', '說明']]);
  const rows = Object.keys(DEFAULT_SETTINGS).map((key) => [
    key,
    DEFAULT_SETTINGS[key],
    DEFAULT_SETTINGS[key],
    settingDescription_(key)
  ]);
  settingsSheet.getRange(2, 1, rows.length, 4).setValues(rows);
  settingsSheet.autoResizeColumns(1, 4);

  const logSheet = getOrCreateSheet_(ss, LOG_SHEET_NAME);
  if (logSheet.getLastRow() === 0) logSheet.appendRow(['時間', '參數', '舊值', '新值', '備註']);
  const weeklySheet = getOrCreateSheet_(ss, WEEKLY_REPORT_SHEET_NAME);
  if (weeklySheet.getLastRow() === 0) weeklySheet.appendRow(['週別', '期間', '起始資產', '結束資產', '報酬率', '檢討']);
  const thirtySheet = getOrCreateSheet_(ss, THIRTY_DAY_REPORT_SHEET_NAME);
  if (thirtySheet.getLastRow() === 0) thirtySheet.appendRow(['期間', '起始資產', '結束資產', '報酬率', '交易次數', '檢討']);
  return readSettings();
}

function readSettings() {
  const ss = SpreadsheetApp.openById(SETTINGS_SPREADSHEET_ID);
  const sheet = ss.getSheetByName(SETTINGS_SHEET_NAME);
  if (!sheet) return { ...DEFAULT_SETTINGS };
  const values = sheet.getDataRange().getValues();
  const settings = { ...DEFAULT_SETTINGS };
  for (let i = 1; i < values.length; i += 1) {
    const key = values[i][0];
    if (!key || !(key in DEFAULT_SETTINGS)) continue;
    const parsed = parseSetting_(values[i][1], DEFAULT_SETTINGS[key]);
    settings[key] = parsed;
  }
  return settings;
}

function readData() {
  const state = getState_();
  return state || resetState();
}

function refreshData(force) {
  const settings = readSettings();
  const previous = getState_() || resetState();
  const market = buildMarketSnapshot_();
  const candidates = buildCandidates_(market, settings);
  const next = simulate_(previous, market, candidates, settings, force);
  setState_(next);
  return next;
}

function readStatus() {
  const state = readData();
  return {
    asOf: state.asOf,
    tradeCount: (state.trades || []).length,
    latestTrade: (state.trades || [])[0] || null,
    tradeSignature: state.tradeSignature || ''
  };
}

function resetState() {
  const settings = readSettings();
  const data = {
    asOf: new Date().toISOString(),
    market: buildMarketSnapshot_(),
    candidates: [],
    equity: Number(settings.initialCapital),
    cash: Number(settings.initialCapital),
    initialCapital: Number(settings.initialCapital),
    dailyPnl: 0,
    dailyReturnPct: 0,
    monthlyTargetMinPct: Number(settings.monthlyTargetReturnMin),
    monthlyTargetMaxPct: Number(settings.monthlyTargetReturnMax),
    tradeSignature: `reset-${Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyyMMddHHmmss')}`,
    risk: {
      cashReservePct: 1,
      status: 'normal',
      message: '已重置模擬資金，等待 A 級訊號。'
    },
    positions: [],
    trades: [],
    reports: {
      weekly: '週檢討尚未完成，需累積交易日。',
      thirtyDay: '30 日觀察期自 2026-08-20 起算。'
    }
  };
  setState_(data);
  return data;
}

function buildMarketSnapshot_() {
  const now = new Date();
  const drift = Math.sin(now.getTime() / 86400000) * 0.7;
  return {
    date: Utilities.formatDate(now, 'Asia/Taipei', 'yyyy-MM-dd'),
    indexName: 'TAIEX',
    indexClose: round_(24200 + drift * 120, 2),
    indexChangePct: round_(drift, 2),
    futuresChangePct: round_(drift * 0.7, 2),
    usdTwd: round_(30.2 + drift * 0.04, 2),
    nasdaqChangePct: round_(drift * 0.6, 2),
    soxChangePct: round_(drift * 0.9, 2),
    mood: drift >= 0 ? 'neutral-positive' : 'caution'
  };
}

function buildCandidates_(market, settings) {
  const base = [
    ['2330', '台積電', '半導體', 1180, 1],
    ['2308', '台達電', '電力', 765, 8],
    ['2317', '鴻海', 'AI', 218.5, 5],
    ['2356', '英業達', 'AI', 51.8, 31],
    ['2049', '上銀', '機器人', 292, 42]
  ];
  return base.slice(0, Number(settings.maxScanCandidates || 30)).map((row, index) => {
    const changePct = round_(Number(market.indexChangePct || 0) + (2 - index) * 0.28, 2);
    const score = Math.max(50, Math.round(88 - index * 7 + Number(market.indexChangePct || 0) * 2));
    const grade = score >= 82 ? 'A' : score >= 70 ? 'B' : 'C';
    return {
      symbol: row[0],
      name: row[1],
      group: row[2],
      grade,
      price: row[3],
      changePct,
      volumeRank: row[4],
      score,
      reason: grade === 'A' ? '量價與族群條件通過，仍需風控確認。' : '條件未完全成熟，列入觀察。'
    };
  });
}

function simulate_(previous, market, candidates, settings, force) {
  const positions = previous.positions || [];
  const trades = previous.trades || [];
  const equityBefore = Number(previous.equity || settings.initialCapital);
  let cash = Number(previous.cash || settings.initialCapital);
  let nextPositions = positions.map((position) => ({ ...position }));
  const newTrades = [];
  const cashReservePct = cash / Math.max(equityBefore, 1);
  const aCandidate = candidates.find((candidate) => candidate.grade === 'A');
  const canBuy = settings.simulationMode && settings.allowAutoBuy && aCandidate && cashReservePct > Number(settings.cashCautionPct);

  if (force && canBuy && !nextPositions.some((position) => position.symbol === aCandidate.symbol)) {
    const budget = equityBefore * Number(settings.halfPositionPct || 0.15);
    const shares = Math.floor(budget / aCandidate.price / 1000) * 1000 || Math.floor(budget / aCandidate.price);
    if (shares > 0) {
      const cost = round_(shares * aCandidate.price, 0);
      cash -= cost;
      nextPositions.push({
        symbol: aCandidate.symbol,
        name: aCandidate.name,
        shares,
        avgPrice: aCandidate.price,
        lastPrice: aCandidate.price,
        pnl: 0,
        pnlPct: 0,
        plan: '達日內獲利鎖定或風控停損時出場。'
      });
      newTrades.push({
        time: Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm'),
        action: 'BUY',
        symbol: aCandidate.symbol,
        name: aCandidate.name,
        shares,
        price: aCandidate.price,
        note: '手動刷新觸發模擬進場。'
      });
    }
  }

  nextPositions = nextPositions.map((position) => {
    const matched = candidates.find((candidate) => candidate.symbol === position.symbol);
    const lastPrice = matched ? matched.price : position.lastPrice;
    const pnl = round_((lastPrice - position.avgPrice) * position.shares, 0);
    return { ...position, lastPrice, pnl, pnlPct: round_(pnl / Math.max(position.avgPrice * position.shares, 1), 4) };
  });

  const positionValue = nextPositions.reduce((sum, position) => sum + position.lastPrice * position.shares, 0);
  const equity = round_(cash + positionValue, 0);
  const dailyPnl = round_(equity - equityBefore, 0);
  const signatureSeed = [equity, cash, nextPositions.length, trades.length + newTrades.length, market.date].join('-');

  return {
    asOf: new Date().toISOString(),
    market,
    candidates,
    equity,
    cash: round_(cash, 0),
    initialCapital: Number(settings.initialCapital),
    dailyPnl,
    dailyReturnPct: round_(dailyPnl / Math.max(equityBefore, 1), 4),
    monthlyTargetMinPct: Number(settings.monthlyTargetReturnMin),
    monthlyTargetMaxPct: Number(settings.monthlyTargetReturnMax),
    tradeSignature: Utilities.base64EncodeWebSafe(signatureSeed).slice(0, 24),
    risk: buildRisk_(cash, equity, settings),
    positions: nextPositions,
    trades: newTrades.concat(trades).slice(0, 50),
    reports: {
      weekly: '週檢討：保留現金水位，僅在 A 級條件完整時交易。',
      thirtyDay: '30 日檢討：觀察期內以低交易頻率與回撤控制為優先。'
    }
  };
}

function buildRisk_(cash, equity, settings) {
  const ratio = cash / Math.max(equity, 1);
  if (ratio < Number(settings.minCashReservePct)) {
    return { cashReservePct: round_(ratio, 4), status: 'stop', message: '現金水位低於最低保留，停止新增部位。' };
  }
  if (ratio < Number(settings.cashCautionPct)) {
    return { cashReservePct: round_(ratio, 4), status: 'caution', message: '現金水位偏低，只允許減碼或觀察。' };
  }
  return { cashReservePct: round_(ratio, 4), status: 'normal', message: '現金水位充足，等待 A 級訊號。' };
}

function getState_() {
  const raw = PropertiesService.getScriptProperties().getProperty(STATE_KEY);
  return raw ? JSON.parse(raw) : null;
}

function setState_(data) {
  PropertiesService.getScriptProperties().setProperty(STATE_KEY, JSON.stringify(data));
}

function getOrCreateSheet_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name);
}

function parseSetting_(value, fallback) {
  if (typeof fallback === 'boolean') {
    if (value === true || String(value).toLowerCase() === 'true' || String(value) === '是') return true;
    if (value === false || String(value).toLowerCase() === 'false' || String(value) === '否') return false;
    return fallback;
  }
  if (typeof fallback === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? n : fallback;
  }
  return value || fallback;
}

function settingDescription_(key) {
  const descriptions = {
    initialCapital: '初始模擬資金',
    monthlyTargetReturnMin: '月目標報酬率下緣',
    monthlyTargetReturnMax: '月目標報酬率上緣',
    minCashReservePct: '最低現金保留比率',
    cashCautionPct: '現金警戒比率',
    standardPositionPct: '標準單筆部位比率',
    halfPositionPct: '保守單筆部位比率',
    simulationMode: '只模擬，不真實下單'
  };
  return descriptions[key] || '策略參數';
}

function jsonOutput(payload, callback) {
  const body = callback ? `${callback}(${JSON.stringify(payload)})` : JSON.stringify(payload);
  const mime = callback ? ContentService.MimeType.JAVASCRIPT : ContentService.MimeType.JSON;
  return ContentService.createTextOutput(body).setMimeType(mime);
}

function round_(value, digits) {
  const power = Math.pow(10, digits || 0);
  return Math.round(Number(value || 0) * power) / power;
}

