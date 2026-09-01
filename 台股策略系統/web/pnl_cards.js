(function () {
  'use strict';

  function realizedTrades(trades) {
    return (Array.isArray(trades) ? trades : []).filter(trade => {
      const action = String(trade.action || trade.side || '').toUpperCase();
      return action === 'SELL' || action === 'DAYTRADE' || action === '賣出' || action === '當沖';
    });
  }

  function latestScenarioDay() {
    const days = Array.isArray(window.ACTUAL_SCENARIO) && window.ACTUAL_SCENARIO.length
      ? window.ACTUAL_SCENARIO
      : [];
    return days.filter(day => day.date >= CONFIG.simulationStartDate).at(-1) || days.at(-1) || null;
  }

  function candidateFor(day, symbol) {
    return (day?.candidates || []).find(candidate => candidate.symbol === symbol);
  }

  function unrealizedSummary(result, day) {
    const rows = (Array.isArray(result?.positions) ? result.positions : []).map(position => {
      const candidate = candidateFor(day, position.symbol);
      const liveQuote = candidate && typeof executionSellPrice === 'function'
        ? executionSellPrice(candidate)
        : 0;
      const current = typeof positionMarkPrice === 'function'
        ? positionMarkPrice(position, candidate)
        : (liveQuote > 0 ? liveQuote : Number(position.avgCost || position.averagePrice || 0));
      const shares = Number(position.shares || position.quantity || 0);
      const cost = Number(position.totalCost || shares * Number(position.avgCost || position.averagePrice || 0));
      const grossValue = shares * current;
      const netValue = typeof netSellProceeds === 'function' ? netSellProceeds(grossValue, false) : grossValue;
      const pnl = netValue - cost;
      return {
        ...position,
        current,
        shares,
        cost,
        netValue,
        pnl,
        pnlPct: cost ? pnl / cost : 0,
        quoteSession: liveQuote > 0 && typeof sessionLabel === 'function'
          ? sessionLabel(candidate?.session || day?.session)
          : '最後有效',
      };
    });
    return {
      rows,
      cost: rows.reduce((sum, row) => sum + row.cost, 0),
      pnl: rows.reduce((sum, row) => sum + row.pnl, 0),
    };
  }

  function renderCards(result, day) {
    if (!result || !day) return;
    const realizedPnl = Number(result.realizedPnl || 0);
    const unrealized = unrealizedSummary(result, day);
    const initialCapital = Number(result.initialCapital || CONFIG.initialCapital || 0);

    setText('#realizedPnl', currency(realizedPnl), realizedPnl);
    setText('#realizedPnlPct', pct(initialCapital ? realizedPnl / initialCapital : 0), realizedPnl);
    setText('#tradeCount', `${realizedTrades(result.trades).length} 筆已結案；費稅 ${currency((result.totalFees || 0) + (result.totalTaxes || 0))}`);
    setText('#unrealizedPnl', currency(unrealized.pnl), unrealized.pnl);
    setText('#unrealizedPnlPct', pct(unrealized.cost ? unrealized.pnl / unrealized.cost : 0), unrealized.pnl);
    setText('#unrealizedPositionCount', `${unrealized.rows.length} 檔持倉；稅費後估值`);
  }

  function setText(selector, text, signedValue = null) {
    const element = document.querySelector(selector);
    if (!element) return;
    element.textContent = text;
    if (signedValue !== null) element.className = Number(signedValue) >= 0 ? 'gain' : 'loss';
  }

  function renderModal(kind) {
    const result = typeof currentSimulation === 'function' ? currentSimulation() : window.PRECOMPUTED_SIMULATION;
    const day = latestScenarioDay();
    const title = document.querySelector('#pnlModalTitle');
    const content = document.querySelector('#pnlModalContent');
    if (!result || !day || !title || !content) return;
    const realized = kind === 'realized';
    title.textContent = realized ? '已實現損益紀錄' : '未實現損益紀錄';
    content.innerHTML = realized ? realizedHtml(result) : unrealizedHtml(result, day);
  }

  function realizedHtml(result) {
    const rows = realizedTrades(result.trades).slice().reverse();
    const realizedPnl = Number(result.realizedPnl || rows.reduce((sum, trade) => sum + Number(trade.pnl || 0), 0));
    const initialCapital = Number(result.initialCapital || CONFIG.initialCapital || 0);
    const winRate = rows.length ? rows.filter(trade => Number(trade.pnl || 0) > 0).length / rows.length : 0;
    return `
      <div class="return-summary pnl-record-summary">
        <div><span>已實現損益</span><strong class="${realizedPnl >= 0 ? 'gain' : 'loss'}">${currency(realizedPnl)}</strong></div>
        <div><span>占初始資金</span><strong class="${realizedPnl >= 0 ? 'gain' : 'loss'}">${pct(initialCapital ? realizedPnl / initialCapital : 0)}</strong></div>
        <div><span>已結案勝率</span><strong>${pct(winRate)}</strong></div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>日期</th><th>動作</th><th>股票</th><th>股數</th><th>價格</th><th>手續費</th><th>交易稅</th><th>損益</th><th>原因</th></tr></thead>
          <tbody>${rows.map(trade => `
            <tr>
              <td>${trade.date}<br><span>${sessionLabel(trade.session)}</span></td>
              <td><span class="badge ${actionBadgeClass(trade.action)}">${displayTradeAction(trade.action)}</span></td>
              <td><strong>${trade.symbol}</strong><br><span>${resolvedStockName(trade.symbol, trade.name)}</span></td>
              <td>${Number(trade.shares || 0).toLocaleString('zh-TW')}</td>
              <td>${price(trade.price)}</td>
              <td>${currency(trade.fee || 0)}</td>
              <td>${currency(trade.tax || 0)}</td>
              <td class="${Number(trade.pnl || 0) >= 0 ? 'gain' : 'loss'}">${currency(trade.pnl || 0)}</td>
              <td class="reason">${displayTradeReason(trade.reason)}</td>
            </tr>
          `).join('') || '<tr><td colspan="9">尚無已實現損益紀錄。</td></tr>'}</tbody>
        </table>
      </div>
    `;
  }

  function unrealizedHtml(result, day) {
    const summary = unrealizedSummary(result, day);
    return `
      <div class="return-summary pnl-record-summary">
        <div><span>未實現損益</span><strong class="${summary.pnl >= 0 ? 'gain' : 'loss'}">${currency(summary.pnl)}</strong></div>
        <div><span>持倉報酬率</span><strong class="${summary.pnl >= 0 ? 'gain' : 'loss'}">${pct(summary.cost ? summary.pnl / summary.cost : 0)}</strong></div>
        <div><span>持倉檔數</span><strong>${summary.rows.length.toLocaleString('zh-TW')}</strong></div>
      </div>
      <div class="table-wrap">
        <table>
          <thead><tr><th>股票</th><th>股數</th><th>成本</th><th>現價</th><th>稅費後估值</th><th>損益</th><th>狀態</th></tr></thead>
          <tbody>${summary.rows.map(row => {
            const candidate = candidateFor(day, row.symbol);
            return `
              <tr>
                <td><strong>${row.symbol}</strong><br><span>${row.name || '-'}</span></td>
                <td>${row.shares.toLocaleString('zh-TW')}</td>
                <td>${currency(row.cost)}<br><span>${price(row.avgCost || row.averagePrice)}</span></td>
                <td>${price(row.current)}<br><span>${row.quoteSession}</span></td>
                <td>${currency(row.netValue)}</td>
                <td class="${row.pnl >= 0 ? 'gain' : 'loss'}">${currency(row.pnl)} (${pct(row.pnlPct)})</td>
                <td>${typeof positionStatus === 'function' ? positionStatus(candidate, row) : '-'}</td>
              </tr>
            `;
          }).join('') || '<tr><td colspan="7">目前沒有持倉，因此沒有未實現損益。</td></tr>'}</tbody>
        </table>
      </div>
    `;
  }

  function init() {
    const modal = document.querySelector('#pnlModal');
    if (!modal || window.__pnlCardsReady) return;
    window.__pnlCardsReady = true;

    document.querySelectorAll('[data-pnl-card]').forEach(card => {
      const open = () => {
        renderModal(card.dataset.pnlCard);
        modal.hidden = false;
        document.body.classList.add('modal-open');
        modal.querySelector('.icon-close')?.focus();
      };
      card.addEventListener('click', open);
      card.addEventListener('keydown', event => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          open();
        }
      });
    });

    const close = () => {
      modal.hidden = true;
      document.body.classList.remove('modal-open');
    };
    modal.querySelectorAll('[data-close-pnl]').forEach(button => button.addEventListener('click', close));
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape' && !modal.hidden) close();
    });

    window.renderPnlCards = renderCards;
    renderCards(typeof currentSimulation === 'function' ? currentSimulation() : window.PRECOMPUTED_SIMULATION, latestScenarioDay());
  }

  init();
})();
