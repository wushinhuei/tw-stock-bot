window.APPS_SCRIPT_ENDPOINT = 'https://script.google.com/macros/s/AKfycbxMSe1WvXNjTbAzxZSP8mD_9wt11BIGQSyaFTktoet_v7WQ1KujUu19pflwS6zHfhqt/exec';
window.CLOUD_DASHBOARD_ENDPOINT = 'https://tw-stock-dashboard-api-702657072551.asia-east1.run.app/dashboard';

// 歷史交易明細：直接監看表格 DOM，固定依畫面上的「日期＋時間」由新到舊排列。
// 這個修正不依賴 API 原始陣列順序，也不依賴 app.js 的 reverse()。
(function installHistoryTradeDomSortFix() {
  function rowDateTimeKey(row) {
    const cell = row?.cells?.[0];
    if (!cell) return '';

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
      return bKey.localeCompare(aKey);
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

  attach();
  window.addEventListener('load', attach);
})();

// 現有持倉不必進入每日30檔候選，也必須能被持倉畫面與風控查到。
(function installHoldingMonitorLookup() {
  window.addEventListener('load', () => {
    const originalFindCandidate = window.findCandidate;
    if (typeof originalFindCandidate !== 'function' || originalFindCandidate.__holdingMonitorAware) return;

    function holdingMonitorAwareFindCandidate(day, symbol) {
      const candidate = originalFindCandidate(day, symbol);
      if (candidate) return candidate;
      const code = String(symbol || '').replace(/\.TW$/i, '');
      const monitors = Array.isArray(day?.positionMonitors) ? day.positionMonitors : [];
      return monitors.find(item => String(item?.symbol || '').replace(/\.TW$/i, '') === code) || null;
    }

    holdingMonitorAwareFindCandidate.__holdingMonitorAware = true;
    window.findCandidate = holdingMonitorAwareFindCandidate;
  });
})();

// 候選名單是觀察池，不是交易指令：Top100 建池、每小時重排、顯示30檔。
(function installCandidateWatchlistCopy() {
  function applyCopy() {
    const summary = document.querySelector('#candidateUniverseSummary');
    if (summary) {
      summary.textContent = '先由 TWSE 上市普通股依流動性建立 Top100 可交易母池，再以籌碼30%、技術30%、基本面25%、新聞／事件15%做綜合排序；每小時重新排序一次並顯示前30檔。此名單僅供觀察，不代表要進行任何買賣操作。';
    }

    const panel = document.querySelector('#candidateUniverse')?.closest('.scanner-panel');
    const title = panel?.querySelector('h2');
    if (title) title.textContent = '今日觀察候選30檔';
  }

  applyCopy();
  window.addEventListener('load', applyCopy);
})();

// 潛力股 Top10 前端：獨立檔案動態載入，不干擾既有交易畫面。
(function loadPotentialStocksUi() {
  const load = () => {
    if (document.querySelector('script[data-potential-stocks-ui]')) return;
    const script = document.createElement('script');
    script.src = `potential_stocks_ui.js?v=${Date.now()}`;
    script.async = false;
    script.dataset.potentialStocksUi = '1';
    document.body.appendChild(script);
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', load, { once: true });
  else load();
})();
