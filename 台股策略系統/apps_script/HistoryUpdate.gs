const HISTORY_DRIVE = {
  top50Folder: '1MxFVvokT86PlmmZ8ugHaID5iAsc90Qse',
  top50Manifest: '1_dUjbK480Mng6ABditIRUAtou1S9XP6m',
  stockDailyManifest: '1_0NnEjwCRkoguD9OowRnp7mQ8rovneKx',
  marketFlowManifest: '1euGZK6A2YzyQKrZehk7qvTLhOP83uOVm'
};

const MOPS_DRIVE = {
  companyBasicFolder: '1Qd_zkcAFa4Jc_Mlps3XJp35q3vG0TGqP',
  monthlyRevenueFolder: '1w6Xft0UqrC4lnFCRl8HYtnN5JjgrTBeS',
  quarterlyFinancialFolder: '1oNlmeY46SpjBoZCUUlLCGGu8AV1W-knd',
  majorMessagesFolder: '1r7ThzvUZeX6stObW1XrA42IrIAPisKsO',
  filingIndexFolder: '1sl84LYnUXJ149HhUzQKdcmPCnEQPL1l9',
  validationFolder: '1zN3mhXleUSdg_zc3_pZRwXpn0J3dXmcL'
};

const MOPS_OPENAPI_BASE = 'https://openapi.twse.com.tw/v1/opendata/';
const CLOUD_RUN_DRIVE_READER = 'tw-stock-runtime@project-aef205b5-5c27-4084-94c.iam.gserviceaccount.com';
const CLOUD_RUN_ANALYSIS_FOLDERS = [
  '1UN4xM089UmWq0XKbVJjlLM2avK7yHq-i', // 每日籌碼
  '1tzD1pSXC77ywAwgSirEnfdZ2lznoXS34', // 公司行動與還原因子
  '142XdplVTUEHIq6-H81Ug__9ym0LM7Zwa'  // MOPS 與全部子資料夾
];
const MOPS_FINANCIAL_ENDPOINTS = [
  't187ap06_L_ci', 't187ap06_L_fh', 't187ap06_L_ins', 't187ap06_L_bd', 't187ap06_L_basi', 't187ap06_L_mim',
  't187ap07_L_ci', 't187ap07_L_fh', 't187ap07_L_ins', 't187ap07_L_bd', 't187ap07_L_basi', 't187ap07_L_mim',
  't187ap17_L'
];

const HISTORY_TOP50_HEADER = [
  'trade_date', 'rank', 'stock_code', 'stock_name', 'trade_volume', 'trade_value',
  'transactions', 'open', 'high', 'low', 'close', 'price_change'
];

const HISTORY_DAILY_HEADER = [
  'trade_date', 'stock_code', 'stock_name', 'open', 'high', 'low', 'close',
  'trade_volume', 'trade_value', 'transactions', 'price_change', 'top50_rank', 'is_top50'
];

const HISTORY_FLOW_HEADER = [
  'trade_date', 'rank', 'stock_code', 'stock_name', 'foreign_buy', 'foreign_sell',
  'foreign_net', 'foreign_dealer_buy', 'foreign_dealer_sell', 'foreign_dealer_net',
  'investment_trust_buy', 'investment_trust_sell', 'investment_trust_net',
  'dealer_proprietary_buy', 'dealer_proprietary_sell', 'dealer_proprietary_net',
  'dealer_hedge_buy', 'dealer_hedge_sell', 'dealer_hedge_net', 'dealer_total_buy',
  'dealer_total_sell', 'dealer_total_net', 'institutional_total_net',
  'margin_previous_balance', 'margin_purchase', 'margin_sale', 'margin_cash_redemption',
  'margin_current_balance', 'margin_limit', 'short_previous_balance', 'short_sale',
  'short_purchase', 'short_stock_redemption', 'short_current_balance', 'short_limit',
  'margin_short_offset', 'sbl_previous_balance', 'sbl_sell', 'sbl_return',
  'sbl_adjustment', 'sbl_current_balance', 'sbl_next_limit',
  'institutional_report_available', 'margin_report_available', 'lending_report_available'
];

/**
 * 建立每日兩次的十年資料增量更新觸發器。
 * 19:15 執行主要更新；21:15 在 TWSE 籌碼報表較晚發布時補跑。
 * 資料已是最新日期時會直接結束，不重複寫入。
 */
function configureDailyHistoryUpdate() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'updateTenYearHistoryToLatestTradeDate') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger('updateTenYearHistoryToLatestTradeDate')
    .timeBased().everyDays(1).atHour(19).nearMinute(15).inTimezone('Asia/Taipei').create();
  ScriptApp.newTrigger('updateTenYearHistoryToLatestTradeDate')
    .timeBased().everyDays(1).atHour(21).nearMinute(15).inTimezone('Asia/Taipei').create();
  return {
    ok: true,
    handler: 'updateTenYearHistoryToLatestTradeDate',
    schedule: ['每日約 19:15', '每日約 21:15 補跑'],
    timezone: 'Asia/Taipei'
  };
}

/** 建立 MOPS/OpenAPI 每日增量更新；精確申報時間只取官方重大訊息，不以法定期限代填。 */
function configureMopsRollingUpdate() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'updateMopsRollingData') ScriptApp.deleteTrigger(trigger);
  });
  ScriptApp.newTrigger('updateMopsRollingData')
    .timeBased().everyDays(1).atHour(22).nearMinute(30).inTimezone('Asia/Taipei').create();
  return { ok: true, handler: 'updateMopsRollingData', schedule: '每日約 22:30', timezone: 'Asia/Taipei' };
}

