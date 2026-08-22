'use strict';

const DEFAULT_HOLIDAY_URL = 'https://openapi.twse.com.tw/v1/holidaySchedule/holidaySchedule';

function rocCompactToYmd(value) {
  const text = String(value || '').trim();
  if (!/^\d{7}$/.test(text)) return '';
  const year = Number(text.slice(0, 3)) + 1911;
  return `${year}-${text.slice(3, 5)}-${text.slice(5, 7)}`;
}

function isTradingDayMarker(item) {
  const name = String(item && item.Name || '');
  return name.includes('開始交易') || name.includes('最後交易');
}

function closedDatesFromSchedule(items) {
  return new Set((Array.isArray(items) ? items : [])
    .filter(item => !isTradingDayMarker(item))
    .map(item => rocCompactToYmd(item.Date))
    .filter(Boolean));
}

async function fetchClosedDates(options = {}) {
  const url = options.url || process.env.TWSE_HOLIDAY_URL || DEFAULT_HOLIDAY_URL;
  const response = await (options.fetchImpl || fetch)(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(Number(options.timeoutMs || 3000))
  });
  if (!response.ok) throw new Error(`TWSE holiday schedule HTTP ${response.status}`);
  return closedDatesFromSchedule(await response.json());
}

async function isTwseTradingDay(date, options = {}) {
  if (!options.ymd) throw new Error('Trading date is required');
  const closedDates = options.closedDates || await fetchClosedDates(options);
  return !closedDates.has(options.ymd);
}

module.exports = {
  DEFAULT_HOLIDAY_URL,
  closedDatesFromSchedule,
  fetchClosedDates,
  isTradingDayMarker,
  isTwseTradingDay,
  rocCompactToYmd
};
