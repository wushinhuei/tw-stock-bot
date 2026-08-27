'use strict';

function number(value) {
  const cleaned = String(value ?? '').replaceAll(',', '').replace(/[+X]/g, '').trim();
  if (!cleaned || cleaned === '--') return null;
  const parsed = Number(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
}

function rocDate(value) {
  const match = String(value || '').trim().match(/^(\d{3})\/(\d{2})\/(\d{2})$/);
  if (!match) throw new Error(`invalid ROC date: ${value}`);
  return `${Number(match[1]) + 1911}-${match[2]}-${match[3]}`;
}

function tableRows(payload, definition) {
  if (payload?.stat !== 'OK') return [];
  const fields = payload.fields || [];
  const indexes = Object.fromEntries(fields.map((field, index) => [field.replace(/\s/g, ''), index]));
  return (payload.data || []).map(row => definition(indexes, row));
}

function parse0050(payload) {
  return tableRows(payload, (index, row) => ({
    trade_date: rocDate(row[index['日期']]), benchmark_id: '0050', benchmark_name: '元大台灣50',
    benchmark_type: 'ETF_PRICE', open: number(row[index['開盤價']]), high: number(row[index['最高價']]),
    low: number(row[index['最低價']]), close: number(row[index['收盤價']]),
    volume: number(row[index['成交股數']]), value: number(row[index['成交金額']]),
    transactions: number(row[index['成交筆數']]), source: 'TWSE_STOCK_DAY'
  })).filter(row => row.close > 0);
}

function parseTaiex(payload) {
  return tableRows(payload, (index, row) => ({
    trade_date: rocDate(row[index['日期']]), benchmark_id: 'TAIEX', benchmark_name: '發行量加權股價指數',
    benchmark_type: 'PRICE_INDEX', open: number(row[index['開盤指數']]), high: number(row[index['最高指數']]),
    low: number(row[index['最低指數']]), close: number(row[index['收盤指數']]),
    volume: null, value: null, transactions: null, source: 'TWSE_MI_5MINS_HIST'
  })).filter(row => row.close > 0);
}

function toCsv(rows) {
  const fields = ['trade_date', 'benchmark_id', 'benchmark_name', 'benchmark_type', 'open', 'high', 'low', 'close', 'volume', 'value', 'transactions', 'source'];
  const quote = value => /[",\n]/.test(String(value ?? '')) ? `"${String(value ?? '').replaceAll('"', '""')}"` : String(value ?? '');
  return `${fields.join(',')}\n${rows.map(row => fields.map(field => quote(row[field])).join(',')).join('\n')}\n`;
}

function validateBenchmarks(rows, start, end) {
  const selected = rows.filter(row => row.trade_date >= start && row.trade_date <= end);
  const byId = Object.groupBy(selected, row => row.benchmark_id);
  const summaries = Object.fromEntries(['0050', 'TAIEX'].map(id => {
    const values = (byId[id] || []).sort((a, b) => a.trade_date.localeCompare(b.trade_date));
    return [id, { rows: values.length, first_date: values[0]?.trade_date || null, last_date: values.at(-1)?.trade_date || null }];
  }));
  const passed = Object.values(summaries).every(item => item.rows >= 2000 && item.first_date <= start && item.last_date >= end);
  return { passed, period: { start, end }, benchmarks: summaries };
}

module.exports = { number, parse0050, parseTaiex, rocDate, toCsv, validateBenchmarks };