/** 一次性設定 Cloud Run 對分析資料父資料夾的唯讀權限；新檔案會沿用父資料夾權限。 */
function configureCloudRunDriveReadAccess() {
  const results = CLOUD_RUN_ANALYSIS_FOLDERS.map(function(folderId) {
    const folder = DriveApp.getFolderById(folderId);
    folder.addViewer(CLOUD_RUN_DRIVE_READER);
    return { folderId: folderId, name: folder.getName(), role: 'reader', account: CLOUD_RUN_DRIVE_READER };
  });
  return { ok: true, folders: results };
}

/**
 * 更新供正式分析使用的 MOPS 最小資料集。
 * OpenAPI 只提供目前可取得的批次資料；十年季度 XBRL 仍由 Cloud Run 初始回填。
 */
function updateMopsRollingData() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const now = new Date();
    const year = Utilities.formatDate(now, 'Asia/Taipei', 'yyyy');
    const allowed = mopsAllowedSymbols();
    if (!Object.keys(allowed).length) throw new Error('MOPS 更新找不到前50歷史母體');

    const companyRows = mopsFetchOpenApi('t187ap03_L').filter(function(row) {
      return allowed[mopsStockCode(row)];
    }).map(mopsCompanyBasicRow).filter(mopsHasStockCode);
    const revenueRows = mopsFetchOpenApi('t187ap05_L').filter(function(row) {
      return allowed[mopsStockCode(row)];
    }).map(mopsMonthlyRevenueRow).filter(mopsHasStockCode);
    const messageRows = mopsFetchOpenApi('t187ap04_L').filter(function(row) {
      return allowed[mopsStockCode(row)];
    }).map(mopsMajorMessageRow).filter(mopsHasStockCode);

    let financialRows = [];
    const financialErrors = [];
    MOPS_FINANCIAL_ENDPOINTS.forEach(function(endpoint) {
      try {
        financialRows = financialRows.concat(mopsFetchOpenApi(endpoint).filter(function(row) {
          return allowed[mopsStockCode(row)];
        }).map(function(row) { return mopsFinancialRow(row, endpoint); }).filter(mopsHasStockCode));
      } catch (error) {
        financialErrors.push(endpoint + ': ' + String(error.message || error));
      }
    });
    if (!financialRows.length) throw new Error('MOPS 財報 OpenAPI 全部無資料：' + financialErrors.join('；'));

    const filingRows = messageRows.filter(function(row) {
      return /財務報告|財務報表|年報/.test(row.subject) && row.filing_date && row.filing_time;
    }).map(function(row) {
      return {
        stock_code: row.stock_code, stock_name: row.stock_name,
        filing_date: row.filing_date, filing_time: row.filing_time,
        available_from: row.available_from, subject: row.subject,
        source: 'TWSE_MOPS_OPENAPI', source_url: row.source_url
      };
    });

    const results = {
      company_basic: mopsReplaceSnapshot(MOPS_DRIVE.companyBasicFolder, 'company_basic_latest.jsonl', companyRows),
      monthly_revenue: mopsMergeJsonl(MOPS_DRIVE.monthlyRevenueFolder, 'monthly_revenue_' + year + '.jsonl', revenueRows,
        function(row) { return row.stock_code + '|' + row.data_year_month; }),
      quarterly_financials: mopsMergeJsonl(MOPS_DRIVE.quarterlyFinancialFolder, 'quarterly_openapi_' + year + '.jsonl', financialRows,
        function(row) { return row.stock_code + '|' + row.fiscal_year + '|' + row.quarter + '|' + row.report_kind; }),
      major_messages: mopsMergeJsonl(MOPS_DRIVE.majorMessagesFolder, 'major_messages_' + year + '.jsonl', messageRows,
        function(row) { return row.stock_code + '|' + row.filing_date + '|' + row.filing_time + '|' + row.subject; }),
      filing_index: mopsMergeJsonl(MOPS_DRIVE.filingIndexFolder, 'filing_times_' + year + '.jsonl', filingRows,
        function(row) { return row.stock_code + '|' + row.available_from + '|' + row.subject; })
    };
    const manifest = {
      dataset: 'MOPS_ROLLING', generated_at: now.toISOString(), status: financialErrors.length ? 'complete_with_warnings' : 'complete',
      universe: 'stocks ever entering TWSE_TOP50', symbol_count: Object.keys(allowed).length,
      source: 'TWSE OpenAPI', source_base: MOPS_OPENAPI_BASE,
      point_in_time_rule: 'Only official filing_date and filing_time form available_from; statutory deadlines are never substituted.',
      results: results, warnings: financialErrors,
      historical_xbrl: 'Initial 10-year quarterly backfill is maintained separately by the Cloud Run XBRL builder.'
    };
    mopsReplaceSnapshot(MOPS_DRIVE.validationFolder, 'mops_rolling_manifest.json', [manifest]);
    PropertiesService.getScriptProperties().setProperty('MOPS_LAST_SUCCESS', JSON.stringify(manifest));
    return { ok: true, status: manifest.status, generatedAt: manifest.generated_at, results: results, warnings: financialErrors };
  } finally {
    lock.releaseLock();
  }
}

