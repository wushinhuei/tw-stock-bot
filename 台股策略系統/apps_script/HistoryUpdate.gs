const HISTORY_DRIVE = {
  top50Folder: '1MxFVvokT86PlmmZ8ugHaID5iAsc90Qse',
  top50Manifest: '1_dUjbK480Mng6ABditIRUAtou1S9XP6m',
  stockDailyManifest: '1_0NnEjwCRkoguD9OowRnp7mQ8rovneKx',
  marketFlowManifest: '1euGZK6A2YzyQKrZehk7qvTLhOP83uOVm'
};

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

/** 建立每日 19:15 左右執行的十年資料增量更新觸發器。 */
function configureDailyHistoryUpdate() {
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction() === 'updateTenYearHistoryToLatestTradeDate') {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger('updateTenYearHistoryToLatestTradeDate')
    .timeBased().everyDays(1).atHour(19).nearMinute(15).inTimezone('Asia/Taipei').create();
  return { ok: true, handler: 'updateTenYearHistoryToLatestTradeDate', schedule: '每日約 19:15（台北時間）' };
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
