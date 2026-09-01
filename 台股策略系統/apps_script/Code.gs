const START_DATE = '2026-08-20';
const STATE_KEY = 'TW_STOCK_DASHBOARD_STATE_V1';
const SETTINGS_SPREADSHEET_ID_KEY = 'TW_STOCK_SETTINGS_SPREADSHEET_ID';
const CLOUD_DASHBOARD_URL_KEY = 'TW_STOCK_CLOUD_DASHBOARD_URL';
const DEFAULT_CLOUD_DASHBOARD_URL = 'https://tw-stock-dashboard-api-702657072551.asia-east1.run.app/dashboard';
const CLOUD_ARCHIVE_BUCKET_KEY = 'TW_STOCK_ARCHIVE_BUCKET';
const DRIVE_ARCHIVE_FOLDER_ID_KEY = 'TW_STOCK_DRIVE_ARCHIVE_FOLDER_ID';
const SETTINGS_SHEET_NAME = '策略設定';
const SETTINGS_CHANGE_LOG_SHEET_NAME = '設定異動紀錄';
const WEEKLY_REVIEW_SHEET_NAME = '週檢討報告';
const THIRTY_DAY_REVIEW_SHEET_NAME = '30日檢討報告';
const HOLIDAY_CACHE_PREFIX = 'TWSE_NON_TRADING_DATES_';
const RAW_BASE = 'https://raw.githubusercontent.com/wushinhuei/tw-stock-bot/main/%E5%8F%B0%E8%82%A1%E7%AD%96%E7%95%A5%E7%B3%BB%E7%B5%B1/web/';

const CONFIG = {
  initialCapital: 100000,
  simulationStartDate: START_DATE,
  boardLot: 1,
  standardPositionPct: 0.10,
  halfPositionPct: 0.05,
  minCashReservePct: 0.4,
  cashCautionPct: 0.4,
  dailyStopLossPct: -0.02,
  dailySoftStopLossPct: -0.005,
  dailyProfitLockPct: 0.003,
  weeklyStopLossPct: -0.05,
  dayTradeCapitalPct: 0.15,
  overnightPositionPct: 0.15,
  swingCapitalPct: 0.30,
  dailyNewCapitalPct: 0.20,
  dailyTurnoverPct: 0.40,
  maxSymbolPct: 0.15,
  settlementReservePct: 0.05,
  settlementReserveMin: 5000,
  afterMarketPositionPct: 0.1,
  maxChasePct: 0.003,
  maxMarketOrderSpreadPct: 0.002,
  maxLimitOrderSpreadPct: 0.006,
  rawVolumeReviewLimit: 100,
  candidateSelectionPoolLimit: 50,
  topVolumeLimit: 30,
  maxScanCandidates: 30,
  candidateChipWeight: 0.50,
  candidateVolumeWeight: 0.30,
  candidateMomentumWeight: 0.20,
  monthlyTargetReturnMin: 0.03,
  monthlyTargetReturnMax: 0.05,
  allowDayTrade: false,
  allowOvernight: true,
  allowChasing: true,
  allowMarketableOrders: true,
  allowAutoBuy: true,
  allowAutoSell: true,
  simulationMode: true,
  brokerFeeRate: 0.001425,
  minBrokerFee: 1,
  stockSellTaxRate: 0.003,
  dayTradeSellTaxRate: 0.0015
};

const DEFAULT_CONFIG = Object.assign({}, CONFIG);

const STRATEGY_SETTINGS = [
  ['initialCapital', '初始資金', 'number', CONFIG.initialCapital, '模擬起始資金'],
  ['monthlyTargetReturnMin', '月目標報酬率下限', 'number', CONFIG.monthlyTargetReturnMin, '3% 以 0.03 表示'],
  ['monthlyTargetReturnMax', '月目標報酬率上限', 'number', CONFIG.monthlyTargetReturnMax, '5% 以 0.05 表示'],
  ['minCashReservePct', '最低現金保留比例', 'number', CONFIG.minCashReservePct, '低於此比例不新增部位'],
  ['cashCautionPct', '現金警戒比例', 'number', CONFIG.cashCautionPct, '低於此比例只允許小部位'],
  ['standardPositionPct', '標準單筆部位比例', 'number', CONFIG.standardPositionPct, 'A 級正常買進上限'],
  ['halfPositionPct', '小部位比例', 'number', CONFIG.halfPositionPct, '保守或減碼時使用'],
  ['dayTradeCapitalPct', '當沖資金比例', 'number', CONFIG.dayTradeCapitalPct, '單筆當沖資金上限'],
  ['overnightPositionPct', '隔日沖資金比例', 'number', CONFIG.overnightPositionPct, '隔日沖部位上限'],
  ['swingCapitalPct', '波段資金比例', 'number', CONFIG.swingCapitalPct, '波段總資金上限'],
  ['dailyNewCapitalPct', '每日新增投入上限', 'number', CONFIG.dailyNewCapitalPct, '每日最多新增 20%'],
  ['dailyTurnoverPct', '每日周轉上限', 'number', CONFIG.dailyTurnoverPct, '買賣總周轉最高 40%'],
  ['maxSymbolPct', '單股總持倉上限', 'number', CONFIG.maxSymbolPct, '首次 10% 加碼 5% 合計 15%'],
  ['settlementReservePct', '交割準備金比例', 'number', CONFIG.settlementReservePct, '權益 5%'],
  ['settlementReserveMin', '最低交割準備金', 'number', CONFIG.settlementReserveMin, '至少 5,000 元'],
  ['dailyProfitLockPct', '每日小賺停手', 'number', CONFIG.dailyProfitLockPct, '達到後停止新增風險'],
  ['dailySoftStopLossPct', '日內軟停損', 'number', CONFIG.dailySoftStopLossPct, '達到後停止新增風險'],
  ['dailyStopLossPct', '日內硬停損', 'number', CONFIG.dailyStopLossPct, '達到後進入防守'],
  ['weeklyStopLossPct', '週停損', 'number', CONFIG.weeklyStopLossPct, '週虧損達此比例降低風險'],
  ['maxChasePct', '追價上限', 'number', CONFIG.maxChasePct, '最多追價幅度'],
  ['maxMarketOrderSpreadPct', '市價允許價差', 'number', CONFIG.maxMarketOrderSpreadPct, '價差小於此值才允許類市價'],
  ['maxLimitOrderSpreadPct', '限價最大價差', 'number', CONFIG.maxLimitOrderSpreadPct, '價差超過此值不進場'],
  ['rawVolumeReviewLimit', '成交量原始檢討筆數', 'number', CONFIG.rawVolumeReviewLimit, '每日先檢討成交量前 100 名'],
  ['candidateSelectionPoolLimit', '候選篩選母體筆數', 'number', CONFIG.candidateSelectionPoolLimit, '由成交量前 50 名進行籌碼加權篩選'],
  ['topVolumeLimit', '最終候選筆數', 'number', CONFIG.topVolumeLimit, '籌碼加權後保留 30 名'],
  ['maxScanCandidates', '掃描候選上限', 'number', CONFIG.maxScanCandidates, '最多分析幾檔'],
  ['candidateChipWeight', '候選籌碼權重', 'number', CONFIG.candidateChipWeight, '候選排序占 50%，不改正式籌碼 15 分'],
  ['candidateVolumeWeight', '候選成交量權重', 'number', CONFIG.candidateVolumeWeight, '候選排序占 30%'],
  ['candidateMomentumWeight', '候選價格動能權重', 'number', CONFIG.candidateMomentumWeight, '候選排序占 20%'],
  ['allowDayTrade', '是否允許當沖', 'boolean', CONFIG.allowDayTrade, 'TRUE/FALSE'],
  ['allowOvernight', '是否允許隔日沖', 'boolean', CONFIG.allowOvernight, 'TRUE/FALSE'],
  ['allowChasing', '是否允許追價', 'boolean', CONFIG.allowChasing, 'TRUE/FALSE'],
  ['allowMarketableOrders', '是否允許市價/類市價', 'boolean', CONFIG.allowMarketableOrders, 'TRUE/FALSE'],
  ['allowAutoBuy', '是否允許自動買進', 'boolean', CONFIG.allowAutoBuy, '模擬可 TRUE，實單前需確認'],
  ['allowAutoSell', '是否允許自動賣出', 'boolean', CONFIG.allowAutoSell, '停損/停利模擬'],
  ['simulationMode', '模擬模式', 'boolean', CONFIG.simulationMode, '實單前保持 TRUE']
];

const FALLBACK_UNIVERSE = [
  { symbol: '2382.TW', code: '2382', name: '\u5ee3\u9054', group: 'AI\u8a2d\u5099', industryOk: true, fundamentalOk: true, chipOk: true },
  { symbol: '2049.TW', code: '2049', name: '\u4e0a\u9280', group: '\u6a5f\u5668\u4eba', industryOk: true, fundamentalOk: false, chipOk: false },
  { symbol: '1513.TW', code: '1513', name: '\u4e2d\u8208\u96fb', group: '\u96fb\u529b', industryOk: true, fundamentalOk: true, chipOk: false },
  { symbol: '2330.TW', code: '2330', name: '\u53f0\u7a4d\u96fb', group: '\u534a\u5c0e\u9ad4', industryOk: true, fundamentalOk: true, chipOk: true },
  { symbol: '2454.TW', code: '2454', name: '\u806f\u767c\u79d1', group: '\u534a\u5c0e\u9ad4', industryOk: true, fundamentalOk: true, chipOk: false },
  { symbol: '2317.TW', code: '2317', name: '\u9d3b\u6d77', group: 'AI\u8a2d\u5099', industryOk: true, fundamentalOk: true, chipOk: false },
  { symbol: '2308.TW', code: '2308', name: '\u53f0\u9054\u96fb', group: '\u96fb\u529b', industryOk: true, fundamentalOk: true, chipOk: true },
  { symbol: '2357.TW', code: '2357', name: '\u83ef\u78a9', group: 'AI\u8a2d\u5099', industryOk: true, fundamentalOk: true, chipOk: false }
];

const TARGET_GROUP_RULES = [
  {
    group: 'AI設備',
    keywords: [
      'AI', '人工智慧', '伺服器', '雲端', '散熱', '光通訊', '網通', 'PCB', 'CCL',
      '電源', '機殼', '導軌', '軸承', '廣達', '緯創', '英業達', '鴻海', '華碩',
      '技嘉', '微星', '奇鋐', '雙鴻', '健策', '台光電', '金像電', '欣興', '台達電'
    ]
  },
  {
    group: '電力',
    keywords: ['電力', '電機', '重電', '電纜', '線纜', '變壓器', '能源', '綠能', '電源', '中興電', '華城', '士電', '亞力', '大同', '台達電']
  },
  {
    group: '半導體',
    keywords: ['半導體', '晶圓', '矽', '封測', 'IC', '晶片', '電子', '設備', '材料', '台積電', '聯發科', '聯電', '日月光', '世界', '環球晶', '辛耘', '弘塑', '旺矽', '穎崴']
  },
  {
    group: '機器人',
    keywords: ['機器人', '自動化', '工具機', '傳動', '線軌', '馬達', '伺服', '控制器', '上銀', '直得', '和椿', '所羅門', '新代', '羅昇']
  }
];

const FALLBACK_UNIVERSE_BY_CODE = FALLBACK_UNIVERSE.reduce(function(map, item) {
  map[item.code] = item;
  return map;
}, {});

// Apps Script 編輯器的初始化入口，刻意放在 doGet 前方便從函式選單選取。
function setupMonthlyArchive() {
  return configureMonthlyArchive();
}

function doGet(e) {
  const params = e && e.parameter ? e.parameter : {};
  const action = params.action || 'read';
  const callback = params.callback || '';
  let payload;

  try {
    if ((action === 'read' || action === 'status') && cloudDashboardUrl()) {
      try {
        payload = readCloudDashboard();
      } catch (cloudError) {
        console.warn('Cloud dashboard fallback: ' + String(cloudError));
        payload = action === 'status' ? readStatusPayload() : readOrSeedPayload();
        payload.cloudDashboardFallback = true;
        payload.cloudDashboardError = String(cloudError);
      }
    } else
    if (action === 'status') {
      payload = readStatusPayload();
    } else if (action === 'settings') {
      payload = readSettingsPayload();
    } else if (action === 'initSettings') {
      payload = initializeSettingsWorkbook();
    } else if (action === 'reset') {
      payload = resetDashboardState();
    } else {
      payload = action === 'refresh'
        ? refreshDashboard({ force: params.force === '1' || params.force === 'true' })
        : readOrSeedPayload();
    }
  } catch (error) {
    payload = {
      ok: false,
      error: String(error && error.stack ? error.stack : error),
      generatedAt: new Date().toISOString()
    };
  }

  if (payload && payload.ok !== false && (action === 'read' || action === 'refresh')) {
    try {
      payload.candidateUniverse = readLatestCandidateUniverse();
    } catch (candidateError) {
      payload.candidateUniverse = { ok: false, items: [], error: String(candidateError) };
    }
  }

  if (callback) {
    return ContentService
      .createTextOutput(callback + '(' + JSON.stringify(payload) + ');')
      .setMimeType(ContentService.MimeType.JAVASCRIPT);
  }

  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function cloudDashboardUrl() {
  return String(PropertiesService.getScriptProperties().getProperty(CLOUD_DASHBOARD_URL_KEY) || DEFAULT_CLOUD_DASHBOARD_URL).trim();
}

function readLatestCandidateUniverse() {
  const saved = PropertiesService.getScriptProperties().getProperty(STATE_KEY);
  if (saved) {
    const payload = JSON.parse(saved);
    const day = payload && Array.isArray(payload.scenario) && payload.scenario.length ? last(payload.scenario) : null;
    const candidates = day && Array.isArray(day.candidates)
      ? day.candidates.filter(function(item) { return !item.heldSupplement; }).slice(0, CONFIG.topVolumeLimit)
      : [];
    if (candidates.length) {
      return {
        ok: true, tradeDate: day.date, reviewedCount: CONFIG.candidateSelectionPoolLimit,
        selectedCount: candidates.length, limit: CONFIG.topVolumeLimit,
        generatedAt: day.source && day.source.generatedAt ? day.source.generatedAt : payload.generatedAt,
        selectionWeights: { chip: CONFIG.candidateChipWeight, volume: CONFIG.candidateVolumeWeight, momentum: CONFIG.candidateMomentumWeight },
        items: candidates.map(function(candidate, index) {
          return {
            rank: index + 1, volumeRank: candidate.metrics && candidate.metrics.volumeRank,
            symbol: candidate.symbol, name: candidate.name, volume: candidate.metrics && candidate.metrics.screeningVolume,
            close: candidate.price, selectionScore: candidate.metrics && candidate.metrics.selectionScore
          };
        })
      };
    }
  }
  const manifest = historyReadJson(HISTORY_DRIVE.top50Manifest);
  const latest = (manifest.raw_ranking_files || []).slice().sort(function(a, b) {
    return String(b.latest_trade_date || '').localeCompare(String(a.latest_trade_date || ''));
  })[0];
  if (!latest || !latest.file_id) throw new Error('尚無成交量前 100 名原始排名檔');
  const lines = historyReadText(latest.file_id).replace(/^\uFEFF/, '').trim().split(/\r?\n/);
  const header = historyParseCsvLine(lines[0]);
  const rows = lines.slice(1).map(historyParseCsvLine).filter(function(row) {
    return row[header.indexOf('trade_date')] === latest.latest_trade_date;
  }).slice(0, CONFIG.topVolumeLimit);
  return {
    ok: true, tradeDate: latest.latest_trade_date,
    reviewedCount: Number(manifest.selection_source_count || 100), selectedCount: rows.length,
    limit: CONFIG.topVolumeLimit,
    generatedAt: latest.updated_at || manifest.generated_at,
    items: rows.map(function(row) {
      const value = function(name) { return row[header.indexOf(name)]; };
      return { rank: Number(value('rank')), symbol: value('stock_code'), name: value('stock_name'),
        volume: Number(value('trade_volume') || 0), close: Number(value('close') || 0),
        priceChange: Number(value('price_change') || 0) };
    })
  };
}

function readCloudDashboard() {
  const response = UrlFetchApp.fetch(cloudDashboardUrl(), { muteHttpExceptions: true, followRedirects: true });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error('Cloud dashboard HTTP ' + response.getResponseCode());
  }
  const payload = JSON.parse(response.getContentText());
  localizeInternationalNews(payload);
  payload.appsScriptProxyAt = new Date().toISOString();
  return payload;
}