function mopsAllowedSymbols() {
  const manifest = historyReadJson(HISTORY_DRIVE.stockDailyManifest);
  const out = {};
  (manifest.stock_codes || []).forEach(function(code) { if (/^\d{4}$/.test(String(code))) out[String(code)] = true; });
  return out;
}

function mopsFetchOpenApi(endpoint) {
  const response = UrlFetchApp.fetch(MOPS_OPENAPI_BASE + endpoint, {
    method: 'get', muteHttpExceptions: true,
    headers: { Accept: 'application/json', 'User-Agent': 'tw-stock-bot/1.0' }
  });
  if (response.getResponseCode() !== 200) throw new Error(endpoint + ' HTTP ' + response.getResponseCode());
  const payload = JSON.parse(response.getContentText('UTF-8'));
  if (!Array.isArray(payload)) throw new Error(endpoint + ' 回傳格式不是陣列');
  return payload;
}

function mopsStockCode(row) {
  const value = row['公司代號'] || row['公司代碼'] || row['證券代號'] || row['代號'] || '';
  const match = String(value).match(/\b\d{4}\b/);
  return match ? match[0] : '';
}

function mopsHasStockCode(row) { return Boolean(row && row.stock_code); }
function mopsText(row, names) {
  const normalized = {};
  Object.keys(row || {}).forEach(function(key) { normalized[String(key).trim()] = row[key]; });
  for (let i = 0; i < names.length; i += 1) if (normalized[names[i]] != null) return String(normalized[names[i]]).trim();
  return '';
}
function mopsNumber(row, names) {
  const value = mopsText(row, names).replace(/,/g, '');
  return value === '' || value === '--' ? null : Number(value);
}
function mopsAvailableFrom(date, time) {
  if (!date) return '';
  return date + (time ? 'T' + time.replace(/^(\d{2})(\d{2})(\d{2})$/, '$1:$2:$3') : '');
}
function mopsGregorianDate(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (/^\d{7}$/.test(digits)) return String(Number(digits.slice(0, 3)) + 1911) + '-' + digits.slice(3, 5) + '-' + digits.slice(5, 7);
  if (/^\d{8}$/.test(digits)) return digits.slice(0, 4) + '-' + digits.slice(4, 6) + '-' + digits.slice(6, 8);
  return String(value || '').trim();
}
function mopsGregorianYearMonth(value) {
  const digits = String(value || '').replace(/\D/g, '');
  if (/^\d{5}$/.test(digits)) return String(Number(digits.slice(0, 3)) + 1911) + '-' + digits.slice(3, 5);
  if (/^\d{6}$/.test(digits)) return digits.slice(0, 4) + '-' + digits.slice(4, 6);
  return String(value || '').trim();
}
function mopsGregorianYear(value) {
  const digits = String(value || '').replace(/\D/g, '');
  return /^\d{3}$/.test(digits) ? String(Number(digits) + 1911) : digits;
}
function mopsSourceUrl(endpoint) { return MOPS_OPENAPI_BASE + endpoint; }

function mopsCompanyBasicRow(row) {
  return {
    stock_code: mopsStockCode(row), stock_name: mopsText(row, ['公司簡稱', '公司名稱']),
    industry: mopsText(row, ['產業別']), listing_date: mopsText(row, ['上市日期']),
    established_date: mopsText(row, ['成立日期']), paid_in_capital: mopsNumber(row, ['實收資本額']),
    issued_common_shares: mopsNumber(row, ['已發行普通股數或TDR原股發行股數']),
    financial_statement_type: mopsText(row, ['編制財務報表類型']),
    updated_date: mopsGregorianDate(mopsText(row, ['出表日期'])), source: 'TWSE_MOPS_OPENAPI', source_url: mopsSourceUrl('t187ap03_L')
  };
}

function mopsMonthlyRevenueRow(row) {
  const reportDate = mopsGregorianDate(mopsText(row, ['出表日期']));
  return {
    stock_code: mopsStockCode(row), stock_name: mopsText(row, ['公司名稱', '公司簡稱']),
    industry: mopsText(row, ['產業別']), data_year_month: mopsGregorianYearMonth(mopsText(row, ['資料年月'])),
    monthly_revenue: mopsNumber(row, ['營業收入-當月營收']), previous_month_revenue: mopsNumber(row, ['營業收入-上月營收']),
    previous_year_revenue: mopsNumber(row, ['營業收入-去年當月營收']),
    mom_pct: mopsNumber(row, ['營業收入-上月比較增減(%)']), yoy_pct: mopsNumber(row, ['營業收入-去年同月增減(%)']),
    cumulative_revenue: mopsNumber(row, ['累計營業收入-當月累計營收']), report_date: reportDate,
    available_from: reportDate, source: 'TWSE_MOPS_OPENAPI', source_url: mopsSourceUrl('t187ap05_L')
  };
}

function mopsMajorMessageRow(row) {
  const date = mopsGregorianDate(mopsText(row, ['發言日期', '發布日期', '申報日期']));
  const time = mopsText(row, ['發言時間', '發布時間', '申報時間']);
  return {
    stock_code: mopsStockCode(row), stock_name: mopsText(row, ['公司簡稱', '公司名稱']),
    filing_date: date, filing_time: time, available_from: mopsAvailableFrom(date, time),
    subject: mopsText(row, ['主旨', '重大訊息主旨']),
    source: 'TWSE_MOPS_OPENAPI', source_url: mopsSourceUrl('t187ap04_L')
  };
}

