window.APPS_SCRIPT_ENDPOINT = 'https://script.google.com/macros/s/AKfycbxMSe1WvXNjTbAzxZSP8mD_9wt11BIGQSyaFTktoet_v7WQ1KujUu19pflwS6zHfhqt/exec';
window.CLOUD_DASHBOARD_ENDPOINT = 'https://tw-stock-dashboard-api-702657072551.asia-east1.run.app/dashboard';

// 歷史交易明細：直接監看表格 DOM，固定依畫面上的「日期＋時間」由新到舊排列。
// 這個修正不依賴 API 原始陣列順序，也不依賴 app.js 的 reverse()。
(function installHistoryTradeDomSortFix() {
  function rowDateTimeKey(row) {
    const cell = row?.cells?.[0];
    if (!cell) return '';

    // first cell 顯示格式：
    // 2026-09-02\n09:25:30\n盤中
    const parts = String(cell.innerText || cell.textContent || '')
      .trim()
      .split(/\s+/)
      .filter(Boolean);

    const date = parts.find(value => /^\d{4}-\d{2}-\d{2}$/.test(value)) || '';
    const time = parts.find(value => /^\d{2}:\d{2}:\d{2}$/.test(value)) || '00:00:00';
    return date ? `${date}T${time}` : '';
  }

  function sortHistoryRows(tbody) {
    if (!tbody) return;
    const rows = Array.from(tbody.querySelectorAll(':scope > tr'));
    if (rows.length < 2) return;

    const sorted = rows.slice().sort((a, b) => {
      const aKey = rowDateTimeKey(a);
      const bKey = rowDateTimeKey(b);
      return bKey.localeCompare(aKey); // 最新在最上方
    });

    const changed = sorted.some((row, index) => row !== rows[index]);
    if (!changed) return;

    observer.disconnect();
    sorted.forEach(row => tbody.appendChild(row));
    observer.observe(tbody, { childList: true });
  }

  let activeTbody = null;
  const observer = new MutationObserver(() => {
    if (activeTbody) sortHistoryRows(activeTbody);
  });

  function attach() {
    const tbody = document.querySelector('#historyTradeRows');
    if (!tbody) return false;

    if (activeTbody !== tbody) {
      observer.disconnect();
      activeTbody = tbody;
      observer.observe(tbody, { childList: true });
    }

    sortHistoryRows(tbody);
    return true;
  }

  // 此檔載入時 HTML 已存在，先立即掛上；另外在 load 後再補一次。
  attach();
  window.addEventListener('load', attach);
})();