function localizeInternationalNews(payload) {
  const groups = [];
  if (Array.isArray(payload.internationalNews)) groups.push(payload.internationalNews);
  if (payload.latestDay && Array.isArray(payload.latestDay.internationalNews)) groups.push(payload.latestDay.internationalNews);
  if (Array.isArray(payload.history)) {
    payload.history.slice(-1).forEach(function(day) {
      if (day && Array.isArray(day.internationalNews)) groups.push(day.internationalNews);
    });
  }
  if (Array.isArray(payload.scenario)) {
    payload.scenario.slice(-1).forEach(function(day) {
      if (day && Array.isArray(day.internationalNews)) groups.push(day.internationalNews);
    });
  }
  groups.forEach(function(items) {
    items.slice(0, 12).forEach(function(item) {
      translateNewsField(item, 'title', 'titleZhTw');
      translateNewsField(item, 'summary', 'summaryZhTw');
    });
  });
  return payload;
}

function translateNewsField(item, sourceField, translatedField) {
  const text = String(item && item[sourceField] || '').trim();
  if (!text || !/[A-Za-z]{3}/.test(text) || item[translatedField]) return;
  const cache = CacheService.getScriptCache();
  const cacheKey = 'news-zh-tw-' + simpleTextHash(text);
  const cached = cache.get(cacheKey);
  if (cached) {
    item[translatedField] = cached;
    return;
  }
  try {
    const translated = LanguageApp.translate(text, '', 'zh-TW').trim();
    if (translated) {
      item[translatedField] = translated;
      cache.put(cacheKey, translated, 21600);
    }
  } catch (error) {
    item.translationError = String(error);
  }
}

function simpleTextHash(text) {
  let hash = 5381;
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) + hash) ^ text.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function scheduledUpdate() {
  return refreshDashboard();
}

function configureMonthlyArchive() {
  const properties = PropertiesService.getScriptProperties();
  if (!properties.getProperty(CLOUD_ARCHIVE_BUCKET_KEY)) {
    properties.setProperty(CLOUD_ARCHIVE_BUCKET_KEY, 'project-aef205b5-5c27-4084-94c-tw-stock-data');
  }
  let folderId = properties.getProperty(DRIVE_ARCHIVE_FOLDER_ID_KEY);
  if (!folderId) {
    folderId = DriveApp.createFolder('台股策略系統月封存').getId();
    properties.setProperty(DRIVE_ARCHIVE_FOLDER_ID_KEY, folderId);
  }
  installMonthlyArchiveTrigger();
  return { ok: true, bucket: properties.getProperty(CLOUD_ARCHIVE_BUCKET_KEY), folderId: folderId };
}

function installMonthlyArchiveTrigger() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'archivePreviousMonthToDrive') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('archivePreviousMonthToDrive').timeBased().onMonthDay(1).atHour(3).create();
}

function archivePreviousMonthToDrive() {
  const properties = PropertiesService.getScriptProperties();
  const bucket = String(properties.getProperty(CLOUD_ARCHIVE_BUCKET_KEY) || '').trim();
  const folderId = String(properties.getProperty(DRIVE_ARCHIVE_FOLDER_ID_KEY) || '').trim();
  if (!bucket || !folderId) throw new Error('請先執行 configureMonthlyArchive');

  const now = new Date();
  const previousMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const month = Utilities.formatDate(previousMonth, Session.getScriptTimeZone(), 'yyyy-MM');
  const objectName = 'monthly/' + month + '.jsonl.gz';
  const fileName = 'tw-stock-' + month + '.jsonl.gz';
  const folder = DriveApp.getFolderById(folderId);
  if (folder.getFilesByName(fileName).hasNext()) {
    return { ok: true, skipped: true, reason: 'ALREADY_ARCHIVED', month: month, fileName: fileName };
  }

  const url = 'https://storage.googleapis.com/download/storage/v1/b/' +
    encodeURIComponent(bucket) + '/o/' + encodeURIComponent(objectName) + '?alt=media';
  const response = UrlFetchApp.fetch(url, {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() },
    muteHttpExceptions: true
  });
  if (response.getResponseCode() === 404) {
    throw new Error('尚未產生月封存檔：' + objectName);
  }
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error('下載月封存失敗 HTTP ' + response.getResponseCode());
  }
  const file = folder.createFile(response.getBlob().setName(fileName));
  properties.setProperty('TW_STOCK_LAST_DRIVE_ARCHIVE', month + '|' + file.getId() + '|' + new Date().toISOString());
  return { ok: true, skipped: false, month: month, fileId: file.getId(), fileName: fileName };
}

function installRealtimeTradingTrigger() {
  deleteSimulationTriggers();
  ScriptApp.newTrigger('scheduledUpdate').timeBased().everyMinutes(1).create();
}

function deleteSimulationTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'scheduledUpdate') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
}

function clearSimulationState() {
  PropertiesService.getScriptProperties().deleteProperty(STATE_KEY);
}

function applyRuntimeConfig() {
  Object.keys(DEFAULT_CONFIG).forEach(function(key) {
    CONFIG[key] = DEFAULT_CONFIG[key];
  });
  const loaded = loadSettingsFromSheet();
  Object.keys(loaded.values).forEach(function(key) {
    CONFIG[key] = loaded.values[key];
  });
  return loaded;
}

function readSettingsPayload() {
  const workbook = getSettingsWorkbook(false);
  const loaded = applyRuntimeConfig();
  return {
    ok: true,
    source: loaded.source,
    spreadsheetId: workbook ? workbook.getId() : null,
    spreadsheetUrl: workbook ? workbook.getUrl() : null,
    generatedAt: new Date().toISOString(),
    settings: currentSettingsForPayload(loaded)
  };
}

function initializeSettingsWorkbook() {
  const workbook = getSettingsWorkbook(true);
  ensureSettingsSheets(workbook);
  const loaded = applyRuntimeConfig();
  return {
    ok: true,
    source: 'google-sheet',
    spreadsheetId: workbook.getId(),
    spreadsheetUrl: workbook.getUrl(),
    generatedAt: new Date().toISOString(),
    settings: currentSettingsForPayload(loaded)
  };
}

function getSettingsWorkbook(createIfMissing) {
  const props = PropertiesService.getScriptProperties();
  const spreadsheetId = props.getProperty(SETTINGS_SPREADSHEET_ID_KEY);
  if (spreadsheetId) {
    try {
      return SpreadsheetApp.openById(spreadsheetId);
    } catch (error) {
      console.warn('Settings spreadsheet open failed: ' + error.message);
    }
  }
  if (!createIfMissing) return null;
  const workbook = SpreadsheetApp.create('台股策略系統 - 策略設定');
  props.setProperty(SETTINGS_SPREADSHEET_ID_KEY, workbook.getId());
  return workbook;
}

function getSettingsSpreadsheetId() {
  return PropertiesService.getScriptProperties().getProperty(SETTINGS_SPREADSHEET_ID_KEY);
}

function ensureSettingsSheets(workbook) {
  ensureStrategySettingsSheet(workbook);
  ensureSheetWithHeader(workbook, SETTINGS_CHANGE_LOG_SHEET_NAME, ['日期', '參數名稱', '舊值', '新值', '修改原因']);
  ensureSheetWithHeader(workbook, WEEKLY_REVIEW_SHEET_NAME, ['週期', '起始日', '結束日', '報酬率', '最大回撤', '交易次數', '勝率', '檢討重點']);
  ensureSheetWithHeader(workbook, THIRTY_DAY_REVIEW_SHEET_NAME, ['週期', '起始日', '結束日', '報酬率', '最大回撤', '交易次數', '勝率', '是否調整', '調整重點']);
}

function ensureStrategySettingsSheet(workbook) {
  const sheet = workbook.getSheetByName(SETTINGS_SHEET_NAME) || workbook.insertSheet(SETTINGS_SHEET_NAME);
  const headers = ['參數代碼', '參數名稱', '目前值', '資料型態', '預設值', '說明', '最後套用時間'];
  const existing = sheet.getLastRow() ? sheet.getRange(1, 1, 1, headers.length).getValues()[0] : [];
  if (existing.join('|') !== headers.join('|')) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }

  const now = new Date().toISOString();
  const existingRows = sheet.getLastRow() > 1
    ? sheet.getRange(2, 1, sheet.getLastRow() - 1, headers.length).getValues()
    : [];
  const existingByKey = {};
  existingRows.forEach(function(row, index) {
    const key = String(row[0] || '').trim();
    if (key) existingByKey[key] = { row: row, index: index + 2 };
  });

  STRATEGY_SETTINGS.forEach(function(setting) {
    const key = setting[0];
    const current = existingByKey[key];
    const row = current ? current.row : [];
    const migrateCandidateLimit = key === 'topVolumeLimit'
      && Number(row[2]) > Number(setting[3])
      && Number(row[4]) >= Number(setting[3]);
    const value = migrateCandidateLimit
      ? setting[3]
      : (row[2] !== '' && row[2] != null ? row[2] : setting[3]);
    const output = [key, setting[1], value, setting[2], setting[3], setting[4], migrateCandidateLimit ? now : (row[6] || now)];
    if (current) sheet.getRange(current.index, 1, 1, headers.length).setValues([output]);
    else sheet.appendRow(output);
  });
  sheet.autoResizeColumns(1, headers.length);
}

function ensureSheetWithHeader(workbook, name, headers) {
  const sheet = workbook.getSheetByName(name) || workbook.insertSheet(name);
  const existing = sheet.getLastRow() ? sheet.getRange(1, 1, 1, headers.length).getValues()[0] : [];
  if (existing.join('|') !== headers.join('|')) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
    sheet.autoResizeColumns(1, headers.length);
  }
  return sheet;
}

function loadSettingsFromSheet() {
  const workbook = getSettingsWorkbook(false);
  if (!workbook) return { source: 'defaults', values: {}, errors: [] };
  ensureSettingsSheets(workbook);
  const sheet = workbook.getSheetByName(SETTINGS_SHEET_NAME);
  if (!sheet || sheet.getLastRow() < 2) return { source: 'defaults', values: {}, errors: [] };

  const rows = sheet.getRange(2, 1, sheet.getLastRow() - 1, 7).getValues();
  const values = {};
  const errors = [];
  rows.forEach(function(row) {
    const key = String(row[0] || '').trim();
    if (!key || DEFAULT_CONFIG[key] == null) return;
    const type = String(row[3] || '').trim() || strategySettingType(key);
    const parsed = parseSettingValue(row[2], type);
    if (parsed.valid) values[key] = parsed.value;
    else errors.push(key + ': ' + parsed.error);
  });
  return { source: 'google-sheet', values: values, errors: errors };
}

function strategySettingType(key) {
  const setting = STRATEGY_SETTINGS.find(function(item) { return item[0] === key; });
  return setting ? setting[2] : 'number';
}

function parseSettingValue(value, type) {
  if (type === 'boolean') {
    if (value === true || value === false) return { valid: true, value: value };
    const text = String(value || '').trim().toUpperCase();
    if (['TRUE', 'YES', 'Y', '1', '是', '允許'].indexOf(text) >= 0) return { valid: true, value: true };
    if (['FALSE', 'NO', 'N', '0', '否', '不允許'].indexOf(text) >= 0) return { valid: true, value: false };
    return { valid: false, error: '布林值需為 TRUE/FALSE' };
  }
  const number = Number(value);
  if (Number.isFinite(number)) return { valid: true, value: number };
  return { valid: false, error: '數值格式錯誤' };
}

function currentSettingsForPayload(loaded) {
  return STRATEGY_SETTINGS.map(function(setting) {
    const key = setting[0];
    return {
      key: key,
      name: setting[1],
      value: CONFIG[key],
      type: setting[2],
      defaultValue: DEFAULT_CONFIG[key],
      source: loaded.values[key] == null ? 'default' : loaded.source,
      description: setting[4]
    };
  });
}