function mopsFinancialRow(row, endpoint) {
  const selected = {};
  Object.keys(row).forEach(function(key) {
    if (/出表日期|年度|季別|公司代號|公司名稱|營業收入|營業利益|稅前|本期淨利|每股盈餘|資產總額|負債總額|權益總額|毛利率|利益率|純益率/.test(key)) selected[key] = row[key];
  });
  const reportDate = mopsGregorianDate(mopsText(row, ['出表日期']));
  return {
    stock_code: mopsStockCode(row), stock_name: mopsText(row, ['公司名稱', '公司簡稱']),
    fiscal_year: mopsGregorianYear(mopsText(row, ['年度'])), quarter: mopsText(row, ['季別']), report_kind: endpoint,
    report_date: reportDate, available_from: reportDate,
    metrics: selected, source: 'TWSE_MOPS_OPENAPI', source_url: mopsSourceUrl(endpoint)
  };
}

function mopsFindFile(folderId, name) {
  const files = DriveApp.getFolderById(folderId).getFilesByName(name);
  return files.hasNext() ? files.next() : null;
}
function mopsReadJsonl(file) {
  if (!file) return [];
  return file.getBlob().getDataAsString('UTF-8').split(/\r?\n/).filter(Boolean).map(function(line) { return JSON.parse(line); });
}
function mopsWriteJsonl(folderId, name, rows) {
  const content = rows.map(function(row) { return JSON.stringify(row); }).join('\n') + (rows.length ? '\n' : '');
  const file = mopsFindFile(folderId, name);
  if (file) historyReplaceText(file.getId(), content, 'application/x-ndjson');
  else DriveApp.getFolderById(folderId).createFile(name, content, MimeType.PLAIN_TEXT);
  return { file: name, rows: rows.length, updated_at: new Date().toISOString() };
}
function mopsReplaceSnapshot(folderId, name, rows) { return mopsWriteJsonl(folderId, name, rows); }
function mopsMergeJsonl(folderId, name, incoming, keyFn) {
  const file = mopsFindFile(folderId, name);
  const index = {};
  mopsReadJsonl(file).concat(incoming || []).forEach(function(row) { const key = keyFn(row); if (key) index[key] = row; });
  const rows = Object.keys(index).sort().map(function(key) { return index[key]; });
  return mopsWriteJsonl(folderId, name, rows);
}

/**
 * 將三個每日型十年資料庫更新到 TWSE 最近已完成的交易日。
 * 三份資料與三份 manifest 全部成功後才算完成；同一天重跑不會重複寫入。
 */
