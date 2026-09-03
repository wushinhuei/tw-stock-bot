window.APPS_SCRIPT_ENDPOINT = 'https://script.google.com/macros/s/AKfycbxMSe1WvXNjTbAzxZSP8mD_9wt11BIGQSyaFTktoet_v7WQ1KujUu19pflwS6zHfhqt/exec';
window.CLOUD_DASHBOARD_ENDPOINT = 'https://tw-stock-dashboard-api-702657072551.asia-east1.run.app/dashboard';

// 歷史交易明細固定依實際成交時間由新到舊排列。
// app.js 原本只是把資料陣列 reverse()，若 API 回傳本身不是嚴格時間順序，
// 同一天的交易就會出現 09:25:23 排在 09:25:30 前面的情況。
(function installHistoryTradeTimeSortFix() {
  function tradeTimestamp(trade) {
    const raw = trade?.filledAt || trade?.executedAt || trade?.timestamp || '';
    const parsed = raw ? new Date(raw).getTime() : NaN;
    if (Number.isFinite(parsed)) return parsed;

    // 舊資料若只有 date/time 欄位，仍盡量組成可比較時間。
    const date = String(trade?.date || '').trim();
    const time = String(trade?.time || trade?.filledTime || trade?.executedTime || '').trim();
    const fallback = date && time ? new Date(`${date}T${time}`).getTime() : NaN;
    return Number.isFinite(fallback) ? fallback : 0;
  }

  function sortRenderedRows() {
    const tbody = document.querySelector('#historyTradeRows');
    if (!tbody) return;
    const rows = Array.from(tbody.querySelectorAll('tr'));
    if (rows.length < 2) return;

    rows.sort((a, b) => {
      const aText = String(a.cells?.[0]?.innerText || '').trim().split(/\s+/);
      const bText = String(b.cells?.[0]?.innerText || '').trim().split(/\s+/);
      const aKey = `${aText[0] || ''}T${aText[1] || '00:00:00'}`;
      const bKey = `${bText[0] || ''}T${bText[1] || '00:00:00'}`;
      return bKey.localeCompare(aKey);
    });

    rows.forEach(row => tbody.appendChild(row));
  }

  window.addEventListener('load', () => {
    const originalRenderHistoryTradeRows = window.renderHistoryTradeRows;

    if (typeof originalRenderHistoryTradeRows === 'function') {
      window.renderHistoryTradeRows = function renderHistoryTradeRowsSorted(trades, selectedDate) {
        const orderedTrades = (Array.isArray(trades) ? trades : [])
          .slice()
          .sort((a, b) => tradeTimestamp(a) - tradeTimestamp(b));
        return originalRenderHistoryTradeRows(orderedTrades, selectedDate);
      };

      const historyTradeDate = document.querySelector('#historyTradeDate');
      if (historyTradeDate && typeof historyTradeDate.onchange === 'function') {
        historyTradeDate.onchange();
      } else {
        sortRenderedRows();
      }
    } else {
      sortRenderedRows();
    }
  });
})();