function resetDashboardState() {
  const settings = applyRuntimeConfig();
  const saved = PropertiesService.getScriptProperties().getProperty(STATE_KEY);
  const previous = saved ? JSON.parse(saved) : null;
  const previousScenario = previous && Array.isArray(previous.scenario) ? previous.scenario : [];
  const previousDay = previousScenario.length ? last(previousScenario) : null;
  const resetGeneratedAt = new Date().toISOString();
  const scenario = [Object.assign({
    date: START_DATE,
    session: 'RESET',
    market: { close: 0, ma20: 0, ma50: 0 },
    preOpenPlan: buildPreOpenPlan({ close: 0, ma20: 0, ma50: 0 }, START_DATE),
    groups: {},
    candidates: [],
    source: {}
  }, previousDay || {}, {
    date: START_DATE,
    source: Object.assign({}, previousDay && previousDay.source ? previousDay.source : {}, {
      provider: 'Apps Script reset baseline',
      generatedAt: resetGeneratedAt,
      startDate: START_DATE,
      reset: true
    })
  })];
  const simulation = {
    initialCapital: CONFIG.initialCapital,
    cash: CONFIG.initialCapital,
    positions: [],
    realizedPnl: 0,
    totalFees: 0,
    totalTaxes: 0,
    trades: [],
    daily: [],
    dailyStopped: false,
    weeklyLimited: false,
    finalEquity: CONFIG.initialCapital,
    totalReturn: 0,
    maxDrawdown: 0,
    generatedAt: resetGeneratedAt,
    source: scenario[0].source
  };
  const payload = {
    ok: true,
    source: 'apps-script-reset',
    generatedAt: resetGeneratedAt,
    settings: currentSettingsForPayload(settings),
    schedule: scheduledRefreshDecision(new Date()),
    scenario: scenario,
    simulation: simulation,
    reset: {
      startDate: START_DATE,
      initialCapital: CONFIG.initialCapital,
      clearedAt: resetGeneratedAt
    }
  };
  PropertiesService.getScriptProperties().setProperty(STATE_KEY, JSON.stringify(payload));
  return payload;
}

function refreshDashboard(options) {
  options = options || {};
  const settings = applyRuntimeConfig();
  const schedule = scheduledRefreshDecision(new Date());
  if (!schedule.isTradingDay || (!options.force && !schedule.shouldRun)) {
    return skippedRefreshPayload(schedule);
  }

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(25000)) return readOrSeedPayload();

  try {
    const previous = readOrSeedPayload();
    const scenario = buildScenarioForRefresh(previous, schedule, options);
    const latestDay = last(scenario);
    const previousSimulation = previous && previous.simulation ? previous.simulation : null;
    const simulation = nextSimulation(previousSimulation, latestDay);
    const payload = {
      ok: true,
      source: 'apps-script',
      generatedAt: new Date().toISOString(),
      settings: currentSettingsForPayload(settings),
      schedule: schedule,
      scenario: scenario,
      simulation: simulation
    };
    PropertiesService.getScriptProperties().setProperty(STATE_KEY, JSON.stringify(payload));
    return payload;
  } finally {
    lock.releaseLock();
  }
}

function buildScenarioForRefresh(previous, schedule, options) {
  options = options || {};
  const previousDay = previous && Array.isArray(previous.scenario) ? last(previous.scenario) : null;
  const positions = previous && previous.simulation ? previous.simulation.positions : [];
  const hasScannerUniverse = Boolean(previousDay && previousDay.source && previousDay.source.universe && previousDay.source.universe.mode);
  const shouldResetForStartDate = !previousDay || previousDay.date < START_DATE || schedule.date < START_DATE;

  if (shouldResetForStartDate) {
    return buildScenario([], schedule.date);
  }

  if (options.force) {
    return buildScenario(positions, schedule.date);
  }

  const isNewTradingDate = previousDay && previousDay.date !== schedule.date;
  if (previousDay && Array.isArray(previousDay.candidates) && hasScannerUniverse && !isNewTradingDate) {
    return quickRefreshScenario(previousDay, schedule, positions);
  }

  return buildScenario(positions, schedule.date);
}

function readOrSeedPayload() {
  const saved = PropertiesService.getScriptProperties().getProperty(STATE_KEY);
  if (saved) return JSON.parse(saved);

  const seed = readSeedFromGitHub();
  PropertiesService.getScriptProperties().setProperty(STATE_KEY, JSON.stringify(seed));
  return seed;
}

function readStatusPayload() {
  const settings = applyRuntimeConfig();
  const payload = readOrSeedPayload();
  const simulation = payload && payload.simulation ? payload.simulation : {};
  const trades = Array.isArray(simulation.trades) ? simulation.trades : [];
  const latestTrade = trades.length ? trades[trades.length - 1] : null;
  return {
    ok: true,
    source: payload.source || 'apps-script',
    generatedAt: payload.generatedAt || simulation.generatedAt || new Date().toISOString(),
    scenarioDate: Array.isArray(payload.scenario) && payload.scenario.length ? last(payload.scenario).date : null,
    tradeCount: trades.length,
    latestTrade: latestTrade,
    tradeSignature: tradeSignature(trades, latestTrade),
    settingsSource: settings.source,
    settingsSpreadsheetId: getSettingsSpreadsheetId(),
    settings: currentSettingsForPayload(settings)
  };
}

function tradeSignature(trades, latestTrade) {
  if (!latestTrade) return '0:none';
  return [
    trades.length,
    latestTrade.date || '',
    latestTrade.action || '',
    latestTrade.symbol || '',
    latestTrade.shares || '',
    latestTrade.price || '',
    latestTrade.pnl || ''
  ].join('|');
}

function readSeedFromGitHub() {
  const scenarioText = fetchText(RAW_BASE + 'actual_data.js?v=' + Date.now());
  const simulationText = fetchText(RAW_BASE + 'simulation_result.js?v=' + Date.now());
  const scenario = parseWindowAssignment(scenarioText, 'ACTUAL_SCENARIO');
  const simulation = parseWindowAssignment(simulationText, 'PRECOMPUTED_SIMULATION');
  return {
    ok: true,
    source: 'github-seed',
    generatedAt: new Date().toISOString(),
    scenario: scenario,
    simulation: simulation
  };
}

function parseWindowAssignment(text, key) {
  const re = new RegExp('window\\.' + key + '\\s*=\\s*([\\s\\S]*?);\\s*$');
  const match = String(text || '').match(re);
  if (!match) throw new Error('Cannot parse ' + key);
  return JSON.parse(match[1]);
}

function buildScenario(existingPositions, targetDate) {
  const marketResult = fetchChart('^TWII', '1y', '1d');
  const marketQuote = safeFetchLatestQuote('^TWII');
  const marketRows = mergeLatestRow(rowsFromChart(marketResult), marketQuote);
  const marketCloses = marketRows.map(function(row) { return row.close; });
  const latestMarket = last(marketRows);
  const market = {
    close: round2(latestMarket.close),
    ma20: round2(sma(marketCloses, 20)),
    ma50: round2(sma(marketCloses, 50))
  };

  const scannerDate = targetDate || latestMarket.date;
  const universeResult = buildTradingUniverse(scannerDate, existingPositions || []);
  const universePool = universeResult.items;
  const candidates = [];
  const analysisDate = universeResult.meta && universeResult.meta.date
    ? universeResult.meta.date
    : latestMarket.date;
  const chipData = safeFetchOfficialChipData(analysisDate, universePool);
  const selection = selectCandidateUniverse(universePool, chipData, CONFIG.maxScanCandidates);
  const universe = selection.items;
  universeResult.meta.selection = selection.meta;
  const twseQuotes = safeFetchTwseQuotes(universe);
  const afterMarketTrades = safeFetchAfterMarketTrades(analysisDate, universe);
  universe.forEach(function(stockInfo) {
    try {
      const result = fetchChart(stockInfo.symbol, '1y', '1d');
      const yahooQuote = safeFetchLatestQuote(stockInfo.symbol);
      const latestQuote = applyAfterMarketTrade(twseQuotes[stockInfo.code] || yahooQuote, afterMarketTrades[stockInfo.code]);
      candidates.push(gradeCandidate(stockInfo, rowsFromChart(result), latestQuote, chipData[stockInfo.code]));
    } catch (error) {
      console.warn('Skip ' + stockInfo.symbol + ': ' + error.message);
    }
  });

  const groupCounts = {};
  candidates.forEach(function(candidate) {
    if (!groupCounts[candidate.group]) groupCounts[candidate.group] = 0;
    if (candidate.grade === 'A' || candidate.grade === 'B') groupCounts[candidate.group] += 1;
  });

  return [{
    date: scannerDate >= START_DATE ? scannerDate : START_DATE,
    session: hasAfterMarketTrades(afterMarketTrades) ? 'AFTER_MARKET' : 'REGULAR',
    market: market,
    preOpenPlan: buildPreOpenPlan(market, latestMarket.date),
    groups: groupCounts,
    candidates: candidates,
    source: {
      provider: 'Apps Script + TWSE MIS/BFT41U/T86/MI_MARGN/TWT93U/TWTB4U/notice + Yahoo Finance chart API',
      generatedAt: new Date().toISOString(),
      startDate: START_DATE,
      universe: universeResult.meta,
      analysisDate: analysisDate,
      dataDatesAligned: !(chipData._meta && chipData._meta.alignedToUniverseDate === false),
      afterMarketDate: afterMarketTrades._meta ? afterMarketTrades._meta.date : null,
      chipDates: chipData._meta || null
    }
  }];
}

function buildTradingUniverse(targetDate, existingPositions) {
  const heldItems = positionUniverseItems(existingPositions || []);
  const fallbackMeta = {
    mode: 'fallback',
    source: 'static fallback universe',
    topVolumeLimit: CONFIG.topVolumeLimit,
    scannedLimit: FALLBACK_UNIVERSE.length,
    filteredCount: FALLBACK_UNIVERSE.length,
    heldSupplementCount: heldItems.length,
    groups: targetGroupNames()
  };

  try {
    const rawRanked = fetchTopVolumeStocks(targetDate, CONFIG.rawVolumeReviewLimit);
    const ranked = rawRanked.slice(0, CONFIG.candidateSelectionPoolLimit);
    let selected = ranked
      .map(function(row) { return classifyTargetStock(row); })
      .filter(Boolean);
    selected = mergeUniverseItems(selected, heldItems);

    if (!selected.length) {
      return { items: mergeUniverseItems(FALLBACK_UNIVERSE, heldItems), meta: Object.assign({}, fallbackMeta, {
        reason: 'top volume list had no target-group matches'
      }) };
    }

    return {
      items: selected,
      meta: {
        mode: 'dynamic',
        source: 'TWSE MI_INDEX top volume',
        date: ranked[0] && ranked[0].sourceDate ? ranked[0].sourceDate : targetDate,
        topVolumeLimit: CONFIG.topVolumeLimit,
        candidateSelectionPoolLimit: CONFIG.candidateSelectionPoolLimit,
        rawVolumeReviewLimit: CONFIG.rawVolumeReviewLimit,
        scannedLimit: CONFIG.maxScanCandidates,
        rawRankedCount: rawRanked.length,
        rankedCount: ranked.length,
        filteredCount: selected.length,
        heldSupplementCount: heldItems.length,
        groups: targetGroupNames()
      }
    };
  } catch (error) {
    console.warn('Dynamic universe fallback: ' + error.message);
    return { items: mergeUniverseItems(FALLBACK_UNIVERSE, heldItems), meta: Object.assign({}, fallbackMeta, {
      error: error.message
    }) };
  }
}

function positionUniverseItems(positions) {
  return (positions || []).map(function(position) {
    const inherited = FALLBACK_UNIVERSE_BY_CODE[position.symbol] || {};
    return {
      symbol: (position.symbol || inherited.code) + '.TW',
      code: position.symbol || inherited.code,
      name: position.name || inherited.name || position.symbol,
      group: inherited.group || '既有持倉',
      industryOk: inherited.industryOk !== false,
      fundamentalOk: inherited.fundamentalOk !== false,
      chipOk: Boolean(inherited.chipOk),
      heldSupplement: true
    };
  }).filter(function(item) {
    return item.code;
  });
}

function mergeUniverseItems(primary, supplements) {
  const map = {};
  const out = [];
  (primary || []).concat(supplements || []).forEach(function(item) {
    if (!item || !item.code || map[item.code]) return;
    map[item.code] = true;
    out.push(item);
  });
  return out;
}

function universeFromCandidates(candidates) {
  const items = (candidates || []).map(function(candidate) {
    const inherited = FALLBACK_UNIVERSE_BY_CODE[candidate.symbol] || {};
    return {
      symbol: (candidate.symbol || inherited.code) + '.TW',
      code: candidate.symbol || inherited.code,
      name: candidate.name || inherited.name || candidate.symbol,
      group: candidate.group || inherited.group || '目標族群',
      industryOk: candidate.industryOk !== false,
      fundamentalOk: candidate.fundamentalOk !== false,
      chipOk: Boolean(candidate.metrics && candidate.metrics.chip && candidate.metrics.chip.baseChipOk) || Boolean(inherited.chipOk),
      volumeRank: candidate.metrics && candidate.metrics.volumeRank,
      screeningVolume: candidate.metrics && candidate.metrics.screeningVolume,
      heldSupplement: Boolean(candidate.heldSupplement)
    };
  }).filter(function(item) {
    return item.code;
  });
  return items.length ? items : FALLBACK_UNIVERSE;
}

function fetchTopVolumeStocks(targetDate, limit) {
  const payload = fetchLatestTwseTable('exchangeReport/MI_INDEX', targetDate, {
    type: 'ALLBUT0999'
  }, function(json) {
    return parseTopVolumeRows(json, limit).length > 0;
  });
  return parseTopVolumeRows(payload.json, limit).map(function(row) {
    return Object.assign({}, row, { sourceDate: payload.date });
  });
}