function updateTenYearHistoryToLatestTradeDate() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const targetYmd = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd');
    const market = historyFetchLatestMarket(targetYmd);
    const tradeDate = historyCompactToYmd(market.date);
    const manifests = {
      top50: historyReadJson(HISTORY_DRIVE.top50Manifest),
      daily: historyReadJson(HISTORY_DRIVE.stockDailyManifest),
      flow: historyReadJson(HISTORY_DRIVE.marketFlowManifest)
    };
    const latestDates = [
      manifests.top50.latest_successful_trade_date,
      manifests.daily.latest_successful_trade_date,
      manifests.flow.latest_successful_trade_date
    ];
    const rawCurrent = (manifests.top50.raw_ranking_files || []).some(function(item) {
      return Number(item.year) === Number(tradeDate.slice(0, 4)) && item.latest_trade_date >= tradeDate;
    });
    if (latestDates.every(function(value) { return value >= tradeDate; }) && rawCurrent) {
      return { ok: true, status: 'already_current', tradeDate: tradeDate, latestDates: latestDates };
    }

    const marketRows = historyParseMarketRows(market.json);
    if (!marketRows.length) throw new Error('MI_INDEX 沒有可用的上市普通股資料');
    const volumeTop100 = marketRows.slice().sort(function(a, b) { return b.trade_volume - a.trade_volume; }).slice(0, 100);
    volumeTop100.forEach(function(row, index) { row.rank = index + 1; });
    const top50 = volumeTop100.slice(0, 50);
    top50.forEach(function(row, index) { row.rank = index + 1; });
    const top50Rank = {};
    top50.forEach(function(row) { top50Rank[row.stock_code] = row.rank; });

    const year = Number(tradeDate.slice(0, 4));
    const topFile = historyManifestFile(manifests.top50, year);
    const dailyFile = historyManifestFile(manifests.daily, year);
    const flowFile = historyManifestFile(manifests.flow, year);
    const topCsv = historyReadText(topFile.file_id);
    const dailyCsv = historyReadText(dailyFile.file_id);
    const flowCsv = historyReadText(flowFile.file_id);

    const knownCodes = {};
    (manifests.daily.stock_codes || []).forEach(function(code) { knownCodes[String(code)] = true; });
    const newCodes = top50.filter(function(row) { return !knownCodes[row.stock_code]; }).map(function(row) { return row.stock_code; });
    // 新制只續寫當日成交量前 50 名；被剔除股票保留歷史、停止新增資料。
    const dailyRows = top50.slice();

    const flowPayload = historyFetchAlignedFlow(market.date);
    const flowRows = historyBuildFlowRows(top50, flowPayload);
    if (flowRows.length !== 50) throw new Error('市場資金流向資料不足 50 筆');

    const nextTopCsv = historyAppendRows(topCsv, HISTORY_TOP50_HEADER, tradeDate,
      top50.map(function(row) { return historyTop50Values(tradeDate, row); }));
    const nextDailyCsv = historyAppendRows(dailyCsv, HISTORY_DAILY_HEADER, tradeDate,
      dailyRows.map(function(row) { return historyDailyValues(tradeDate, row, top50Rank); }));
    const nextFlowCsv = historyAppendRows(flowCsv, HISTORY_FLOW_HEADER, tradeDate,
      flowRows.map(function(row) { return HISTORY_FLOW_HEADER.map(function(key) { return row[key]; }); }));

    const raw100File = historyEnsureRaw100File(manifests.top50, year);
    const raw100Csv = historyReadText(raw100File.file_id);
    const nextRaw100Csv = historyAppendRows(raw100Csv, HISTORY_TOP50_HEADER, tradeDate,
      volumeTop100.map(function(row) { return historyTop50Values(tradeDate, row); }));

    historyReplaceText(topFile.file_id, nextTopCsv, 'text/csv');
    historyReplaceText(dailyFile.file_id, nextDailyCsv, 'text/csv');
    historyReplaceText(flowFile.file_id, nextFlowCsv, 'text/csv');
    historyReplaceText(raw100File.file_id, nextRaw100Csv, 'text/csv');

    const now = new Date().toISOString();
    historyAdvanceManifest(manifests.top50, topFile, tradeDate, 50, now);
    historyAdvanceManifest(manifests.daily, dailyFile, tradeDate, dailyRows.length, now);
    historyAdvanceManifest(manifests.flow, flowFile, tradeDate, 50, now);
    raw100File.rows = Number(raw100File.rows || 0) + (raw100File.latest_trade_date >= tradeDate ? 0 : 100);
    raw100File.latest_trade_date = tradeDate; raw100File.updated_at = now;
    manifests.top50.selection_source_count = 100;
    manifests.top50.selection_count = 50;
    manifests.top50.raw_ranking_files = manifests.top50.raw_ranking_files || [];
    if (!manifests.top50.raw_ranking_files.some(function(item) { return item.file_id === raw100File.file_id; })) {
      manifests.top50.raw_ranking_files.push(raw100File);
    }
    if (newCodes.length) {
      manifests.daily.stock_codes = (manifests.daily.stock_codes || []).concat(newCodes).sort();
      manifests.daily.stock_count = manifests.daily.stock_codes.length;
      manifests.daily.pending_backfill = manifests.daily.pending_backfill || [];
      newCodes.forEach(function(code) {
        if (!manifests.daily.pending_backfill.some(function(item) { return item.stock_code === code && item.status !== 'complete'; })) {
          manifests.daily.pending_backfill.push({ stock_code: code, detected_on: tradeDate, status: 'pending' });
        }
      });
      historyEnsureBackfillTrigger();
    }
    manifests.flow.source_status = {
      institutional_latest: tradeDate, margin_latest: tradeDate, lending_latest: tradeDate
    };
    manifests.flow.top50_alignment = { top50_latest: tradeDate, aligned: true };
    historyReplaceText(HISTORY_DRIVE.top50Manifest, JSON.stringify(manifests.top50, null, 2) + '\n', 'application/json');
    historyReplaceText(HISTORY_DRIVE.stockDailyManifest, JSON.stringify(manifests.daily, null, 2) + '\n', 'application/json');
    historyReplaceText(HISTORY_DRIVE.marketFlowManifest, JSON.stringify(manifests.flow, null, 2) + '\n', 'application/json');

    PropertiesService.getScriptProperties().setProperty('HISTORY_LAST_SUCCESS', JSON.stringify({
      at: now, tradeDate: tradeDate, rawRankingRows: 100, top50Rows: 50,
      dailyRows: dailyRows.length, flowRows: 50, newCodes: newCodes
    }));
    return { ok: true, status: 'updated', tradeDate: tradeDate, dailyRows: dailyRows.length };
  } finally {
    lock.releaseLock();
  }
}

/** 分批補齊新入選股票自 2016-08-26（或上市日）起的官方月日線，避免 Apps Script 單次逾時。 */
function backfillNewTop50History() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const manifest = historyReadJson(HISTORY_DRIVE.stockDailyManifest);
    const queue = manifest.pending_backfill || [];
    const task = queue.filter(function(item) { return item.status !== 'complete'; })[0];
    if (!task) { historyDeleteBackfillTriggers(); return { ok: true, status: 'empty' }; }
    const end = parseYmd(task.detected_on);
    let cursor = task.next_month || manifest.data_start_date.slice(0, 7);
    let processed = 0;
    while (processed < 8 && cursor <= task.detected_on.slice(0, 7)) {
      const parts = cursor.split('-');
      const rows = historyFetchStockMonth(task.stock_code, Number(parts[0]), Number(parts[1]));
      historyMergeBackfillRows(manifest, task.stock_code, rows);
      cursor = historyNextMonth(cursor); processed += 1;
    }
    task.next_month = cursor;
    task.status = cursor > task.detected_on.slice(0, 7) ? 'complete' : 'running';
    task.updated_at = new Date().toISOString();
    manifest.generated_at = task.updated_at;
    historyReplaceText(HISTORY_DRIVE.stockDailyManifest, JSON.stringify(manifest, null, 2) + '\n', 'application/json');
    if (queue.every(function(item) { return item.status === 'complete'; })) historyDeleteBackfillTriggers();
    return { ok: true, stockCode: task.stock_code, status: task.status, nextMonth: task.next_month };
  } finally { lock.releaseLock(); }
}

