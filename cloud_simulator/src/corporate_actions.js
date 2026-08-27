'use strict';

function number(value) {
  const parsed = Number(String(value ?? '').replaceAll(',', '').trim());
  return Number.isFinite(parsed) ? parsed : null;
}

function rocLongDate(value) {
  const match = String(value || '').match(/^(\d{3})年(\d{2})月(\d{2})日$/);
  if (!match) throw new Error(`invalid TWSE action date: ${value}`);
  return `${Number(match[1]) + 1911}-${match[2]}-${match[3]}`;
}

function parseCorporateActions(payload) {
  if (payload?.stat !== 'OK') return [];
  const fields = payload.fields || [];
  const index = Object.fromEntries(fields.map((field, offset) => [field.replace(/\s/g, ''), offset]));
  return (payload.data || []).map(row => {
    const previousClose = number(row[index['除權息前收盤價']]);
    const referencePrice = number(row[index['除權息參考價']]);
    const type = String(row[index['權/息']] || '').trim();
    return {
      action_date: rocLongDate(row[index['資料日期']]), stock_code: String(row[index['股票代號']] || '').trim(),
      stock_name: String(row[index['股票名稱']] || '').trim(), action_type: type,
      previous_close: previousClose, reference_price: referencePrice,
      rights_dividend_value: number(row[index['權值+息值']]),
      limit_up: number(row[index['漲停價格']]), limit_down: number(row[index['跌停價格']]),
      auction_base: number(row[index['開盤競價基準']]), ex_dividend_reference: number(row[index['減除股利參考價']]),
      detail_key: String(row[index['詳細資料']] || '').trim(),
      adjustment_factor: previousClose > 0 && referencePrice > 0 ? referencePrice / previousClose : null,
      source: 'TWSE_TWT49U'
    };
  }).filter(row => row.stock_code && row.adjustment_factor > 0 && row.adjustment_factor <= 2);
}

function buildCumulativeFactors(actions) {
  const grouped = Object.groupBy(actions, row => row.stock_code);
  const factors = [];
  for (const [stockCode, values] of Object.entries(grouped)) {
    let cumulative = 1;
    for (const action of values.sort((a, b) => b.action_date.localeCompare(a.action_date))) {
      cumulative *= action.adjustment_factor;
      factors.push({ stock_code: stockCode, action_date: action.action_date, action_type: action.action_type,
        event_factor: action.adjustment_factor, cumulative_factor_before_date: cumulative, source: action.source });
    }
  }
  return factors.sort((a, b) => a.stock_code.localeCompare(b.stock_code) || a.action_date.localeCompare(b.action_date));
}

function adjustBars(bars, factors) {
  return bars.map(bar => {
    const applicable = factors.filter(item => item.stock_code === String(bar.symbol) && bar.tradeDate < item.action_date);
    const factor = applicable.reduce((value, item) => value * Number(item.event_factor ?? item.adjustment_factor), 1);
    return { ...bar, adjustmentFactor: factor, adjustedOpen: bar.open * factor, adjustedHigh: bar.high * factor,
      adjustedLow: bar.low * factor, adjustedClose: bar.close * factor, adjustedVolume: factor ? bar.volume / factor : bar.volume };
  });
}

module.exports = { adjustBars, buildCumulativeFactors, parseCorporateActions, rocLongDate };