function parseTopVolumeRows(json, limit) {
  const tables = json && Array.isArray(json.tables)
    ? json.tables
    : [{ fields: json && json.fields, data: json && json.data }];
  let rows = [];

  tables.forEach(function(table) {
    const fields = table && table.fields ? table.fields : [];
    const data = table && table.data ? table.data : [];
    const codeIndex = fieldIndex(fields, /證券代號/);
    const nameIndex = fieldIndex(fields, /證券名稱/);
    const volumeIndex = fieldIndex(fields, /成交股數|成交量/);
    const closeIndex = fieldIndex(fields, /收盤價|成交價/);
    const signIndex = fieldIndex(fields, /漲跌\(\+\/-\)|漲跌符號/);
    const changeIndex = fieldIndex(fields, /漲跌價差/);
    if (codeIndex < 0 || nameIndex < 0 || volumeIndex < 0) return;

    rows = rows.concat(data.map(function(rowObject) {
      const row = rowObject && rowObject.value ? rowObject.value : rowObject;
      if (!Array.isArray(row)) return null;
      const code = String(row[codeIndex] || '').trim();
      if (!isListedCommonStockCode(code)) return null;
      const close = closeIndex >= 0 ? parseTwseNumber(row[closeIndex]) : null;
      const rawChange = changeIndex >= 0 ? Math.abs(parseTwseNumber(row[changeIndex]) || 0) : 0;
      const signText = signIndex >= 0 ? String(row[signIndex] || '').toLowerCase() : '';
      const signedChange = /-|green|down/.test(signText) ? -rawChange : rawChange;
      const previousClose = close != null ? close - signedChange : null;
      return {
        code: code,
        name: String(row[nameIndex] || '').trim(),
        volume: parseTwseNumber(row[volumeIndex]) || 0,
        close: close,
        priceChange: signedChange,
        priceChangePct: previousClose ? signedChange / previousClose : null
      };
    }).filter(Boolean));
  });

  return rows
    .sort(function(a, b) { return b.volume - a.volume; })
    .slice(0, limit || CONFIG.topVolumeLimit)
    .map(function(row, index) {
      return Object.assign({}, row, { volumeRank: index + 1 });
    });
}

function isListedCommonStockCode(code) {
  const normalized = String(code || '').trim();
  return /^\d{4}$/.test(normalized) && !/^00/.test(normalized);
}

function classifyTargetStock(row) {
  const inherited = FALLBACK_UNIVERSE_BY_CODE[row.code] || null;
  const group = inherited ? inherited.group : (detectTargetGroup(row) || '其他產業');
  return {
    symbol: row.code + '.TW',
    code: row.code,
    name: row.name,
    group: group,
    industryOk: true,
    fundamentalOk: inherited ? inherited.fundamentalOk : true,
    chipOk: inherited ? inherited.chipOk : false,
    volumeRank: row.volumeRank,
    screeningVolume: row.volume,
    screeningClose: row.close,
    priceChangePct: row.priceChangePct
  };
}

function selectionClamp(value) { return Math.max(0, Math.min(1, Number(value) || 0)); }

function chipSelectionFraction(item, signal) {
  signal = signal || {};
  const institutional = signal.institutional;
  const margin = signal.margin;
  const hasDetails = Boolean(institutional || margin || signal.shortLending || signal.dayTrade);
  if (!hasDetails) return 0.5;
  let institutionalPoints = 3;
  if (institutional) {
    institutionalPoints = institutional.totalNet > 0 ? 4 : institutional.totalNet < 0 ? 1 : 2;
    if ((institutional.foreignNet || 0) > 0 || (institutional.trustNet || 0) > 0) institutionalPoints += 1;
    if (item.screeningVolume && institutional.totalNet / item.screeningVolume >= 0.03) institutionalPoints += 1;
  }
  institutionalPoints = Math.min(6, institutionalPoints);
  const marginRatio = margin ? signal.marginChangeRatio : null;
  const marginPoints = marginRatio == null ? 2 : marginRatio <= 0 ? 3 : marginRatio <= 0.02 ? 2 : marginRatio <= 0.05 ? 1 : 0;
  const shortValues = [signal.shortChangeRatio, signal.securitiesLendingChangeRatio].filter(function(value) {
    return value != null && Number.isFinite(Number(value));
  });
  const shortRatio = shortValues.length ? Math.max.apply(null, shortValues) : null;
  const shortPoints = shortRatio == null ? 2 : shortRatio <= 0 ? 3 : shortRatio <= 0.03 ? 2 : shortRatio <= 0.08 ? 1 : 0;
  const dayTradeRatio = item.screeningVolume && signal.dayTradeVolume != null ? signal.dayTradeVolume / item.screeningVolume : null;
  const dayTradePoints = dayTradeRatio == null ? 2 : dayTradeRatio <= 0.35 ? 3 : dayTradeRatio <= 0.50 ? 2 : dayTradeRatio <= 0.60 ? 1 : 0;
  return selectionClamp((institutionalPoints + marginPoints + shortPoints + dayTradePoints) / 15);
}

function candidateSelectionScore(item, signal) {
  const chip = chipSelectionFraction(item, signal);
  const volume = selectionClamp((CONFIG.candidateSelectionPoolLimit - Number(item.volumeRank || CONFIG.candidateSelectionPoolLimit) + 1) / CONFIG.candidateSelectionPoolLimit);
  const changePct = Number(item.priceChangePct);
  const momentum = Number.isFinite(changePct) ? selectionClamp((changePct + 0.05) / 0.10) : 0.5;
  return {
    total: round2(100 * (CONFIG.candidateChipWeight * chip + CONFIG.candidateVolumeWeight * volume + CONFIG.candidateMomentumWeight * momentum)),
    chip: round2(50 * chip), volume: round2(30 * volume), momentum: round2(20 * momentum)
  };
}

function selectCandidateUniverse(items, chipData, limit) {
  const held = (items || []).filter(function(item) { return item.heldSupplement; });
  const pool = (items || []).filter(function(item) { return !item.heldSupplement; }).map(function(item) {
    return Object.assign({}, item, { selectionScore: candidateSelectionScore(item, chipData[item.code]) });
  });
  const aligned = !(chipData._meta && chipData._meta.alignedToUniverseDate === false);
  pool.sort(aligned
    ? function(a, b) { return b.selectionScore.total - a.selectionScore.total || a.volumeRank - b.volumeRank; }
    : function(a, b) { return a.volumeRank - b.volumeRank; });
  const selected = pool.slice(0, limit || CONFIG.topVolumeLimit);
  return {
    items: mergeUniverseItems(selected, held),
    meta: {
      mode: aligned ? 'chip-50-volume-30-momentum-20' : 'volume-fallback-chip-date-mismatch',
      poolCount: pool.length, selectedCount: selected.length,
      weights: { chip: CONFIG.candidateChipWeight, volume: CONFIG.candidateVolumeWeight, momentum: CONFIG.candidateMomentumWeight }
    }
  };
}

function detectTargetGroup(row) {
  const text = [row.code, row.name].join(' ');
  for (let i = 0; i < TARGET_GROUP_RULES.length; i += 1) {
    const rule = TARGET_GROUP_RULES[i];
    for (let j = 0; j < rule.keywords.length; j += 1) {
      if (text.indexOf(rule.keywords[j]) >= 0) return rule.group;
    }
  }
  return null;
}

function targetGroupNames() {
  return TARGET_GROUP_RULES.map(function(rule) { return rule.group; });
}

function fieldIndex(fields, pattern) {
  for (let i = 0; i < fields.length; i += 1) {
    if (pattern.test(String(fields[i] || ''))) return i;
  }
  return -1;
}

function quickRefreshScenario(previousDay, schedule, existingPositions) {
  const baseCandidates = previousDay.candidates || [];
  const refreshUniverse = mergeUniverseItems(
    universeFromCandidates(baseCandidates),
    positionUniverseItems(existingPositions || [])
  );
  const twseQuotes = safeFetchTwseQuotes(refreshUniverse);
  const afterMarketTrades = safeFetchAfterMarketTrades(previousDay.date, refreshUniverse);
  const marketQuote = safeFetchLatestQuote('^TWII');
  const candidates = baseCandidates.map(function(candidate) {
    const baseQuote = twseQuotes[candidate.symbol] || {
      price: candidate.price,
      bidPrice: candidate.bidPrice,
      askPrice: candidate.askPrice,
      volume: 0,
      time: candidate.metrics && candidate.metrics.latestQuoteTime,
      provider: candidate.metrics && candidate.metrics.latestQuoteProvider
    };
    const quote = applyAfterMarketTrade(baseQuote, afterMarketTrades[candidate.symbol]);
    return updateCandidateQuote(candidate, quote);
  });
  const known = {};
  candidates.forEach(function(candidate) {
    known[candidate.symbol] = true;
  });
  (existingPositions || []).forEach(function(position) {
    if (!position || !position.symbol || known[position.symbol]) return;
    const item = positionUniverseItems([position])[0];
    if (!item) return;
    const baseQuote = twseQuotes[position.symbol] || {
      price: position.avgCost,
      bidPrice: position.avgCost,
      askPrice: position.avgCost,
      volume: 0,
      time: null,
      provider: 'position-cost-fallback'
    };
    const quote = applyAfterMarketTrade(baseQuote, afterMarketTrades[position.symbol]);
    candidates.push(candidateFromHeldPosition(position, item, quote, previousDay));
  });

  const refreshedMarket = Object.assign({}, previousDay.market, {
    close: marketQuote && marketQuote.price != null ? round2(marketQuote.price) : previousDay.market.close
  });
  const preOpenPlan = buildPreOpenPlan(refreshedMarket, schedule.date);

  return [Object.assign({}, previousDay, {
    date: schedule.date,
    session: hasAfterMarketTrades(afterMarketTrades) ? 'AFTER_MARKET' : 'REGULAR',
    market: refreshedMarket,
    preOpenPlan: preOpenPlan,
    candidates: candidates,
    source: Object.assign({}, previousDay.source || {}, {
      provider: 'Apps Script quick refresh + TWSE MIS + TWSE BFT41U after-hours',
      generatedAt: new Date().toISOString(),
      refreshMode: 'quick',
      universe: Object.assign({}, previousDay.source && previousDay.source.universe ? previousDay.source.universe : {}, {
        refreshedCount: refreshUniverse.length,
        heldSupplementCount: positionUniverseItems(existingPositions || []).length
      }),
      schedule: schedule,
      afterMarketDate: afterMarketTrades._meta ? afterMarketTrades._meta.date : null,
      preOpenPlan: preOpenPlan
    })
  })];
}

function candidateFromHeldPosition(position, item, quote, previousDay) {
  const price = round2(quote && quote.price != null ? quote.price : position.avgCost);
  const bidPrice = quote && quote.bidPrice != null ? round2(quote.bidPrice) : price;
  const askPrice = quote && quote.askPrice != null ? round2(quote.askPrice) : price;
  const dailyClose = price;
  const spreadPct = quoteSpreadPct(quote, price);
  return {
    date: previousDay.date,
    symbol: position.symbol,
    name: position.name || item.name || position.symbol,
    group: item.group || '既有持倉',
    price: price,
    bidPrice: bidPrice,
    askPrice: askPrice,
    grade: 'C',
    reason: '既有持倉補報價；未列入今日成交量前 100 名目標族群掃描',
    stopPrice: position.stopPrice || round2(price * 0.98),
    targetPrice: position.targetPrice || round2(price * 1.08),
    dayTradeOk: false,
    overnightOk: false,
    intradayReturnPct: 0,
    heldSupplement: true,
    industryOk: item.industryOk,
    fundamentalOk: item.fundamentalOk,
    chipOk: item.chipOk,
    session: quote && quote.session ? quote.session : 'REGULAR',
    afterMarketPrice: quote && quote.afterMarket ? round2(quote.afterMarket.price) : null,
    afterMarketVolume: quote && quote.afterMarket ? quote.afterMarket.volume : 0,
    afterMarketTransactions: quote && quote.afterMarket ? quote.afterMarket.transactions : 0,
    afterMarketBidVolume: quote && quote.afterMarket ? quote.afterMarket.bidVolume : 0,
    afterMarketAskVolume: quote && quote.afterMarket ? quote.afterMarket.askVolume : 0,
    executionPlan: buildExecutionPlan('C', false, false, false, Boolean(item.chipOk), 1, 0, spreadPct),
    overnightPlan: {
      ok: false,
      positionPct: 0,
      reason: '既有持倉只補即時報價，不新增隔日沖部位',
      exitRules: ['依原停損停利與現金水位管理', '若觸發風險條件則減碼或出場']
    },
    metrics: {
      heldSupplement: true,
      dailyClose: dailyClose,
      latestQuoteTime: quote && quote.time ? quote.time : null,
      latestQuoteProvider: quote && quote.provider ? quote.provider : null,
      session: quote && quote.session ? quote.session : 'REGULAR',
      bidPrice: bidPrice,
      askPrice: askPrice,
      afterMarket: quote && quote.afterMarket ? quote.afterMarket : null,
      spreadPct: spreadPct,
      markedClose: price,
      refreshMode: 'quick'
    }
  };
}

function updateCandidateQuote(candidate, quote) {
  if (!quote || quote.price == null) return candidate;
  const price = round2(quote.price);
  const bidPrice = quote.bidPrice != null ? round2(quote.bidPrice) : price;
  const askPrice = quote.askPrice != null ? round2(quote.askPrice) : price;
  const updated = Object.assign({}, candidate, {
    price: price,
    bidPrice: bidPrice,
    askPrice: askPrice,
    session: quote.session || 'REGULAR',
    afterMarketPrice: quote.afterMarket ? round2(quote.afterMarket.price) : null,
    afterMarketVolume: quote.afterMarket ? quote.afterMarket.volume : 0,
    afterMarketTransactions: quote.afterMarket ? quote.afterMarket.transactions : 0,
    afterMarketBidVolume: quote.afterMarket ? quote.afterMarket.bidVolume : 0,
    afterMarketAskVolume: quote.afterMarket ? quote.afterMarket.askVolume : 0
  });
  updated.intradayReturnPct = candidate.metrics && candidate.metrics.dailyClose
    ? Math.max(-0.03, Math.min(0.03, price / candidate.metrics.dailyClose - 1))
    : candidate.intradayReturnPct;
  updated.executionPlan = buildExecutionPlan(
    candidate.grade,
    candidate.trendOk,
    candidate.volumePriceOk,
    candidate.momentumOk,
    candidate.chipOk,
    candidate.metrics && candidate.metrics.volumeRatio ? candidate.metrics.volumeRatio : 1,
    updated.intradayReturnPct || 0,
    quoteSpreadPct(quote, price)
  );
  updated.dayTradeOk = candidate.grade === 'A' && updated.executionPlan.dayTradeOk;
  const previousClose = candidate.metrics && candidate.metrics.dailyClose ? candidate.metrics.dailyClose : price;
  const latestForOvernight = {
    close: price,
    high: Math.max(price, candidate.metrics && candidate.metrics.markedClose ? candidate.metrics.markedClose : price)
  };
  updated.overnightPlan = buildOvernightPlan(
    candidate.grade,
    candidate.trendOk,
    candidate.volumePriceOk,
    candidate.momentumOk,
    candidate.chipOk,
    candidate.metrics && candidate.metrics.volumeRatio ? candidate.metrics.volumeRatio : 1,
    updated.intradayReturnPct || 0,
    latestForOvernight,
    { close: previousClose }
  );
  updated.overnightOk = Boolean(updated.overnightPlan && updated.overnightPlan.ok);
  updated.metrics = Object.assign({}, candidate.metrics || {}, {
    latestQuoteTime: quote.time || null,
    latestQuoteProvider: quote.provider || null,
    session: quote.session || 'REGULAR',
    bidPrice: quote.bidPrice != null ? bidPrice : null,
    askPrice: quote.askPrice != null ? askPrice : null,
    afterMarket: quote.afterMarket || null,
    spreadPct: quoteSpreadPct(quote, price),
    markedClose: price,
    refreshMode: 'quick'
  });
  return updated;
}