function historyFetchStockMonth(code, year, month) {
  const date = String(year) + String(month).padStart(2, '0') + '01';
  const json = fetchJson('https://www.twse.com.tw/rwd/zh/afterTrading/STOCK_DAY?' + toQuery({
    response: 'json', date: date, stockNo: code
  }), { Referer: 'https://www.twse.com.tw/', 'User-Agent': 'Mozilla/5.0' });
  if (!json || json.stat !== 'OK') return [];
  return (json.data || []).map(function(row) {
    const roc = String(row[0] || '').split('/');
    const tradeDate = (Number(roc[0]) + 1911) + '-' + roc[1].padStart(2, '0') + '-' + roc[2].padStart(2, '0');
    return [tradeDate, code, '', historyNum(row, 3), historyNum(row, 4), historyNum(row, 5),
      historyNum(row, 6), historyNum(row, 1), historyNum(row, 2), historyNum(row, 8), historyNum(row, 7), '', 0];
  });
}

function historyMergeBackfillRows(manifest, code, rows) {
  if (!rows.length) return;
  const grouped = {};
  rows.forEach(function(row) { (grouped[row[0].slice(0, 4)] = grouped[row[0].slice(0, 4)] || []).push(row); });
  Object.keys(grouped).forEach(function(year) {
    const file = historyManifestFile(manifest, Number(year));
    const csv = historyReadText(file.file_id);
    const lines = csv.replace(/^\uFEFF/, '').trimEnd().split(/\r?\n/);
    const existing = {};
    lines.slice(1).forEach(function(line) {
      const parsed = historyParseCsvLine(line); existing[parsed[0] + '|' + parsed[1]] = true;
    });
    const added = grouped[year].filter(function(row) { return !existing[row[0] + '|' + code]; });
    if (!added.length) return;
    const merged = lines.slice(1).concat(added.map(historyCsvLine));
    merged.sort(function(a, b) {
      const aa = historyParseCsvLine(a), bb = historyParseCsvLine(b);
      return (aa[0] + aa[1]).localeCompare(bb[0] + bb[1]);
    });
    historyReplaceText(file.file_id, HISTORY_DAILY_HEADER.join(',') + '\n' + merged.join('\n') + '\n', 'text/csv');
    file.rows = Number(file.rows || 0) + added.length; file.updated_at = new Date().toISOString();
    manifest.total_rows = Number(manifest.total_rows || 0) + added.length;
  });
}

function historyEnsureRaw100File(manifest, year) {
  const files = manifest.raw_ranking_files || [];
  const found = files.filter(function(item) { return Number(item.year) === Number(year); })[0];
  if (found) return found;
  const name = 'twse_volume_top100_' + year + '.csv';
  const file = DriveApp.getFolderById(HISTORY_DRIVE.top50Folder).createFile(name, HISTORY_TOP50_HEADER.join(',') + '\n', MimeType.CSV);
  return { year: year, name: name, file_id: file.getId(), rows: 0, latest_trade_date: null };
}

function historyEnsureBackfillTrigger() {
  const exists = ScriptApp.getProjectTriggers().some(function(trigger) { return trigger.getHandlerFunction() === 'backfillNewTop50History'; });
  if (!exists) ScriptApp.newTrigger('backfillNewTop50History').timeBased().everyMinutes(10).create();
}

function historyDeleteBackfillTriggers() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'backfillNewTop50History') ScriptApp.deleteTrigger(trigger);
  });
}

function historyNextMonth(value) {
  const parts = value.split('-').map(Number);
  const date = new Date(Date.UTC(parts[0], parts[1], 1));
  return date.getUTCFullYear() + '-' + String(date.getUTCMonth() + 1).padStart(2, '0');
}

function historyFetchLatestMarket(targetYmd) {
  return fetchLatestTwseTable('exchangeReport/MI_INDEX', targetYmd, { type: 'ALLBUT0999' }, function(json) {
    return historyParseMarketRows(json).length >= 50;
  });
}

function historyParseMarketRows(json) {
  const out = [];
  (json && json.tables || []).forEach(function(table) {
    const fields = table.fields || [];
    const indexes = {
      code: fieldIndex(fields, /證券代號/), name: fieldIndex(fields, /證券名稱/),
      volume: fieldIndex(fields, /成交股數|成交量/), value: fieldIndex(fields, /成交金額/),
      transactions: fieldIndex(fields, /成交筆數/), open: fieldIndex(fields, /開盤價/),
      high: fieldIndex(fields, /最高價/), low: fieldIndex(fields, /最低價/),
      close: fieldIndex(fields, /收盤價/), change: fieldIndex(fields, /漲跌價差/)
    };
    if (indexes.code < 0 || indexes.name < 0 || indexes.volume < 0 || indexes.close < 0) return;
    (table.data || []).forEach(function(raw) {
      const row = raw && raw.value ? raw.value : raw;
      const code = String(row[indexes.code] || '').trim();
      if (!/^\d{4}$/.test(code)) return;
      out.push({
        stock_code: code, stock_name: String(row[indexes.name] || '').trim(),
        trade_volume: historyNum(row, indexes.volume), trade_value: historyNum(row, indexes.value),
        transactions: historyNum(row, indexes.transactions), open: historyNum(row, indexes.open),
        high: historyNum(row, indexes.high), low: historyNum(row, indexes.low),
        close: historyNum(row, indexes.close), price_change: historyNum(row, indexes.change)
      });
    });
  });
  return out;
}

