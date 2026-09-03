(function () {
  'use strict';

  const state = { selectedSymbol: null };

  function html(value) {
    return String(value == null ? '' : value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function number(value, digits = 1) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toFixed(digits) : '-';
  }

  function pctValue(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '-';
    return `${n.toFixed(1)}%`;
  }

  function rows() {
    const source = window.GROWTH_CANDIDATES_TOP10 || window.POTENTIAL_STOCKS || window.HIGH_GROWTH_TOP10 || [];
    if (Array.isArray(source)) return source.slice(0, 10);
    if (Array.isArray(source.rows)) return source.rows.slice(0, 10);
    if (Array.isArray(source.items)) return source.items.slice(0, 10);
    if (Array.isArray(source.top10)) return source.top10.slice(0, 10);
    return [];
  }

  function confidenceLabel(value) {
    const n = Number(value);
    if (!Number.isFinite(n)) return '待補資料';
    const pct = n <= 1 ? n * 100 : n;
    if (pct >= 80) return `高可信 ${pct.toFixed(0)}%`;
    if (pct >= 60) return `中可信 ${pct.toFixed(0)}%`;
    return `低可信 ${pct.toFixed(0)}%`;
  }

  function statusLabel(value) {
    return ({ HIGH_GROWTH_WATCH: '高成長觀察', GROWTH_WATCH: '成長觀察', WATCH: '一般觀察' })[String(value || '').toUpperCase()] || value || '成長觀察';
  }

  function reasonList(item) {
    const direct = item.reasons || item.inclusionReasons || item.whySelected || item.reason;
    if (Array.isArray(direct)) return direct.map(String).filter(Boolean);
    if (direct) return [String(direct)];
    const reasons = [];
    const yoy = item.latestRevenueYoY ?? item.revenueYoY ?? item.fundamentals?.latestRevenueYoY;
    const prevYoy = item.previousRevenueYoY ?? item.fundamentals?.previousRevenueYoY;
    if (Number.isFinite(Number(yoy))) {
      reasons.push(`最新月營收年增率 ${pctValue(yoy)}${Number.isFinite(Number(prevYoy)) ? `，前月 ${pctValue(prevYoy)}` : ''}`);
    }
    const verified = item.verifiedNewsCount ?? item.news?.verifiedEventCount;
    const sources = item.independentSourceCount ?? item.news?.independentSourceCount;
    if (Number(verified) > 0) reasons.push(`已有 ${verified} 個新聞事件完成求證，涵蓋 ${Number(sources || 0)} 個獨立來源`);
    if (item.theme || item.growthTheme) reasons.push(`成長題材：${item.theme || item.growthTheme}`);
    return reasons.length ? reasons : ['目前僅有排名資料，詳細基本面與新聞證據仍在同步。'];
  }

  function newsEvidence(item) {
    const evidence = item.newsEvidence || item.news?.evidence || item.verifiedNews || [];
    return Array.isArray(evidence) ? evidence : [];
  }

  function riskList(item) {
    const risks = item.risks || item.riskReasons || item.news?.risks || [];
    if (Array.isArray(risks)) return risks.map(String).filter(Boolean);
    return risks ? [String(risks)] : [];
  }

  function score(item) {
    return item.totalScore ?? item.score ?? item.growthScore ?? '-';
  }

  function renderList() {
    const target = document.querySelector('#potentialStocksList');
    if (!target) return;
    const items = rows();
    if (!items.length) {
      target.innerHTML = '<div class="potential-empty"><strong>潛力股資料尚未產生</strong><span>每日 MCP／基本面／新聞求證完成後，會顯示最新高成長候選 Top10。系統不會用未求證單一新聞硬湊名單。</span></div>';
      return;
    }
    target.innerHTML = items.map((item, index) => {
      const symbol = item.symbol || item.stockCode || item.code || '-';
      const name = item.name || item.companyName || '';
      const verified = item.verifiedNewsCount ?? item.news?.verifiedEventCount ?? 0;
      return `
        <button type="button" class="potential-card" data-potential-symbol="${html(symbol)}">
          <span class="potential-rank">${index + 1}</span>
          <span class="potential-main"><strong>${html(symbol)} ${html(name)}</strong><small>${html(statusLabel(item.status || item.watchStatus))}</small></span>
          <span class="potential-score"><strong>${html(score(item))}</strong><small>總分</small></span>
          <span class="potential-proof"><strong>${html(confidenceLabel(item.confidence))}</strong><small>已求證新聞 ${html(verified)} 件</small></span>
          <span class="potential-more">查看原因 ›</span>
        </button>`;
    }).join('');
  }

  function renderDetail(symbol) {
    const target = document.querySelector('#potentialStockDetail');
    if (!target) return;
    const item = rows().find(row => String(row.symbol || row.stockCode || row.code) === String(symbol));
    if (!item) {
      target.innerHTML = '<div class="potential-empty"><strong>找不到該候選資料</strong></div>';
      return;
    }
    const reasons = reasonList(item);
    const risks = riskList(item);
    const evidence = newsEvidence(item);
    const fundamentals = item.fundamentals || {};
    const symbolText = item.symbol || item.stockCode || item.code || '-';
    const name = item.name || item.companyName || '';
    const fundamentalScore = item.fundamentalScore ?? item.components?.fundamental ?? fundamentals.score ?? '-';
    const newsScore = item.newsScore ?? item.components?.news ?? item.news?.score ?? '-';
    const themeScore = item.themeScore ?? item.components?.theme ?? '-';
    target.innerHTML = `
      <div class="potential-detail-head">
        <div><button type="button" id="potentialBackButton" class="potential-back">← 返回 Top10</button><h3>${html(symbolText)} ${html(name)}</h3><p>${html(statusLabel(item.status || item.watchStatus))} · ${html(confidenceLabel(item.confidence))}</p></div>
        <div class="potential-big-score"><strong>${html(score(item))}</strong><span>成長總分</span></div>
      </div>
      <div class="potential-breakdown">
        <div><span>基本面</span><strong>${html(fundamentalScore)}</strong></div>
        <div><span>新聞求證</span><strong>${html(newsScore)}</strong></div>
        <div><span>成長題材</span><strong>${html(themeScore)}</strong></div>
      </div>
      <section class="potential-detail-section"><h4>列入原因</h4><ul>${reasons.map(reason => `<li>${html(reason)}</li>`).join('')}</ul></section>
      <section class="potential-detail-section"><h4>基本面重點</h4><div class="potential-facts">
        <span>最新營收 YoY <strong>${html(pctValue(item.latestRevenueYoY ?? fundamentals.latestRevenueYoY))}</strong></span>
        <span>前月營收 YoY <strong>${html(pctValue(item.previousRevenueYoY ?? fundamentals.previousRevenueYoY))}</strong></span>
        <span>淨利 <strong>${html(number(item.netIncome ?? fundamentals.netIncome, 0))}</strong></span>
        <span>營業利益 <strong>${html(number(item.operatingIncome ?? fundamentals.operatingIncome, 0))}</strong></span>
        <span>營業現金流 <strong>${html(number(item.operatingCashFlow ?? fundamentals.operatingCashFlow, 0))}</strong></span>
        <span>負債比 <strong>${html(pctValue(item.liabilitiesToAssets ?? fundamentals.liabilitiesToAssets))}</strong></span>
      </div></section>
      <section class="potential-detail-section"><h4>新聞求證</h4>${evidence.length ? `<div class="potential-news-evidence">${evidence.map(row => `<article><strong>${html(row.title || row.eventKey || '已驗證事件')}</strong><span>${html((row.sources || []).join('、') || row.source || '官方／多來源')}</span><small>${row.verified === false ? '尚未完成交叉驗證' : '已完成交叉驗證'}</small></article>`).join('')}</div>` : '<p class="potential-muted">目前沒有可顯示的已驗證新聞明細；未求證消息不會提高排名。</p>'}</section>
      <section class="potential-detail-section"><h4>風險提醒</h4>${risks.length ? `<ul class="potential-risks">${risks.map(risk => `<li>${html(risk)}</li>`).join('')}</ul>` : '<p class="potential-muted">目前沒有重大硬風險紀錄；仍不代表股價一定上漲。</p>'}</section>`;

    document.querySelector('#potentialBackButton')?.addEventListener('click', () => {
      state.selectedSymbol = null;
      target.hidden = true;
      document.querySelector('#potentialStocksList').hidden = false;
    });
  }

  function installStyles() {
    if (document.querySelector('#potentialStocksStyle')) return;
    const style = document.createElement('style');
    style.id = 'potentialStocksStyle';
    style.textContent = `
      .potential-action{background:linear-gradient(180deg,#fff8df,#f6df99)!important;color:#50380b!important;border-color:#e4c66b!important}.potential-dialog{max-width:980px}.potential-list{display:grid;gap:10px}.potential-card{display:grid;grid-template-columns:42px minmax(180px,1.4fr) 80px 160px auto;align-items:center;gap:12px;width:100%;text-align:left;background:#fff;border:1px solid #d8e0ea;padding:13px 14px}.potential-card:hover{border-color:#d39b2a;background:#fffdf6}.potential-rank{display:grid;place-items:center;width:34px;height:34px;border-radius:50%;background:#fff3d6;color:#8a5c08;font-weight:800}.potential-main,.potential-score,.potential-proof{display:grid;gap:3px}.potential-main strong{font-size:16px}.potential-card small,.potential-main small{color:#657487}.potential-score strong{font-size:20px;color:#16805a}.potential-proof strong{font-size:13px}.potential-more{color:#1767c2;font-weight:700}.potential-empty{display:grid;gap:8px;padding:24px;border:1px dashed #cbd7e5;border-radius:8px;background:#f8fafc}.potential-empty span{color:#657487;line-height:1.6}.potential-detail-head{display:flex;align-items:flex-start;justify-content:space-between;gap:18px}.potential-detail-head h3{font-size:24px;margin:10px 0 4px}.potential-detail-head p,.potential-muted{color:#657487}.potential-back{padding:7px 10px;min-height:34px}.potential-big-score{display:grid;text-align:center;padding:12px 18px;border-radius:8px;background:#fff3d6}.potential-big-score strong{font-size:30px;color:#8a5c08}.potential-big-score span{font-size:12px;color:#657487}.potential-breakdown{display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin:18px 0}.potential-breakdown div{display:grid;gap:5px;padding:12px;background:#f8fafc;border:1px solid #d8e0ea;border-radius:8px}.potential-breakdown span{color:#657487;font-size:12px}.potential-breakdown strong{font-size:20px}.potential-detail-section{border-top:1px solid #d8e0ea;padding-top:16px;margin-top:16px}.potential-detail-section h4{margin:0 0 10px}.potential-detail-section li{margin:7px 0;line-height:1.55}.potential-facts{display:grid;grid-template-columns:repeat(3,1fr);gap:8px}.potential-facts span{padding:10px;border-radius:8px;background:#f8fafc;color:#657487}.potential-facts strong{display:block;color:#18202a;margin-top:4px}.potential-news-evidence{display:grid;gap:8px}.potential-news-evidence article{display:grid;gap:4px;padding:11px;border:1px solid #d8e0ea;border-radius:8px}.potential-news-evidence span,.potential-news-evidence small{color:#657487}.potential-risks{color:#a33}.potential-detail[hidden],.potential-list[hidden]{display:none!important}@media(max-width:760px){.top-actions{grid-template-columns:repeat(2,minmax(0,1fr))!important}.potential-card{grid-template-columns:36px 1fr 62px}.potential-proof,.potential-more{grid-column:2 / -1}.potential-breakdown,.potential-facts{grid-template-columns:1fr}.potential-detail-head{display:grid}}
    `;
    document.head.appendChild(style);
  }

  function installModal() {
    if (document.querySelector('#openPotentialStocksButton')) return;
    installStyles();
    const actions = document.querySelector('.top-actions');
    if (!actions) return;
    const button = document.createElement('button');
    button.type = 'button';
    button.id = 'openPotentialStocksButton';
    button.className = 'primary-action potential-action';
    button.textContent = '潛力股 Top10';
    const lastUpdated = actions.querySelector('#lastUpdatedAt');
    actions.insertBefore(button, lastUpdated || null);

    const modal = document.createElement('div');
    modal.id = 'potentialStocksModal';
    modal.className = 'rules-modal';
    modal.hidden = true;
    modal.innerHTML = `
      <div class="rules-backdrop" data-close-potential-stocks></div>
      <section class="rules-dialog potential-dialog" role="dialog" aria-modal="true" aria-labelledby="potentialStocksTitle">
        <div class="rules-header"><div><p class="eyebrow">Growth discovery</p><h2 id="potentialStocksTitle">未來高成長潛力股 Top10</h2><p>依公司基本面與多來源新聞求證排序；這是研究觀察清單，不是買進指令。</p></div><button type="button" class="icon-close" data-close-potential-stocks aria-label="關閉潛力股">×</button></div>
        <div class="rules-content"><div id="potentialStocksList" class="potential-list"></div><div id="potentialStockDetail" class="potential-detail" hidden></div></div>
      </section>`;
    document.body.appendChild(modal);

    const close = () => { modal.hidden = true; document.body.classList.remove('modal-open'); button.focus(); };
    const open = () => {
      state.selectedSymbol = null;
      document.querySelector('#potentialStockDetail').hidden = true;
      document.querySelector('#potentialStocksList').hidden = false;
      renderList();
      modal.hidden = false;
      document.body.classList.add('modal-open');
    };
    button.addEventListener('click', open);
    modal.querySelectorAll('[data-close-potential-stocks]').forEach(node => node.addEventListener('click', close));
    modal.addEventListener('click', event => {
      const card = event.target.closest('[data-potential-symbol]');
      if (!card) return;
      state.selectedSymbol = card.dataset.potentialSymbol;
      document.querySelector('#potentialStocksList').hidden = true;
      const detail = document.querySelector('#potentialStockDetail');
      detail.hidden = false;
      renderDetail(state.selectedSymbol);
    });
    document.addEventListener('keydown', event => { if (event.key === 'Escape' && !modal.hidden) close(); });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', installModal);
  else installModal();
  window.addEventListener('load', installModal);
  window.renderPotentialStocks = renderList;
})();