function fetchChart(symbol, range, interval) {
  const url = 'https://query1.finance.yahoo.com/v8/finance/chart/' +
    encodeURIComponent(symbol) + '?range=' + encodeURIComponent(range || '1y') +
    '&interval=' + encodeURIComponent(interval || '1d');
  const json = fetchJson(url, { 'User-Agent': 'Mozilla/5.0' });
  if (!json.chart || json.chart.error) {
    throw new Error(symbol + ' ' + JSON.stringify(json.chart && json.chart.error));
  }
  return json.chart.result[0];
}

function safeFetchLatestQuote(symbol) {
  try {
    return fetchLatestQuote(symbol);
  } catch (error) {
    console.warn('Latest quote fallback ' + symbol + ': ' + error.message);
    return null;
  }
}

function fetchLatestQuote(symbol) {
  const result = fetchChart(symbol, '1d', '1m');
  const quote = result.indicators.quote[0];
  const timestamps = result.timestamp || [];
  for (let index = timestamps.length - 1; index >= 0; index -= 1) {
    const close = quote.close[index];
    if (close != null) {
      return {
        price: close,
        open: quote.open[index] != null ? quote.open[index] : result.meta.regularMarketOpen || close,
        high: quote.high[index] != null ? quote.high[index] : close,
        low: quote.low[index] != null ? quote.low[index] : close,
        volume: quote.volume[index] || 0,
        time: new Date(timestamps[index] * 1000).toISOString(),
        provider: 'Yahoo Finance chart API'
      };
    }
  }
  return null;
}

function safeFetchTwseQuotes(items) {
  try {
    return fetchTwseQuotes(items);
  } catch (error) {
    console.warn('TWSE MIS fallback: ' + error.message);
    return {};
  }
}

function fetchTwseQuotes(items) {
  const channels = items.map(function(item) { return 'tse_' + item.code + '.tw'; }).join('|');
  const url = 'https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=' +
    encodeURIComponent(channels) + '&json=1&delay=0';
  const json = fetchJson(url, {
    Referer: 'https://mis.twse.com.tw/stock/index.jsp',
    'User-Agent': 'Mozilla/5.0'
  });
  const quotes = {};
  (json.msgArray || []).forEach(function(item) {
    const price = bestTwsePrice(item);
    const bidPrice = bestTwseSidePrice(item.b);
    const askPrice = bestTwseSidePrice(item.a);
    if (item.c && price != null) {
      quotes[item.c] = {
        price: price,
        bidPrice: bidPrice,
        askPrice: askPrice,
        open: coalesce(parseTwseNumber(item.o), price),
        high: coalesce(parseTwseNumber(item.h), price),
        low: coalesce(parseTwseNumber(item.l), price),
        volume: (parseTwseNumber(item.v) || 0) * 1000,
        time: item.tlong ? new Date(Number(item.tlong)).toISOString() : new Date().toISOString(),
        provider: 'TWSE MIS'
      };
    }
  });
  return quotes;
}

function safeFetchAfterMarketTrades(targetDate, items) {
  try {
    return fetchAfterMarketTrades(targetDate, items);
  } catch (error) {
    console.warn('TWSE BFT41U fallback: ' + error.message);
    const out = {};
    out._meta = { error: error.message, provider: 'TWSE BFT41U' };
    return out;
  }
}

function skippedRefreshPayload(schedule) {
  const settings = applyRuntimeConfig();
  const payload = readOrSeedPayload();
  payload.schedule = Object.assign({}, schedule, {
    skipped: true,
    skippedAt: new Date().toISOString()
  });
  payload.settings = currentSettingsForPayload(settings);
  return payload;
}

function fetchAfterMarketTrades(targetDate, items) {
  const url = 'https://www.twse.com.tw/rwd/zh/afterTrading/BFT41U?date=' +
    encodeURIComponent(ymdCompact(targetDate)) + '&response=json';
  const json = fetchJson(url, {
    Referer: 'https://www.twse.com.tw/',
    'User-Agent': 'Mozilla/5.0'
  });
  if (!json || json.stat !== 'OK' || !Array.isArray(json.data)) {
    throw new Error('No usable TWSE after-hours fixed-price data for ' + targetDate);
  }

  const wanted = {};
  items.forEach(function(item) { wanted[item.code] = true; });
  const out = {};
  json.data.forEach(function(rowObject) {
    const row = rowObject && rowObject.value ? rowObject.value : rowObject;
    if (!Array.isArray(row)) return;
    const code = String(row[0] || '').trim();
    if (!wanted[code]) return;
    const price = parseTwseNumber(row[5]);
    const lots = parseTwseNumber(row[2]) || 0;
    if (price == null) return;
    out[code] = {
      code: code,
      name: row[1],
      price: price,
      volume: lots * 1000,
      lots: lots,
      transactions: parseTwseNumber(row[3]) || 0,
      tradeValue: parseTwseNumber(row[4]) || 0,
      bidVolume: parseTwseNumber(row[6]) || 0,
      askVolume: parseTwseNumber(row[7]) || 0,
      date: targetDate,
      time: targetDate + 'T06:30:00.000Z',
      provider: 'TWSE BFT41U after-hours fixed-price'
    };
  });
  out._meta = {
    provider: 'TWSE BFT41U',
    date: json.date || ymdCompact(targetDate)
  };
  return out;
}

function applyAfterMarketTrade(baseQuote, afterMarketTrade) {
  if (!afterMarketTrade || !afterMarketTrade.volume || afterMarketTrade.price == null) {
    return baseQuote;
  }
  const quote = Object.assign({}, baseQuote || {});
  quote.price = afterMarketTrade.price;
  quote.bidPrice = afterMarketTrade.price;
  quote.askPrice = afterMarketTrade.price;
  quote.volume = Math.max(Number(quote.volume || 0), Number(afterMarketTrade.volume || 0));
  quote.time = afterMarketTrade.time;
  quote.provider = afterMarketTrade.provider;
  quote.session = 'AFTER_MARKET';
  quote.afterMarket = afterMarketTrade;
  return quote;
}

function hasAfterMarketTrades(afterMarketTrades) {
  return Object.keys(afterMarketTrades || {}).some(function(key) {
    return key !== '_meta' && afterMarketTrades[key] && afterMarketTrades[key].volume > 0;
  });
}

function safeFetchOfficialChipData(targetDate, items) {
  try {
    return fetchOfficialChipData(targetDate, items);
  } catch (error) {
    console.warn('Official chip fallback: ' + error.message);
    const out = {};
    out._meta = { error: error.message, provider: 'TWSE T86/MI_MARGN' };
    return out;
  }
}

function fetchOfficialChipData(targetDate, items) {
  const institutionPayload = fetchLatestTwseTable('fund/T86', targetDate, {
    selectType: 'ALLBUT0999'
  }, function(json) {
    return json && json.stat === 'OK' && Array.isArray(json.data);
  });
  const marginPayload = fetchLatestTwseTable('exchangeReport/MI_MARGN', targetDate, {
    selectType: 'ALL'
  }, function(json) {
    return json && json.stat === 'OK' && Array.isArray(json.tables) && json.tables.length > 1;
  });
  const shortPayload = tryFetchLatestTwseTable('exchangeReport/TWT93U', targetDate, {}, function(json) {
    return json && json.stat === 'OK' && Array.isArray(json.data);
  });
  const dayTradePayload = tryFetchLatestTwseTable('rwd/zh/dayTrading/TWTB4U', targetDate, {}, function(json) {
    return json && json.stat === 'OK' && Array.isArray(json.tables) && json.tables[1]
      && Array.isArray(json.tables[1].data) && json.tables[1].data.some(function(row) { return row.length >= 6; });
  });
  const noticePayload = fetchTwseNotice(targetDate);

  const institutional = parseInstitutionalRows(institutionPayload.json);
  const margin = parseMarginRows(marginPayload.json);
  const shortLending = shortPayload ? parseShortLendingRows(shortPayload.json) : {};
  const dayTrade = dayTradePayload ? parseDayTradeRows(dayTradePayload.json) : {};
  const notices = parseNoticeRows(noticePayload ? noticePayload.json : null);
  const expectedDate = ymdCompact(targetDate);
  const alignedToUniverseDate = institutionPayload.date === expectedDate && marginPayload.date === expectedDate;
  const out = {};
  items.forEach(function(item) {
    out[item.code] = Object.assign(buildChipSignal(
      institutional[item.code] || null,
      margin[item.code] || null,
      shortLending[item.code] || null,
      dayTradePayload ? (dayTrade[item.code] || { eligible: false, suspendedSellFirst: false, volume: null }) : null,
      notices[item.code] || null,
      institutionPayload.date,
      marginPayload.date,
      shortPayload ? shortPayload.date : null,
      dayTradePayload ? dayTradePayload.date : null,
      noticePayload ? noticePayload.date : null
    ), {
      universeDate: expectedDate,
      dataDateAligned: alignedToUniverseDate
    });
  });
  out._meta = {
    provider: 'TWSE T86/MI_MARGN/TWT93U/TWTB4U/notice',
    institutionalDate: institutionPayload.date,
    marginDate: marginPayload.date,
    shortLendingDate: shortPayload ? shortPayload.date : null,
    dayTradeDate: dayTradePayload ? dayTradePayload.date : null,
    noticeDate: noticePayload ? noticePayload.date : null,
    universeDate: expectedDate,
    alignedToUniverseDate: alignedToUniverseDate,
    largeTraderProxy: 'institutional net-buy ratio plus margin/short balance change; TWSE has no stable public daily large-holder API for this use case'
  };
  return out;
}

function tryFetchLatestTwseTable(path, targetDate, params, isUsable) {
  try {
    return fetchLatestTwseTable(path, targetDate, params, isUsable);
  } catch (error) {
    console.warn('Optional TWSE table unavailable ' + path + ': ' + error.message);
    return null;
  }
}

function fetchTwseNotice(targetDate) {
  const compact = ymdCompact(targetDate);
  const url = 'https://www.twse.com.tw/rwd/zh/announcement/notice?' + toQuery({
    response: 'json', startDate: compact, endDate: compact
  });
  try {
    const json = fetchJson(url, { Referer: 'https://www.twse.com.tw/', 'User-Agent': 'Mozilla/5.0' });
    return json && json.stat === 'OK' && Array.isArray(json.data) ? { date: compact, json: json } : null;
  } catch (error) {
    console.warn('TWSE notice unavailable: ' + error.message);
    return null;
  }
}

function fetchLatestTwseTable(path, targetDate, params, isUsable) {
  const dates = recentDateCandidates(targetDate, 14);
  for (let i = 0; i < dates.length; i += 1) {
    const date = dates[i];
    const query = Object.assign({}, params, { response: 'json', date: ymdCompact(date) });
    const url = 'https://www.twse.com.tw/' + path + '?' + toQuery(query);
    try {
      const json = fetchJson(url, {
        Referer: 'https://www.twse.com.tw/',
        'User-Agent': 'Mozilla/5.0'
      });
      if (isUsable(json)) {
        return { date: json.date || ymdCompact(date), json: json };
      }
    } catch (error) {
      console.warn(path + ' ' + date + ': ' + error.message);
    }
  }
  throw new Error('No usable TWSE table for ' + path + ' near ' + targetDate);
}

function scheduledRefreshDecision(now) {
  const parts = taipeiDateTimeParts(now);
  const tradingDay = tradingDayDecision(parts.ymd);
  const marketStart = 8 * 60 + 45;
  const afterMarketEnd = 15 * 60 + 45;
  const shouldRun = tradingDay.isTradingDay && parts.minutes >= marketStart && parts.minutes <= afterMarketEnd;
  return {
    shouldRun: shouldRun,
    isTradingDay: tradingDay.isTradingDay,
    reason: shouldRun ? 'TRADING_UPDATE_WINDOW' : tradingDay.reason || 'OUTSIDE_UPDATE_WINDOW',
    date: parts.ymd,
    time: parts.hhmm,
    timezone: 'Asia/Taipei',
    updateWindow: '08:45-15:45',
    holidayCheckError: tradingDay.error || null
  };
}

function tradingDayDecision(ymd) {
  const date = parseYmd(ymd);
  const day = date.getUTCDay();
  if (day === 0 || day === 6) {
    return { isTradingDay: false, reason: 'WEEKEND' };
  }

  try {
    const dates = twseNonTradingDates(date.getUTCFullYear());
    if (dates.indexOf(ymd) >= 0) {
      return { isTradingDay: false, reason: 'TWSE_CLOSED' };
    }
  } catch (error) {
    return { isTradingDay: true, reason: 'HOLIDAY_CHECK_FAILED', error: error.message };
  }

  return { isTradingDay: true, reason: 'TRADING_DAY' };
}