function historyFetchAlignedFlow(compactDate) {
  const ymd = historyCompactToYmd(compactDate);
  const institutional = fetchLatestTwseTable('fund/T86', ymd, { selectType: 'ALLBUT0999' }, function(json) {
    return json && json.stat === 'OK' && Array.isArray(json.data);
  });
  const margin = fetchLatestTwseTable('exchangeReport/MI_MARGN', ymd, { selectType: 'ALL' }, function(json) {
    return json && json.stat === 'OK' && Array.isArray(json.tables) && json.tables.length > 1;
  });
  const lending = fetchLatestTwseTable('exchangeReport/TWT93U', ymd, {}, function(json) {
    return json && json.stat === 'OK' && Array.isArray(json.data);
  });
  const dates = [institutional.date, margin.date, lending.date].map(historyCompactToYmd);
  if (!dates.every(function(value) { return value === ymd; })) {
    throw new Error('籌碼日期不一致：行情 ' + ymd + '，法人/融資/借券 ' + dates.join('/'));
  }
  return { institutional: institutional.json, margin: margin.json, lending: lending.json, tradeDate: ymd };
}

function historyBuildFlowRows(top50, payload) {
  const institution = historyRowsToMap(payload.institutional);
  const margin = historyRowsToMap(payload.margin);
  const lending = historyRowsToMap(payload.lending);
  return top50.map(function(item) {
    const i = institution[item.stock_code] || null;
    const m = margin[item.stock_code] || null;
    const l = lending[item.stock_code] || null;
    const row = {};
    HISTORY_FLOW_HEADER.forEach(function(key) { row[key] = ''; });
    row.trade_date = payload.tradeDate; row.rank = item.rank;
    row.stock_code = item.stock_code; row.stock_name = item.stock_name;
    row.foreign_buy = historyField(i, /外陸資.*買進股數(?!.*自營商)/);
    row.foreign_sell = historyField(i, /外陸資.*賣出股數(?!.*自營商)/);
    row.foreign_net = historyField(i, /外陸資.*買賣超股數(?!.*自營商)/);
    row.foreign_dealer_buy = historyField(i, /外資自營商.*買進股數/);
    row.foreign_dealer_sell = historyField(i, /外資自營商.*賣出股數/);
    row.foreign_dealer_net = historyField(i, /外資自營商.*買賣超股數/);
    row.investment_trust_buy = historyField(i, /投信.*買進股數/);
    row.investment_trust_sell = historyField(i, /投信.*賣出股數/);
    row.investment_trust_net = historyField(i, /投信.*買賣超股數/);
    row.dealer_proprietary_buy = historyField(i, /自營商.*自行買賣.*買進股數/);
    row.dealer_proprietary_sell = historyField(i, /自營商.*自行買賣.*賣出股數/);
    row.dealer_proprietary_net = historyField(i, /自營商.*自行買賣.*買賣超股數/);
    row.dealer_hedge_buy = historyField(i, /自營商.*避險.*買進股數/);
    row.dealer_hedge_sell = historyField(i, /自營商.*避險.*賣出股數/);
    row.dealer_hedge_net = historyField(i, /自營商.*避險.*買賣超股數/);
    row.dealer_total_buy = historyField(i, /自營商.*買進股數(?!.*自行|.*避險)/);
    row.dealer_total_sell = historyField(i, /自營商.*賣出股數(?!.*自行|.*避險)/);
    row.dealer_total_net = historyField(i, /自營商.*買賣超股數(?!.*自行|.*避險)/);
    row.institutional_total_net = historyField(i, /三大法人.*買賣超股數/);
    row.margin_previous_balance = historyField(m, /融資.*前日餘額/);
    row.margin_purchase = historyField(m, /融資.*買進/); row.margin_sale = historyField(m, /融資.*賣出/);
    row.margin_cash_redemption = historyField(m, /融資.*現金償還/);
    row.margin_current_balance = historyField(m, /融資.*今日餘額/); row.margin_limit = historyField(m, /融資.*限額/);
    row.short_previous_balance = historyField(m, /融券.*前日餘額/); row.short_sale = historyField(m, /融券.*賣出/);
    row.short_purchase = historyField(m, /融券.*買進/); row.short_stock_redemption = historyField(m, /融券.*現券償還/);
    row.short_current_balance = historyField(m, /融券.*今日餘額/); row.short_limit = historyField(m, /融券.*限額/);
    row.margin_short_offset = historyField(m, /資券互抵/);
    row.sbl_previous_balance = historyField(l, /前日餘額/); row.sbl_sell = historyField(l, /當日賣出/);
    row.sbl_return = historyField(l, /當日還券/); row.sbl_adjustment = historyField(l, /當日調整/);
    row.sbl_current_balance = historyField(l, /當日餘額/); row.sbl_next_limit = historyField(l, /次一營業日.*限額/);
    row.institutional_report_available = i ? 1 : 0;
    row.margin_report_available = m ? 1 : 0; row.lending_report_available = l ? 1 : 0;
    return row;
  });
}

