'use strict';

function number(value) { const out = Number(String(value ?? '').replace(/,/g, '')); return Number.isFinite(out) ? out : null; }
function bestPrice(item) { return number(item.z) ?? number(String(item.a || '').split('_')[0]) ?? number(String(item.b || '').split('_')[0]) ?? number(item.y); }

async function fetchJson(url, fetchImpl = fetch, referer = 'https://www.twse.com.tw/') {
  const response = await fetchImpl(url, {
    cache: 'no-store',
    headers: {
      Referer: referer,
      'User-Agent': 'tw-stock-cloud-simulator/1.0',
      'Cache-Control': 'no-cache, no-store, max-age=0',
      Pragma: 'no-cache'
    }
  });
  if (!response.ok) throw new Error(`TWSE HTTP ${response.status}: ${url}`);
  return response.json();
}

async function fetchQuotes(symbols, fetchImpl = fetch) {
  const channels = symbols.map(symbol => `tse_${symbol}.tw`).join('|');
  const url = `https://mis.twse.com.tw/stock/api/getStockInfo.jsp?ex_ch=${encodeURIComponent(channels)}&json=1&delay=0&_=${Date.now()}`;
  const json = await fetchJson(url, fetchImpl, 'https://mis.twse.com.tw/stock/index.jsp');
  const quotes = {};
  for (const item of json.msgArray || []) {
    const price = bestPrice(item);
    const bidPrice = number(String(item.b || '').split('_')[0]) ?? price;
    const askPrice = number(String(item.a || '').split('_')[0]) ?? price;
    quotes[item.c] = {
      symbol: item.c, name: item.n, price, bidPrice, askPrice,
      availableQuantity: Math.max(0, Math.floor((number(String(item.f || '').split('_')[0]) || 0) * 1000)),
      timestamp: `${item.d.slice(0, 4)}-${item.d.slice(4, 6)}-${item.d.slice(6, 8)}T${item.t}+08:00`,
      provider: 'TWSE MIS'
    };
  }
  return quotes;
}

function findTopVolumeTable(json) {
  return (json.tables || []).find(table => (table.fields || []).some(field => String(field).includes('證券代號'))
    && (table.fields || []).some(field => String(field).includes('成交股數')));
}

async function fetchTopVolume(dateCompact, limit = 50, fetchImpl = fetch) {
  const url = `https://www.twse.com.tw/exchangeReport/MI_INDEX?response=json&date=${dateCompact}&type=ALLBUT0999`;
  const json = await fetchJson(url, fetchImpl);
  const table = findTopVolumeTable(json);
  if (!table) throw new Error('TWSE MI_INDEX沒有可用個股成交量表');
  const codeIndex = table.fields.findIndex(field => String(field).includes('證券代號'));
  const nameIndex = table.fields.findIndex(field => String(field).includes('證券名稱'));
  const volumeIndex = table.fields.findIndex(field => String(field).includes('成交股數'));
  return table.data.map(row => ({ symbol: String(row[codeIndex]).trim(), name: String(row[nameIndex]).trim(), volume: number(row[volumeIndex]) || 0 }))
    .filter(row => /^\d{4}$/.test(row.symbol)).sort((a, b) => b.volume - a.volume).slice(0, limit);
}

module.exports = { fetchQuotes, fetchTopVolume };