function twseNonTradingDates(year) {
  const key = HOLIDAY_CACHE_PREFIX + year;
  const props = PropertiesService.getScriptProperties();
  const saved = props.getProperty(key);
  if (saved) return JSON.parse(saved);

  const json = fetchJson('https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule', {
    Referer: 'https://www.twse.com.tw/',
    'User-Agent': 'Mozilla/5.0'
  });
  const rocYear = String(year - 1911);
  const dates = [];
  (Array.isArray(json) ? json : []).forEach(function(row) {
    const rawDate = String(row.Date || '');
    if (rawDate.slice(0, rocYear.length) !== rocYear) return;
    const text = [row.Name, row.Description].join(' ');
    const isClosed = /放假|無交易|休市|停止交易/.test(text) && !/開始交易|最後交易/.test(text);
    if (isClosed) dates.push(rocDateToYmd(rawDate));
  });
  props.setProperty(key, JSON.stringify(dates));
  return dates;
}

function taipeiDateTimeParts(date) {
  const ymd = Utilities.formatDate(date, 'Asia/Taipei', 'yyyy-MM-dd');
  const hhmm = Utilities.formatDate(date, 'Asia/Taipei', 'HH:mm');
  const parts = hhmm.split(':').map(function(value) { return Number(value); });
  return {
    ymd: ymd,
    hhmm: hhmm,
    minutes: parts[0] * 60 + parts[1]
  };
}

function rocDateToYmd(value) {
  const text = String(value || '');
  const year = Number(text.slice(0, text.length - 4)) + 1911;
  const month = text.slice(-4, -2);
  const day = text.slice(-2);
  return year + '-' + month + '-' + day;
}

function parseInstitutionalRows(json) {
  const out = {};
  (json.data || []).forEach(function(row) {
    const code = String(row[0] || '').trim();
    if (!code) return;
    const foreignNet = numberAt(row, 4);
    const foreignDealerNet = numberAt(row, 7);
    const trustNet = numberAt(row, 10);
    const dealerNet = numberAt(row, 11);
    const totalNet = numberAt(row, 18);
    out[code] = {
      foreignNet: foreignNet,
      foreignDealerNet: foreignDealerNet,
      trustNet: trustNet,
      dealerNet: dealerNet,
      totalNet: totalNet
    };
  });
  return out;
}

function parseMarginRows(json) {
  const table = json.tables && json.tables[1] ? json.tables[1] : null;
  if (!table) return {};
  const out = {};
  (table.data || []).forEach(function(row) {
    const code = String(row[0] || '').trim();
    if (!code) return;
    const marginPrev = parseTwseNumber(row[5]) || 0;
    const marginToday = parseTwseNumber(row[6]) || 0;
    const shortPrev = parseTwseNumber(row[11]) || 0;
    const shortToday = parseTwseNumber(row[12]) || 0;
    out[code] = {
      marginBuy: parseTwseNumber(row[2]) || 0,
      marginSell: parseTwseNumber(row[3]) || 0,
      marginCashRepay: parseTwseNumber(row[4]) || 0,
      marginPrev: marginPrev,
      marginToday: marginToday,
      marginChange: marginToday - marginPrev,
      shortBuy: parseTwseNumber(row[8]) || 0,
      shortSell: parseTwseNumber(row[9]) || 0,
      shortCashRepay: parseTwseNumber(row[10]) || 0,
      shortPrev: shortPrev,
      shortToday: shortToday,
      shortChange: shortToday - shortPrev,
      dayTradeOffset: parseTwseNumber(row[14]) || 0
    };
  });
  return out;
}

function parseShortLendingRows(json) {
  const out = {};
  ((json && json.data) || []).forEach(function(row) {
    const code = String(row[0] || '').trim();
    if (!code) return;
    const previous = parseTwseNumber(row[8]) || 0;
    const today = parseTwseNumber(row[12]) || 0;
    out[code] = {
      previousBalance: previous,
      soldToday: parseTwseNumber(row[9]) || 0,
      returnedToday: parseTwseNumber(row[10]) || 0,
      adjustedToday: parseTwseNumber(row[11]) || 0,
      todayBalance: today,
      change: today - previous,
      changeRatio: previous ? (today - previous) / previous : 0
    };
  });
  return out;
}

function parseDayTradeRows(json) {
  const table = json && json.tables && json.tables[1] ? json.tables[1] : null;
  const out = {};
  ((table && table.data) || []).forEach(function(row) {
    const code = String(row[0] || '').trim();
    if (!code) return;
    out[code] = {
      eligible: true,
      suspendedSellFirst: Boolean(String(row[2] || '').trim()),
      volume: parseTwseNumber(row[3]) || 0,
      buyValue: parseTwseNumber(row[4]) || 0,
      sellValue: parseTwseNumber(row[5]) || 0
    };
  });
  return out;
}

function parseNoticeRows(json) {
  const out = {};
  ((json && json.data) || []).forEach(function(row) {
    const code = String(row[1] || '').trim();
    if (!code) return;
    out[code] = {
      active: true,
      count: parseTwseNumber(row[3]) || 1,
      reason: String(row[4] || '官方注意交易資訊').trim()
    };
  });
  return out;
}

function buildChipSignal(institutional, margin, shortLending, dayTrade, notice, institutionalDate, marginDate, shortLendingDate, dayTradeDate, noticeDate) {
  const hasInstitutional = Boolean(institutional);
  const hasMargin = Boolean(margin);
  const foreignNet = hasInstitutional ? institutional.foreignNet : 0;
  const dealerNet = hasInstitutional ? institutional.dealerNet : 0;
  const trustNet = hasInstitutional ? institutional.trustNet : 0;
  const totalNet = hasInstitutional ? institutional.totalNet : 0;
  const marginChange = hasMargin ? margin.marginChange : 0;
  const shortChange = hasMargin ? margin.shortChange : 0;
  const marginChangeRatio = hasMargin && margin.marginPrev ? marginChange / margin.marginPrev : 0;
  const shortChangeRatio = hasMargin && margin.shortPrev ? shortChange / margin.shortPrev : 0;
  const securitiesLendingChangeRatio = shortLending ? shortLending.changeRatio : null;
  const institutionalOk = !hasInstitutional || (totalNet > 0 && (foreignNet > 0 || dealerNet > 0 || trustNet > 0));
  const marginOk = !hasMargin || marginChangeRatio <= 0.02;
  const shortOk = !hasMargin || shortChangeRatio <= 0.08;
  const largeTraderProxyOk = !hasInstitutional || totalNet > 0 || foreignNet > 0;
  const chipFlowOk = institutionalOk && marginOk && shortOk && largeTraderProxyOk;

  return {
    institutional: institutional || null,
    margin: margin || null,
    shortLending: shortLending || null,
    dayTrade: dayTrade || null,
    notice: notice || null,
    institutionalDate: institutionalDate || null,
    marginDate: marginDate || null,
    shortLendingDate: shortLendingDate || null,
    dayTradeDate: dayTradeDate || null,
    noticeDate: noticeDate || null,
    institutionalOk: institutionalOk,
    marginOk: marginOk,
    shortOk: shortOk,
    largeTraderProxyOk: largeTraderProxyOk,
    chipFlowOk: chipFlowOk,
    marginChangeRatio: marginChangeRatio,
    shortChangeRatio: shortChangeRatio,
    securitiesLendingChangeRatio: securitiesLendingChangeRatio,
    dayTradeEligible: dayTrade ? dayTrade.eligible : null,
    suspendedSellFirst: dayTrade ? dayTrade.suspendedSellFirst : null,
    dayTradeVolume: dayTrade ? dayTrade.volume : null,
    noticeActive: Boolean(notice && notice.active),
    noticeCount: notice ? notice.count : 0,
    noticeReason: notice ? notice.reason : null
  };
}

function fetchJson(url, headers) {
  return JSON.parse(fetchText(url, headers));
}

function fetchText(url, headers) {
  const response = UrlFetchApp.fetch(url, {
    headers: headers || {},
    followRedirects: true,
    muteHttpExceptions: true
  });
  const code = response.getResponseCode();
  if (code < 200 || code >= 300) throw new Error(url + ' HTTP ' + code);
  return response.getContentText();
}

function parseTwseNumber(value) {
  const number = Number(String(value || '').replace(/,/g, ''));
  return Number.isFinite(number) ? number : null;
}

function bestTwsePrice(item) {
  const lastPrice = parseTwseNumber(item.z);
  if (lastPrice != null) return lastPrice;
  const previousLast = parseTwseNumber(item.pz);
  if (previousLast != null) return previousLast;
  const bestBid = parseTwseNumber(String(item.b || '').split('_')[0]);
  const bestAsk = parseTwseNumber(String(item.a || '').split('_')[0]);
  if (bestBid != null && bestAsk != null) return (bestBid + bestAsk) / 2;
  return parseTwseNumber(item.y);
}

function bestTwseSidePrice(value) {
  return parseTwseNumber(String(value || '').split('_')[0]);
}

function rowsFromChart(result) {
  const quote = result.indicators.quote[0];
  return (result.timestamp || []).map(function(ts, index) {
    return {
      date: new Date(ts * 1000).toISOString().slice(0, 10),
      open: quote.open[index],
      high: quote.high[index],
      low: quote.low[index],
      close: quote.close[index],
      volume: quote.volume[index] || 0
    };
  }).filter(function(row) {
    return row.close != null && row.open != null;
  });
}

function mergeLatestRow(rows, latestQuote) {
  if (!latestQuote || latestQuote.price == null || !rows.length) return rows;
  const merged = rows.slice();
  const lastRow = Object.assign({}, last(merged));
  lastRow.close = latestQuote.price;
  lastRow.open = latestQuote.open != null ? latestQuote.open : lastRow.open;
  lastRow.high = Math.max(lastRow.high || latestQuote.price, latestQuote.high || latestQuote.price, latestQuote.price);
  lastRow.low = Math.min(lastRow.low || latestQuote.price, latestQuote.low || latestQuote.price, latestQuote.price);
  lastRow.volume = Math.max(lastRow.volume || 0, latestQuote.volume || 0);
  merged[merged.length - 1] = lastRow;
  return merged;
}

function gradeCandidate(base, rows, latestQuote, officialChip) {
  const mergedRows = mergeLatestRow(rows, latestQuote);
  const closes = rows.map(function(row) { return row.close; });
  const markedCloses = mergedRows.map(function(row) { return row.close; });
  const volumes = mergedRows.map(function(row) { return row.volume; });
  const latest = last(mergedRows);
  const prev = mergedRows.length > 1 ? mergedRows[mergedRows.length - 2] : latest;
  const ma20 = sma(closes, 20);
  const ma50 = sma(closes, 50);
  const volume20 = sma(volumes, 20) || latest.volume;
  const high20 = highest(closes.slice(0, -1), 20) || prev.close;
  const rsi14 = rsi(closes, 14);
  const m = macd(closes);
  const trendOk = ma20 != null && ma50 != null && latest.close > ma20 && latest.close > ma50;
  const volumeRatio = volume20 ? latest.volume / volume20 : 1;
  const volumePriceOk = latest.close >= high20 * 0.985 || volumeRatio >= 1.2;
  const momentumOk = (rsi14 == null || rsi14 >= 50) && (m.hist == null || m.hist >= 0);
  const chipSignal = officialChip || buildChipSignal(null, null, null, null, null, null, null, null, null, null);
  const institutionalNetRatio = latest.volume && chipSignal.institutional ? chipSignal.institutional.totalNet / latest.volume : 0;
  const dayTradeCompactDate = chipSignal.dayTradeDate ? String(chipSignal.dayTradeDate).replace(/-/g, '') : null;
  const dayTradeReferenceRow = dayTradeCompactDate ? mergedRows.find(function(row) {
    return ymdCompact(row.date) === dayTradeCompactDate;
  }) : null;
  const dayTradeRatio = dayTradeReferenceRow && dayTradeReferenceRow.volume && chipSignal.dayTradeVolume != null
    ? chipSignal.dayTradeVolume / dayTradeReferenceRow.volume : null;
  chipSignal.dayTradeRatio = dayTradeRatio;
  const executionRiskReasons = [];
  if (chipSignal.dataDateAligned === false) executionRiskReasons.push('籌碼資料日期與成交量排名不一致');
  if (chipSignal.noticeActive) executionRiskReasons.push('證交所注意股票：' + (chipSignal.noticeReason || '官方注意交易資訊'));
  if (dayTradeRatio != null && dayTradeRatio > 0.60) executionRiskReasons.push('近一期當沖成交量占比超過60%');
  const dynamicChipOk = !executionRiskReasons.length && chipSignal.chipFlowOk
    && (base.chipOk || institutionalNetRatio >= 0.03 || chipSignal.largeTraderProxyOk);
  const all = base.industryOk && base.fundamentalOk && dynamicChipOk && trendOk && volumePriceOk && momentumOk;
  const backed = base.industryOk || base.fundamentalOk || dynamicChipOk;
  const signalGrade = all ? 'A' : trendOk && volumePriceOk && momentumOk && backed ? 'B' : trendOk || volumePriceOk || momentumOk ? 'C' : 'BLOCKED';
  const grade = executionRiskReasons.length ? 'BLOCKED' : signalGrade;
  const stopPrice = Math.round(Math.min(latest.close * 0.94, ma20 || latest.close * 0.94) * 10) / 10;
  const targetPrice = Math.round(latest.close * 1.08 * 10) / 10;
  const intradayReturnPct = latest.open ? latest.close / latest.open - 1 : 0;
  const spreadPct = quoteSpreadPct(latestQuote, latest.close);
  const executionPlan = buildExecutionPlan(grade, trendOk, volumePriceOk, momentumOk, dynamicChipOk, volumeRatio, intradayReturnPct, spreadPct);
  const overnightPlan = buildOvernightPlan(grade, trendOk, volumePriceOk, momentumOk, dynamicChipOk, volumeRatio, intradayReturnPct, latest, prev);

  return {
    symbol: base.code,
    name: base.name,
    group: base.group,
    price: round2(latest.close),
    bidPrice: latestQuote && latestQuote.bidPrice != null ? round2(latestQuote.bidPrice) : round2(latest.close),
    askPrice: latestQuote && latestQuote.askPrice != null ? round2(latestQuote.askPrice) : round2(latest.close),
    session: latestQuote && latestQuote.session ? latestQuote.session : 'REGULAR',
    afterMarketPrice: latestQuote && latestQuote.afterMarket ? round2(latestQuote.afterMarket.price) : null,
    afterMarketVolume: latestQuote && latestQuote.afterMarket ? latestQuote.afterMarket.volume : 0,
    afterMarketTransactions: latestQuote && latestQuote.afterMarket ? latestQuote.afterMarket.transactions : 0,
    afterMarketBidVolume: latestQuote && latestQuote.afterMarket ? latestQuote.afterMarket.bidVolume : 0,
    afterMarketAskVolume: latestQuote && latestQuote.afterMarket ? latestQuote.afterMarket.askVolume : 0,
    stopPrice: stopPrice,
    targetPrice: targetPrice,
    grade: grade,
    blockedReasons: executionRiskReasons,
    dayTradeOk: grade === 'A' && executionPlan.dayTradeOk
      && chipSignal.dayTradeEligible !== false && !chipSignal.suspendedSellFirst,
    overnightOk: overnightPlan.ok,
    executionPlan: executionPlan,
    overnightPlan: overnightPlan,
    intradayReturnPct: Math.max(-0.03, Math.min(0.03, intradayReturnPct)),
    heldSupplement: Boolean(base.heldSupplement),
    industryOk: base.industryOk,
    fundamentalOk: base.fundamentalOk,
    chipOk: dynamicChipOk,
    trendOk: trendOk,
    volumePriceOk: volumePriceOk,
    momentumOk: momentumOk,
    metrics: {
      date: latest.date,
      ma20: ma20,
      ma50: ma50,
      rsi14: rsi14,
      macdHist: m.hist,
      volumeRatio: volumeRatio,
      volumeRank: base.volumeRank || null,
      screeningVolume: base.screeningVolume || null,
      screeningClose: base.screeningClose || null,
      selectionScore: base.selectionScore || null,
      heldSupplement: Boolean(base.heldSupplement),
      sourceSymbol: base.symbol,
      latestQuoteTime: latestQuote && latestQuote.time ? latestQuote.time : null,
      latestQuoteProvider: latestQuote && latestQuote.provider ? latestQuote.provider : null,
      session: latestQuote && latestQuote.session ? latestQuote.session : 'REGULAR',
      bidPrice: latestQuote && latestQuote.bidPrice != null ? round2(latestQuote.bidPrice) : null,
      askPrice: latestQuote && latestQuote.askPrice != null ? round2(latestQuote.askPrice) : null,
      afterMarket: latestQuote && latestQuote.afterMarket ? latestQuote.afterMarket : null,
      spreadPct: spreadPct,
      dailyClose: last(rows).close,
      markedClose: last(markedCloses),
      chip: Object.assign({}, chipSignal, {
        institutionalNetRatio: institutionalNetRatio,
        baseChipOk: base.chipOk,
        dynamicChipOk: dynamicChipOk
      })
    }
  };
}