function historyRowsToMap(json) {
  const out = {};
  const tables = json && Array.isArray(json.tables) ? json.tables : [{ fields: json && json.fields, data: json && json.data }];
  tables.forEach(function(table) {
    const fields = (table && table.fields) || [];
    const codeIndex = fieldIndex(fields, /證券代號|^代號$/);
    if (codeIndex < 0) return;
    (table.data || []).forEach(function(raw) {
      const values = raw && raw.value ? raw.value : raw;
      const code = String(values[codeIndex] || '').trim();
      if (!/^\d{4}$/.test(code)) return;
      const row = {};
      fields.forEach(function(field, index) { row[String(field)] = values[index]; });
      out[code] = row;
    });
  });
  return out;
}

function historyField(row, pattern) {
  if (!row) return '';
  const key = Object.keys(row).filter(function(name) { return pattern.test(name.replace(/\s/g, '')); })[0];
  if (!key) return '';
  const value = parseTwseNumber(row[key]);
  return value == null ? '' : value;
}

function historyTop50Values(date, row) {
  return [date, row.rank, row.stock_code, row.stock_name, row.trade_volume, row.trade_value,
    row.transactions, row.open, row.high, row.low, row.close, row.price_change];
}

function historyDailyValues(date, row, ranks) {
  const rank = ranks[row.stock_code] || '';
  return [date, row.stock_code, row.stock_name, row.open, row.high, row.low, row.close,
    row.trade_volume, row.trade_value, row.transactions, row.price_change, rank, rank ? 1 : 0];
}

function historyReadText(fileId) {
  return DriveApp.getFileById(fileId).getBlob().getDataAsString('UTF-8').replace(/^\uFEFF/, '');
}

function historyReadJson(fileId) { return JSON.parse(historyReadText(fileId)); }

function historyReplaceText(fileId, content, mimeType) {
  const response = UrlFetchApp.fetch('https://www.googleapis.com/upload/drive/v3/files/' + encodeURIComponent(fileId) + '?uploadType=media', {
    method: 'patch', contentType: mimeType, payload: content,
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true
  });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) {
    throw new Error('Drive 更新失敗 ' + fileId + ': HTTP ' + response.getResponseCode() + ' ' + response.getContentText());
  }
}

function historyManifestFile(manifest, year) {
  const files = Array.isArray(manifest.files) ? manifest.files : Object.keys(manifest.files || {}).map(function(key) {
    return Object.assign({ year: Number(key) }, manifest.files[key]);
  });
  const found = files.filter(function(item) { return Number(item.year) === Number(year); })[0];
  if (!found || !found.file_id) throw new Error('manifest 找不到 ' + year + ' 年資料檔');
  return found;
}

function historyAdvanceManifest(manifest, file, tradeDate, addedRows, now) {
  if (manifest.latest_successful_trade_date >= tradeDate) return;
  manifest.data_end_date = tradeDate; manifest.latest_successful_trade_date = tradeDate;
  manifest.total_rows = Number(manifest.total_rows || 0) + addedRows;
  file.rows = Number(file.rows || 0) + addedRows; file.updated_at = now;
  manifest.last_update = { status: 'update_complete', at: now, error: null };
  manifest.generated_at = now;
}

function historyAppendRows(csv, expectedHeader, tradeDate, rows) {
  const lines = String(csv || '').replace(/^\uFEFF/, '').trimEnd().split(/\r?\n/);
  const header = historyParseCsvLine(lines[0]);
  if (header.join(',') !== expectedHeader.join(',')) throw new Error('CSV 欄位與預期不一致：' + header.join(','));
  if (lines.some(function(line, index) { return index > 0 && line.slice(0, 10) === tradeDate; })) return csv;
  return lines.join('\n') + '\n' + rows.map(historyCsvLine).join('\n') + '\n';
}

function historyCsvCodes(csv) {
  const lines = String(csv || '').replace(/^\uFEFF/, '').split(/\r?\n/);
  const header = historyParseCsvLine(lines[0]);
  const index = header.indexOf('stock_code');
  const out = {};
  lines.slice(1).forEach(function(line) {
    if (!line) return;
    const code = historyParseCsvLine(line)[index];
    if (/^\d{4}$/.test(code || '')) out[code] = true;
  });
  return out;
}

function historyCsvLine(values) {
  return values.map(function(value) {
    const text = value == null ? '' : String(value);
    return /[",\r\n]/.test(text) ? '"' + text.replace(/"/g, '""') + '"' : text;
  }).join(',');
}

function historyParseCsvLine(line) {
  const out = []; let value = ''; let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"' && quoted && line[i + 1] === '"') { value += '"'; i += 1; }
    else if (char === '"') quoted = !quoted;
    else if (char === ',' && !quoted) { out.push(value); value = ''; }
    else value += char;
  }
  out.push(value); return out;
}

function historyNum(row, index) {
  if (index < 0) return '';
  const value = parseTwseNumber(row[index]);
  return value == null ? '' : value;
}

function historyCompactToYmd(value) {
  const text = String(value || '').replace(/\D/g, '');
  if (text.length !== 8) throw new Error('無效交易日期：' + value);
  return text.slice(0, 4) + '-' + text.slice(4, 6) + '-' + text.slice(6, 8);
}