function nextSimulation(previous, day) {
  if (!previous || !Array.isArray(previous.daily) || !previous.daily.length) {
    return runFreshSimulation([day]);
  }
  const previousLatestDay = last(previous.daily);
  if (previousLatestDay && previousLatestDay.date === day.date) {
    if (day.session === 'AFTER_MARKET' && previousLatestDay.session !== 'AFTER_MARKET') {
      return applyAfterMarketSession(previous, day);
    }
    return rebalanceSameDay(previous, day);
  }
  return advanceOneDay(previous, day);
}

function runFreshSimulation(days) {
  const account = {
    initialCapital: CONFIG.initialCapital,
    cash: CONFIG.initialCapital,
    positions: [],
    realizedPnl: 0,
    totalFees: 0,
    totalTaxes: 0,
    trades: [],
    daily: [],
    dailyStopped: false,
    weeklyLimited: false,
    maxDrawdown: 0
  };
  days.filter(function(day) { return day.date >= CONFIG.simulationStartDate; })
    .forEach(function(day) { simulateDay(account, day); });
  return finalizeAccount(account, last(days));
}

function advanceOneDay(previous, day) {
  const account = cloneAccount(previous);
  simulateDay(account, day);
  return finalizeAccount(account, day);
}

function simulateDay(account, day) {
  const marketState = evaluateMarket(day);
  account.dailyStopped = false;
  sellByRules(account, day, marketState);
  buyByRules(account, day, marketState);
  runDayTrades(account, day, marketState);

  const previousEquity = account.daily.length ? last(account.daily).equity : account.initialCapital;
  const positionValue = marketValue(account.positions, day);
  const equity = account.cash + positionValue;
  const dayPnl = equity - previousEquity;
  const dayReturn = previousEquity ? dayPnl / previousEquity : 0;
  if (dayReturn <= CONFIG.dailyStopLossPct) account.dailyStopped = true;

  const peak = Math.max(account.initialCapital, maxDailyEquity(account.daily), equity);
  account.maxDrawdown = Math.min(account.maxDrawdown || 0, equity / peak - 1);
  account.weeklyLimited = equity / account.initialCapital - 1 <= CONFIG.weeklyStopLossPct;
  account.daily.push({
    date: day.date,
    equity: equity,
    cash: account.cash,
    positionValue: positionValue,
    dayPnl: dayPnl,
    marketLabel: marketState.label,
    session: day.session || 'REGULAR'
  });
}

function applyAfterMarketSession(previous, day) {
  const account = cloneAccount(previous);
  const marketState = evaluateMarket(day);
  account.dailyStopped = false;

  sellByRules(account, day, marketState);
  rotateOutOfWeakPositions(account, day, marketState);
  buyByRules(account, day, marketState);

  const positionValue = marketValue(account.positions, day);
  const equity = account.cash + positionValue;
  const previousDaily = account.daily.length > 1 ? account.daily[account.daily.length - 2] : null;
  const previousEquity = previousDaily ? previousDaily.equity : account.initialCapital;
  const lastDaily = last(account.daily);
  if (lastDaily) {
    account.daily[account.daily.length - 1] = Object.assign({}, lastDaily, {
      date: day.date,
      equity: equity,
      cash: account.cash,
      positionValue: positionValue,
      dayPnl: equity - previousEquity,
      marketLabel: marketState.label,
      session: 'AFTER_MARKET'
    });
  }

  const peak = Math.max(account.initialCapital, maxDailyEquity(account.daily), equity);
  account.maxDrawdown = Math.min(account.maxDrawdown || 0, equity / peak - 1);
  account.weeklyLimited = equity / account.initialCapital - 1 <= CONFIG.weeklyStopLossPct;
  return finalizeAccount(account, day);
}

function rebalanceSameDay(previous, day) {
  const account = cloneAccount(previous);
  const marketState = evaluateMarket(day);
  account.dailyStopped = false;

  sellByRules(account, day, marketState);
  rotateOutOfWeakPositions(account, day, marketState);
  buyByRules(account, day, marketState);
  runDayTrades(account, day, marketState);

  const positionValue = marketValue(account.positions, day);
  const equity = account.cash + positionValue;
  const previousDaily = account.daily.length > 1 ? account.daily[account.daily.length - 2] : null;
  const previousEquity = previousDaily ? previousDaily.equity : account.initialCapital;
  const lastDaily = last(account.daily);

  if (lastDaily) {
    account.daily[account.daily.length - 1] = Object.assign({}, lastDaily, {
      date: day.date,
      equity: equity,
      cash: account.cash,
      positionValue: positionValue,
      dayPnl: equity - previousEquity,
      marketLabel: marketState.label,
      session: day.session || lastDaily.session || 'REGULAR'
    });
  }

  const peak = Math.max(account.initialCapital, maxDailyEquity(account.daily), equity);
  account.maxDrawdown = Math.min(account.maxDrawdown || 0, equity / peak - 1);
  account.weeklyLimited = equity / account.initialCapital - 1 <= CONFIG.weeklyStopLossPct;
  return finalizeAccount(account, day);
}

function finalizeAccount(account, day) {
  const finalEquity = account.daily.length ? last(account.daily).equity : account.initialCapital;
  return Object.assign(account, {
    finalEquity: finalEquity,
    totalReturn: finalEquity / account.initialCapital - 1,
    maxDrawdown: account.maxDrawdown || 0,
    generatedAt: new Date().toISOString(),
    source: day && day.source ? day.source : null
  });
}

function cloneAccount(previous) {
  return {
    initialCapital: previous.initialCapital || CONFIG.initialCapital,
    cash: Number(previous.cash || 0),
    positions: JSON.parse(JSON.stringify(previous.positions || [])),
    realizedPnl: Number(previous.realizedPnl || 0),
    totalFees: Number(previous.totalFees || 0),
    totalTaxes: Number(previous.totalTaxes || 0),
    trades: JSON.parse(JSON.stringify(previous.trades || [])),
    daily: JSON.parse(JSON.stringify(previous.daily || [])),
    dailyStopped: Boolean(previous.dailyStopped),
    weeklyLimited: Boolean(previous.weeklyLimited),
    maxDrawdown: Number(previous.maxDrawdown || 0)
  };
}

function evaluateMarket(day) {
  const close = day.market.close;
  const ma20 = day.market.ma20;
  const ma50 = day.market.ma50;
  if (close > ma20 && close > ma50) return { mode: 'AGGRESSIVE', label: '\u7a4d\u6975\u505a\u591a', maxGrade: 'A' };
  if (close <= ma50) return { mode: 'DEFENSIVE', label: '\u9632\u5b88\u89c0\u671b', maxGrade: 'C' };
  return { mode: 'LIGHT', label: '\u8f15\u5009\u8a66\u55ae', maxGrade: 'B' };
}

function buildPreOpenPlan(market, date) {
  const close = market.close;
  const above20 = close > market.ma20;
  const above50 = close > market.ma50;
  const stance = above20 && above50 ? '偏多' : above50 ? '中性偏保守' : '高風險';
  return {
    date: date,
    stance: stance,
    allowNewPositions: above50,
    allowChasing: above20 && above50,
    checklist: [
      '開盤前確認美股、費半、台指期與匯率方向',
      '檢查 AI、半導體、電力、機器人族群新聞與公司公告',
      '避開重大財報、法說、除權息、處置與注意股風險',
      '若國際市場偏空或新聞混亂，當日只允許小部位或不操作'
    ]
  };
}

function buildExecutionPlan(grade, trendOk, volumePriceOk, momentumOk, chipOk, volumeRatio, intradayReturnPct, spreadPct) {
  const strongSignal = grade === 'A' && trendOk && volumePriceOk && momentumOk && chipOk;
  const liquid = volumeRatio >= 1.1 && spreadPct <= CONFIG.maxLimitOrderSpreadPct;
  const chasingRisk = !CONFIG.allowChasing || intradayReturnPct > CONFIG.maxChasePct || spreadPct > CONFIG.maxLimitOrderSpreadPct;
  const dayTradeOk = CONFIG.allowDayTrade && strongSignal && liquid && Math.abs(intradayReturnPct) >= 0.002;
  let orderType = 'NO_TRADE';
  let chaseAllowed = false;
  let cancelAfterSeconds = 0;
  let reason = '條件不足，先不操作';

  if (strongSignal && liquid && !chasingRisk) {
    orderType = CONFIG.allowMarketableOrders && spreadPct <= CONFIG.maxMarketOrderSpreadPct && volumeRatio >= 1.5 ? 'LIMIT_OR_MARKETABLE' : 'LIMIT';
    chaseAllowed = intradayReturnPct <= CONFIG.maxChasePct && spreadPct <= CONFIG.maxMarketOrderSpreadPct;
    cancelAfterSeconds = dayTradeOk ? 20 : 90;
    reason = chaseAllowed ? 'A 級共振且價差小，可微追但需設滑價上限' : 'A 級共振但不追價，以限價等待';
  } else if (strongSignal && liquid) {
    orderType = 'LIMIT_ONLY';
    cancelAfterSeconds = 60;
    reason = '訊號合格但追價風險偏高，只能限價，不追市價';
  }

  return {
    allowEntry: orderType !== 'NO_TRADE',
    orderType: orderType,
    chaseAllowed: chaseAllowed,
    cancelAfterSeconds: cancelAfterSeconds,
    dayTradeOk: dayTradeOk,
    spreadPct: spreadPct,
    maxChasePct: CONFIG.maxChasePct,
    reason: reason,
    cancelRules: [
      '跌回突破價或前一日收盤下方',
      '委買支撐撤退或價差放大',
      '大盤或同族群轉弱',
      '掛單等待逾時仍未成交'
    ]
  };
}

function buildOvernightPlan(grade, trendOk, volumePriceOk, momentumOk, chipOk, volumeRatio, intradayReturnPct, latest, prev) {
  const closeNearHigh = latest.high ? latest.close >= latest.high * 0.985 : latest.close >= prev.close;
  const notOverextended = intradayReturnPct <= 0.035;
  const ok = CONFIG.allowOvernight && (grade === 'A' || grade === 'B') &&
    trendOk && volumePriceOk && momentumOk && chipOk &&
    volumeRatio >= 1.0 && closeNearHigh && notOverextended;
  return {
    ok: ok,
    positionPct: ok ? CONFIG.overnightPositionPct : 0,
    reason: ok
      ? '收盤強、量價與籌碼支撐，可列隔日沖候選，隔天不續強就出場'
      : '隔夜延續條件不足，不列隔日沖',
    exitRules: [
      '隔天開高不續強即停利或退出',
      '跌破前一日收盤或尾盤支撐即退出',
      '新聞或國際市場轉弱時降低部位'
    ]
  };
}

function accountEquity(account, day) {
  if (day) return Number(account.cash || 0) + marketValue(account.positions || [], day);
  if (account.daily && account.daily.length) return Number(last(account.daily).equity || account.initialCapital || CONFIG.initialCapital);
  return Number(account.initialCapital || CONFIG.initialCapital);
}

function accountCashRatio(account, day) {
  const equity = accountEquity(account, day);
  return equity ? Number(account.cash || 0) / equity : 0;
}

function tradingThrottle(account, day) {
  const equity = accountEquity(account, day);
  const latestDaily = account.daily && account.daily.length ? last(account.daily) : null;
  const previousDaily = latestDaily && latestDaily.date === day.date && account.daily.length > 1
    ? account.daily[account.daily.length - 2]
    : latestDaily;
  const previousEquity = previousDaily ? Number(previousDaily.equity || account.initialCapital) : Number(account.initialCapital || CONFIG.initialCapital);
  const dayReturn = previousEquity ? (equity - previousEquity) / previousEquity : 0;
  const cashRatio = accountCashRatio(account, day);
  if (dayReturn >= CONFIG.dailyProfitLockPct) {
    return { allowNewRisk: false, label: '已達每日小賺目標，停止新增風險', dayReturn: dayReturn, cashRatio: cashRatio };
  }
  if (dayReturn <= CONFIG.dailySoftStopLossPct) {
    return { allowNewRisk: false, label: '日內虧損達軟停損，停止新增風險', dayReturn: dayReturn, cashRatio: cashRatio };
  }
  if (cashRatio < CONFIG.minCashReservePct) {
    return { allowNewRisk: false, label: '現金低於最低保留比例，不新增部位', dayReturn: dayReturn, cashRatio: cashRatio };
  }
  if (cashRatio < CONFIG.cashCautionPct) {
    return { allowNewRisk: true, reduceSize: true, label: '現金偏低，只允許減碼後的小部位', dayReturn: dayReturn, cashRatio: cashRatio };
  }
  return { allowNewRisk: true, reduceSize: false, label: '資金水位正常，可依訊號操作', dayReturn: dayReturn, cashRatio: cashRatio };
}

function canOpenPosition(candidate, marketState, account) {
  if (account.dailyStopped) return false;
  if (candidate.heldSupplement) return false;
  if (candidate.grade === 'BLOCKED' || candidate.price <= candidate.stopPrice) return false;
  if (marketState.mode === 'DEFENSIVE') return false;
  if (!candidate.executionPlan || !candidate.executionPlan.allowEntry) return false;
  return candidate.grade === 'A';
}

function positionPct(candidate, account) {
  const cashRatio = accountCashRatio(account);
  if (cashRatio < CONFIG.cashCautionPct) return Math.min(CONFIG.halfPositionPct, CONFIG.standardPositionPct / 2);
  if (account.weeklyLimited) return CONFIG.halfPositionPct;
  if (candidate.session === 'AFTER_MARKET') return CONFIG.afterMarketPositionPct;
  if (candidate.overnightOk) return CONFIG.overnightPositionPct;
  return candidate.grade === 'A' ? CONFIG.standardPositionPct : CONFIG.halfPositionPct;
}

function sellByRules(account, day, marketState) {
  if (!CONFIG.allowAutoSell) return;
  const stillHolding = [];
  account.positions.forEach(function(position) {
    const candidate = findCandidate(day, position.symbol);
    if (!candidate) {
      stillHolding.push(position);
      return;
    }
    const sellPrice = executionSellPrice(candidate);
    const grossAmount = position.shares * sellPrice;
    const shouldSell = sellPrice <= position.stopPrice ||
      sellPrice >= position.targetPrice ||
      candidate.grade === 'BLOCKED' ||
      marketState.mode === 'DEFENSIVE';

    if (!shouldSell) {
      stillHolding.push(position);
      return;
    }

    const fee = tradeFee(grossAmount);
    const tax = sellTax(grossAmount, false);
    const proceeds = grossAmount - fee - tax;
    const pnl = proceeds - position.totalCost;
    account.cash += proceeds;
    account.realizedPnl += pnl;
    account.totalFees += fee;
    account.totalTaxes += tax;
    account.trades.push({
      date: day.date,
      action: 'SELL',
      symbol: position.symbol,
      name: position.name,
      shares: position.shares,
      price: sellPrice,
      grossAmount: grossAmount,
      fee: fee,
      tax: tax,
      pnl: pnl,
      session: candidate.session || day.session || 'REGULAR',
      reason: sellReason(candidate, marketState, position) + sessionReason(candidate)
    });
  });
  account.positions = stillHolding;
}

function rotateOutOfWeakPositions(account, day, marketState) {
  if (marketState.mode === 'DEFENSIVE' || account.dailyStopped) return;
  const hasAOpportunity = day.candidates.some(function(candidate) {
    return canOpenPosition(candidate, marketState, account);
  });
  if (!hasAOpportunity) return;

  const stillHolding = [];
  account.positions.forEach(function(position) {
    const candidate = findCandidate(day, position.symbol);
    if (!candidate || candidate.grade === 'A') {
      stillHolding.push(position);
      return;
    }

    const sellPrice = executionSellPrice(candidate);
    const grossAmount = position.shares * sellPrice;
    const fee = tradeFee(grossAmount);
    const tax = sellTax(grossAmount, false);
    const proceeds = grossAmount - fee - tax;
    const pnl = proceeds - position.totalCost;
    account.cash += proceeds;
    account.realizedPnl += pnl;
    account.totalFees += fee;
    account.totalTaxes += tax;
    account.trades.push({
      date: day.date,
      action: 'SELL',
      symbol: position.symbol,
      name: position.name,
      shares: position.shares,
      price: sellPrice,
      grossAmount: grossAmount,
      fee: fee,
      tax: tax,
      pnl: pnl,
      session: candidate.session || day.session || 'REGULAR',
      reason: '出現 A 級候選股，非 A 持倉輪動轉出' + sessionReason(candidate)
    });
  });
  account.positions = stillHolding;
}

function buyByRules(account, day, marketState) {
  if (!CONFIG.allowAutoBuy) return;
  const throttle = tradingThrottle(account, day);
  if (!throttle.allowNewRisk) return;
  day.candidates.filter(function(candidate) {
    return canOpenPosition(candidate, marketState, account);
  }).forEach(function(candidate) {
    if (account.positions.some(function(position) { return position.symbol === candidate.symbol; })) return;
    const budget = accountEquity(account, day) * (throttle.reduceSize ? Math.min(positionPct(candidate, account), CONFIG.halfPositionPct) : positionPct(candidate, account));
    const buyPrice = executionBuyPrice(candidate);
    const unitCost = buyPrice * CONFIG.boardLot;
    const availableCash = tradableCash(account, day);
    const units = Math.floor(Math.min(budget, availableCash) / unitCost);
    const shares = units * CONFIG.boardLot;
    if (shares <= 0) return;

    const grossAmount = shares * buyPrice;
    const fee = tradeFee(grossAmount);
    const totalCost = grossAmount + fee;
    if (totalCost > tradableCash(account, day)) return;

    account.cash -= totalCost;
    account.totalFees += fee;
    account.positions.push({
      symbol: candidate.symbol,
      name: candidate.name,
      shares: shares,
      avgCost: buyPrice,
      totalCost: totalCost,
      stopPrice: candidate.stopPrice,
      targetPrice: candidate.targetPrice
    });
    account.trades.push({
      date: day.date,
      action: 'BUY',
      symbol: candidate.symbol,
      name: candidate.name,
      shares: shares,
      price: buyPrice,
      grossAmount: grossAmount,
      fee: fee,
      tax: 0,
      pnl: 0,
      session: candidate.session || day.session || 'REGULAR',
      reason: candidate.grade + ' 級共振，' + candidate.executionPlan.reason + '；' + throttle.label + '；手續費 ' + fee + sessionReason(candidate)
    });
  });
}

function runDayTrades(account, day, marketState) {
  if (!CONFIG.allowDayTrade) return;
  if (day.session === 'AFTER_MARKET') return;
  if (marketState.mode === 'DEFENSIVE' || account.dailyStopped) return;
  const throttle = tradingThrottle(account, day);
  if (!throttle.allowNewRisk || throttle.reduceSize) return;
  day.candidates.filter(function(candidate) {
    return candidate.dayTradeOk && candidate.executionPlan && candidate.executionPlan.dayTradeOk && !hasTrade(account, day.date, candidate.symbol, 'DAYTRADE');
  }).forEach(function(candidate) {
    const budget = accountEquity(account, day) * CONFIG.dayTradeCapitalPct;
    const buyPrice = executionBuyPrice(candidate);
    const sellPrice = executionSellPrice(candidate);
    const unitCost = buyPrice * CONFIG.boardLot;
    const units = Math.floor(Math.min(budget, tradableCash(account, day)) / unitCost);
    const shares = units * CONFIG.boardLot;
    if (shares <= 0) return;

    const buyAmount = shares * buyPrice;
    const buyFee = tradeFee(buyAmount);
    if (buyAmount + buyFee > tradableCash(account, day)) return;
    const sellAmount = shares * sellPrice;
    const sellFee = tradeFee(sellAmount);
    const tax = sellTax(sellAmount, true);
    const pnl = sellAmount - buyAmount - buyFee - sellFee - tax;
    account.cash += pnl;
    account.realizedPnl += pnl;
    account.totalFees += buyFee + sellFee;
    account.totalTaxes += tax;
    account.trades.push({
      date: day.date,
      action: 'DAYTRADE',
      symbol: candidate.symbol,
      name: candidate.name,
      shares: shares,
      price: buyPrice,
      grossAmount: buyAmount + sellAmount,
      fee: buyFee + sellFee,
      tax: tax,
      pnl: pnl,
      session: 'REGULAR',
      reason: '當沖規則模擬，' + candidate.executionPlan.reason + '；使用目前委買／委賣價估算'
    });
  });
}

function hasTrade(account, date, symbol, action) {
  return account.trades.some(function(trade) {
    return trade.date === date && trade.symbol === symbol && trade.action === action;
  });
}

function sellReason(candidate, marketState, position) {
  if (candidate.price <= position.stopPrice) return '跌破停損價';
  if (candidate.price >= position.targetPrice) return '達到目標價';
  if (candidate.grade === 'BLOCKED') return '訊號遭規則阻擋';
  if (marketState.mode === 'DEFENSIVE') return '大盤進入防守模式';
  return '依出場規則賣出';
}

function sessionReason(candidate) {
  if (candidate && candidate.session === 'AFTER_MARKET') {
    return '；盤後定價模擬';
  }
  return '；盤中模擬';
}

function marketValue(positions, day) {
  return positions.reduce(function(sum, position) {
    const candidate = findCandidate(day, position.symbol);
    const grossValue = position.shares * (candidate ? executionSellPrice(candidate) : position.avgCost);
    return sum + netSellProceeds(grossValue, false);
  }, 0);
}

function findCandidate(day, symbol) {
  return day.candidates.find(function(candidate) { return candidate.symbol === symbol; });
}

function tradeFee(amount) {
  if (amount <= 0) return 0;
  return Math.max(CONFIG.minBrokerFee, Math.round(amount * CONFIG.brokerFeeRate));
}

function sellTax(amount, isDayTrade) {
  return Math.round(amount * (isDayTrade ? CONFIG.dayTradeSellTaxRate : CONFIG.stockSellTaxRate));
}

function netSellProceeds(amount, isDayTrade) {
  return amount - tradeFee(amount) - sellTax(amount, isDayTrade);
}

function executionBuyPrice(candidate) {
  return Number(candidate.askPrice || candidate.price || 0);
}

function executionSellPrice(candidate) {
  return Number(candidate.bidPrice || candidate.price || 0);
}

function quoteSpreadPct(quote, fallbackPrice) {
  if (!quote || quote.bidPrice == null || quote.askPrice == null) return 0;
  const mid = (quote.bidPrice + quote.askPrice) / 2 || fallbackPrice || 1;
  return mid ? Math.max(0, quote.askPrice - quote.bidPrice) / mid : 0;
}

function minCashReserve(account, day) {
  return accountEquity(account, day) * CONFIG.minCashReservePct;
}

function tradableCash(account, day) {
  return Math.max(0, Number(account.cash || 0) - minCashReserve(account, day));
}

function sma(values, period) {
  if (values.length < period) return null;
  return values.slice(values.length - period).reduce(function(sum, value) { return sum + value; }, 0) / period;
}

function highest(values, period) {
  if (values.length < period) return null;
  return Math.max.apply(null, values.slice(values.length - period));
}

function rsi(values, period) {
  period = period || 14;
  if (values.length <= period) return null;
  let gain = 0;
  let loss = 0;
  for (let i = values.length - period; i < values.length; i += 1) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gain += diff;
    else loss -= diff;
  }
  if (loss === 0) return 100;
  const rs = gain / period / (loss / period);
  return 100 - 100 / (1 + rs);
}

function emaSeries(values, period) {
  const k = 2 / (period + 1);
  const out = [];
  values.forEach(function(value, index) {
    if (index === 0) out.push(value);
    else out.push(value * k + out[index - 1] * (1 - k));
  });
  return out;
}

function macd(values) {
  if (values.length < 35) return { dif: null, signal: null, hist: null };
  const fast = emaSeries(values, 12);
  const slow = emaSeries(values, 26);
  const dif = fast.map(function(value, index) { return value - slow[index]; });
  const signal = emaSeries(dif, 9);
  return {
    dif: last(dif),
    signal: last(signal),
    hist: last(dif) - last(signal)
  };
}

function maxDailyEquity(daily) {
  if (!daily.length) return CONFIG.initialCapital;
  return Math.max.apply(null, daily.map(function(day) { return day.equity; }));
}

function coalesce(value, fallback) {
  return value != null ? value : fallback;
}

function numberAt(row, index) {
  if (index == null || index < 0) return 0;
  return parseTwseNumber(row[index]) || 0;
}

function recentDateCandidates(targetDate, days) {
  const out = [];
  const start = parseYmd(targetDate);
  for (let i = 0; i <= days; i += 1) {
    const d = new Date(start.getTime());
    d.setDate(d.getDate() - i);
    out.push(formatYmd(d));
  }
  return out;
}

function parseYmd(value) {
  const text = String(value || '').slice(0, 10);
  const parts = text.split('-').map(function(part) { return Number(part); });
  if (parts.length === 3 && parts.every(function(part) { return Number.isFinite(part); })) {
    return new Date(Date.UTC(parts[0], parts[1] - 1, parts[2]));
  }
  const now = new Date();
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

function formatYmd(date) {
  return date.toISOString().slice(0, 10);
}

function ymdCompact(value) {
  return String(value || '').replace(/-/g, '').slice(0, 8);
}

function toQuery(params) {
  return Object.keys(params).map(function(key) {
    return encodeURIComponent(key) + '=' + encodeURIComponent(params[key]);
  }).join('&');
}

function round2(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function last(values) {
  return values[values.length - 1];
}
