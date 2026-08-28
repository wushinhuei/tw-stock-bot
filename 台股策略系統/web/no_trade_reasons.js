(function () {
  'use strict';

  const originalRenderTodayDecision = window.renderTodayDecision;

  function html(value) {
    return String(value == null ? '' : value)
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  function candidateLabel(candidate) {
    return `${candidate.symbol || '-'} ${candidate.name || ''}`.trim();
  }

  function countLabel(count) {
    return `${Number(count || 0).toLocaleString('zh-TW')} 檔`;
  }

  function addReason(reasons, key, title, detail, severity = 'watch') {
    if (reasons.some(reason => reason.key === key)) return;
    reasons.push({ key, title, detail, severity });
  }

  function quoteIsStale(candidate) {
    const timestamp = candidate.metrics?.latestQuoteTime || candidate.timestamp || candidate.latestQuoteTime;
    if (!timestamp) return true;
    const time = new Date(timestamp).getTime();
    if (!Number.isFinite(time)) return true;
    const maxAge = Number(CONFIG.quoteMaxAgeMs || 10 * 60 * 1000);
    return Math.abs(Date.now() - time) > maxAge;
  }

  function summarizeCandidates(candidates, predicate, limit = 4) {
    const matched = candidates.filter(predicate);
    const names = matched.slice(0, limit).map(candidateLabel).join('、');
    const suffix = matched.length > limit ? ` 等 ${countLabel(matched.length)}` : countLabel(matched.length);
    return { matched, names, suffix };
  }

  function gradeBreakdown(candidates) {
    const counts = candidates.reduce((map, candidate) => {
      const grade = candidate.grade || '未分級';
      map[grade] = (map[grade] || 0) + 1;
      return map;
    }, {});
    return ['A', 'B', 'C', 'BLOCKED', '未分級']
      .filter(grade => counts[grade])
      .map(grade => `${grade} ${counts[grade]}`)
      .join('、') || '沒有候選資料';
  }

  function noTradeReasons(result, day, marketState, buys) {
    const candidates = Array.isArray(day?.candidates) ? day.candidates : [];
    const reasons = [];
    const today = typeof todayTaipeiDate === 'function' ? todayTaipeiDate() : '';
    const dataDate = String(day?.date || '');

    if (!candidates.length) {
      addReason(reasons, 'no-candidates', '候選名單未產生', '目前沒有可檢查的候選股清單，系統無法進入買進判斷。', 'blocked');
      return reasons;
    }

    if (dataDate && dataDate < CONFIG.simulationStartDate) {
      addReason(reasons, 'before-start', '資料早於模擬起始日', `目前資料日 ${dataDate} 早於模擬起始日 ${CONFIG.simulationStartDate}，不會納入自動交易。`, 'blocked');
    } else if (today && dataDate && dataDate !== today) {
      addReason(reasons, 'not-today', '資料不是今日', `目前最近資料日為 ${dataDate}，不是今日 ${today}；若雲端讀取失敗，畫面可能正在使用備援資料。`, 'blocked');
    }

    if (result?.dailyStopped) {
      addReason(reasons, 'daily-stop', '日內風控啟動', `單日損益已觸及 ${pct(CONFIG.dailyStopLossPct)} 停損線，停止新增部位。`, 'blocked');
    }

    if (result?.weeklyLimited) {
      addReason(reasons, 'weekly-stop', '週風控限制', `週損益已接近或低於 ${pct(CONFIG.weeklyStopLossPct)}，僅允許降低風險。`, 'blocked');
    }

    if (marketState.mode === 'DEFENSIVE') {
      addReason(reasons, 'market-defensive', '大盤防守模式', '加權指數未通過 50MA 濾網，系統不新增多方部位。', 'blocked');
    }

    if (!buys.length) {
      const aGrades = candidates.filter(candidate => candidate.grade === 'A');
      if (!aGrades.length) {
        addReason(reasons, 'no-a-grade', '無 A 級候選', `今日分級為 ${gradeBreakdown(candidates)}；買進規則只允許 A 級或後端明確允許的小額試單。`, 'blocked');
      }
    }

    if (CONFIG.strategyMode === 'LONG_ONLY' || Number(CONFIG.dayTradeCapitalPct || 0) <= 0) {
      addReason(reasons, 'daytrade-off', '當沖/盤中短線關閉', '目前前端設定為純做多長倉模式，盤中短線模擬不會執行。', 'watch');
    }

    const stale = summarizeCandidates(candidates, quoteIsStale);
    if (stale.matched.length) {
      addReason(reasons, 'stale-quotes', '資料過期或非即時', `${stale.names || '部分候選'} 的報價時間已超過允許範圍；資料過期時不新增交易。`, 'blocked');
    }

    const chipWeak = summarizeCandidates(candidates, candidate => candidate.grade !== 'A' && candidate.chipOk === false);
    if (chipWeak.matched.length) {
      addReason(reasons, 'chip-weak', '籌碼不足', `${chipWeak.names} 籌碼未通過；目前籌碼是升 A 與隔日沖成立的重要門檻。`, 'watch');
    }

    const dataIncomplete = summarizeCandidates(candidates, candidate =>
      candidate.dataStatus === 'INCOMPLETE' ||
      candidate.metrics?.liveScoringError ||
      (candidate.blockedReasons || []).some(reason => /資料|OBV|行情|日期|不足|過期/.test(String(reason)))
    );
    if (dataIncomplete.matched.length) {
      addReason(reasons, 'data-incomplete', '技術或 OBV 資料不足', `${dataIncomplete.names || '部分候選'} 資料不完整；系統會阻擋新交易，不用假價格補單。`, 'blocked');
    }

    const chaseBlocked = summarizeCandidates(candidates, candidate =>
      Number(candidate.intradayReturnPct || 0) > Number(CONFIG.maxChasePct || 0.003) ||
      /追價風險/.test(String(candidate.executionPlan?.reason || ''))
    );
    if (chaseBlocked.matched.length) {
      addReason(reasons, 'chase-limit', '追價超限', `${chaseBlocked.names} 已超過追價上限 ${pct(CONFIG.maxChasePct || 0.003)} 或只能限價等待。`, 'watch');
    }

    const executionBlocked = summarizeCandidates(candidates, candidate =>
      candidate.grade === 'A' && candidate.executionPlan && candidate.executionPlan.allowEntry === false
    );
    if (executionBlocked.matched.length) {
      addReason(reasons, 'execution-plan', '交易計畫不允許進場', `${executionBlocked.names} 雖為 A 級，但價差、追價或流動性條件未通過。`, 'blocked');
    }

    if (typeof tradableCash === 'function' && tradableCash(result) <= 0) {
      addReason(reasons, 'cash-reserve', '現金保留限制', `可交易現金不足；系統必須保留至少 ${pct(CONFIG.minCashReservePct)} 現金。`, 'blocked');
    }

    return reasons.slice(0, 6);
  }

  function renderNoTradeReasons(result, day, marketState, buys) {
    const target = document.querySelector('#todayDecision');
    if (!target) return;
    const reasons = noTradeReasons(result, day, marketState, buys);
    const summary = buys.length
      ? `已找到 ${countLabel(buys.length)} 可買進標的，仍列出主要風險檢查。`
      : '今日沒有買進時，系統會列出最主要的阻擋條件。';
    const items = reasons.map(reason => `
      <li class="no-trade-reason ${html(reason.severity)}">
        <strong>${html(reason.title)}</strong>
        <span>${html(reason.detail)}</span>
      </li>
    `).join('') || `
      <li class="no-trade-reason ok">
        <strong>未發現明確阻擋</strong>
        <span>若仍未成交，請檢查後端委託撮合、雲端排程或資料寫入狀態。</span>
      </li>
    `;

    target.insertAdjacentHTML('beforeend', `
      <div class="no-trade-reasons-card">
        <strong>未操作原因</strong>
        <span>${html(summary)}</span>
        <ul>${items}</ul>
      </div>
    `);
  }

  window.renderTodayDecision = function renderTodayDecisionWithNoTradeReasons(result, day) {
    if (typeof originalRenderTodayDecision === 'function') {
      originalRenderTodayDecision(result, day);
    }
    const marketState = evaluateMarket(day);
    const buys = (day?.candidates || []).filter(candidate => canOpenPosition(candidate, marketState, result));
    renderNoTradeReasons(result, day, marketState, buys);
  };

  window.setTimeout(() => {
    if (typeof window.render === 'function' && typeof window.currentSimulation === 'function') {
      window.render(window.currentSimulation());
    }
  }, 0);
})();

(function () {
  'use strict';

  function latestScenarioDay() {
    const days = Array.isArray(window.ACTUAL_SCENARIO) && window.ACTUAL_SCENARIO.length ? window.ACTUAL_SCENARIO : [];
    return days.filter(day => day.date >= CONFIG.simulationStartDate).at(-1) || days.at(-1) || null;
  }

  function realizedTrades(trades) {
    return (Array.isArray(trades) ? trades : []).filter(trade => {
      const action = String(trade.action || trade.side || '').toUpperCase();
      return action === 'SELL' || action === 'DAYTRADE' || action === '賣出' || action === '當沖';
    });
  }

  function candidateFor(day, symbol) {
    return (day?.candidates || []).find(candidate => candidate.symbol === symbol);
  }

  function ensureCardStructure() {
    const grid = document.querySelector('.summary-grid');
    const metrics = Array.from(document.querySelectorAll('.summary-grid .metric'));
    const realized = metrics[2];
    const unrealized = metrics[3];
    if (!grid || !realized || !unrealized) return false;

    realized.classList.add('metric-action');
    realized.dataset.pnlCard = 'realized';
    realized.setAttribute('role', 'button');
    realized.setAttribute('tabindex', '0');
    realized.setAttribute('aria-controls', 'pnlModal');
    const realizedLabel = realized.querySelector('span');
    const realizedStrong = realized.querySelector('strong');
    if (realizedLabel) realizedLabel.textContent = '已實現損益';
    if (realizedStrong) {
      realizedStrong.id = 'realizedPnl';
      realizedStrong.textContent = '-';
    }
    const realizedSmall = realized.querySelector('small');
    if (realizedSmall && !document.querySelector('#realizedPnlPct')) {
      realizedSmall.removeAttribute('id');
      realizedSmall.innerHTML = '<span id="realizedPnlPct">-</span>；<span id="tradeCount">-</span>';
    }

    const oldMax = document.querySelector('#maxDrawdown');
    if (oldMax) oldMax.removeAttribute('id');
    if (!document.querySelector('#maxDrawdown')) {
      const hidden = document.createElement('span');
      hidden.id = 'maxDrawdown';
      hidden.hidden = true;
      grid.appendChild(hidden);
    }

    unrealized.classList.add('metric-action');
    unrealized.dataset.pnlCard = 'unrealized';
    unrealized.setAttribute('role', 'button');
    unrealized.setAttribute('tabindex', '0');
    unrealized.setAttribute('aria-controls', 'pnlModal');
    const label = unrealized.querySelector('span');
    const strong = unrealized.querySelector('strong');
    const small = unrealized.querySelector('small');
    if (label) label.textContent = '未實現損益';
    if (strong) {
      strong.id = 'unrealizedPnl';
      strong.textContent = '-';
    }
    if (small) small.innerHTML = '<span id="unrealizedPnlPct">-</span>；<span id="unrealizedPositionCount">-</span>';
    return true;
  }

  function ensureModal() {
    if (document.querySelector('#pnlModal')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div id="pnlModal" class="rules-modal" hidden>
        <div class="rules-backdrop" data-close-pnl></div>
        <section class="rules-dialog pnl-dialog" role="dialog" aria-modal="true" aria-labelledby="pnlModalTitle">
          <div class="rules-header">
            <div>
              <p class="eyebrow">Profit and Loss</p>
              <h2 id="pnlModalTitle">損益紀錄</h2>
            </div>
            <button type="button" class="icon-close" data-close-pnl aria-label="關閉損益紀錄">×</button>
          </div>
          <div id="pnlModalContent" class="rules-content"></div>
        </section>
      </div>
    `);
  }

  function unrealizedSummary(result, day) {
    const rows = (Array.isArray(result?.positions) ? result.positions : []).map(position => {
      const candidate = candidateFor(day, position.symbol);
      const current = candidate && typeof executionSellPrice === 'function'
        ? executionSellPrice(candidate)
        : Number(position.avgCost || position.averagePrice || 0);
      const shares = Number(position.shares || position.quantity || 0);
      const cost = Number(position.totalCost || shares * Number(position.avgCost || position.averagePrice || 0));
      const netValue = typeof netSellProceeds === 'function' ? netSellProceeds(shares * current, false) : shares * current;
      const pnl = netValue - cost;
      return { ...position, current, shares, cost, netValue, pnl, pnlPct: cost ? pnl / cost : 0 };
    });
    return {
      rows,
      cost: rows.reduce((sum, row) => sum + row.cost, 0),
      pnl: rows.reduce((sum, row) => sum + row.pnl, 0),
    };
  }

  function setText(selector, text, signedValue = null) {
    const element = document.querySelector(selector);
    if (!element) return;
    element.textContent = text;
    if (signedValue !== null) element.className = Number(signedValue) >= 0 ? 'gain' : 'loss';
  }

  function renderCards(result, day) {
    if (!ensureCardStructure() || !result || !day) return;
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

  function renderModal(kind) {
    const result = typeof currentSimulation === 'function' ? currentSimulation() : window.PRECOMPUTED_SIMULATION;
    const day = latestScenarioDay();
    const title = document.querySelector('#pnlModalTitle');
    const content = document.querySelector('#pnlModalContent');
    if (!result || !day || !title || !content) return;
    title.textContent = kind === 'realized' ? '已實現損益紀錄' : '未實現損益紀錄';
    content.innerHTML = kind === 'realized' ? realizedHtml(result) : unrealizedHtml(result, day);
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
      <div class="table-wrap"><table>
        <thead><tr><th>日期</th><th>動作</th><th>股票</th><th>股數</th><th>價格</th><th>手續費</th><th>交易稅</th><th>損益</th><th>原因</th></tr></thead>
        <tbody>${rows.map(trade => `
          <tr>
            <td>${trade.date}<br><span>${sessionLabel(trade.session)}</span></td>
            <td><span class="badge ${actionBadgeClass(trade.action)}">${displayTradeAction(trade.action)}</span></td>
            <td><strong>${trade.symbol}</strong><br><span>${trade.name || '-'}</span></td>
            <td>${Number(trade.shares || 0).toLocaleString('zh-TW')}</td>
            <td>${price(trade.price)}</td>
            <td>${currency(trade.fee || 0)}</td>
            <td>${currency(trade.tax || 0)}</td>
            <td class="${Number(trade.pnl || 0) >= 0 ? 'gain' : 'loss'}">${currency(trade.pnl || 0)}</td>
            <td class="reason">${displayTradeReason(trade.reason)}</td>
          </tr>
        `).join('') || '<tr><td colspan="9">尚無已實現損益紀錄。</td></tr>'}</tbody>
      </table></div>
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
      <div class="table-wrap"><table>
        <thead><tr><th>股票</th><th>股數</th><th>成本</th><th>現價</th><th>稅費後估值</th><th>損益</th><th>狀態</th></tr></thead>
        <tbody>${summary.rows.map(row => {
          const candidate = candidateFor(day, row.symbol);
          const status = typeof positionStatus === 'function' ? positionStatus(candidate, row) : '-';
          const quoteSession = typeof sessionLabel === 'function' ? sessionLabel(candidate?.session || day?.session) : '-';
          return `
            <tr>
              <td><strong>${row.symbol}</strong><br><span>${row.name || '-'}</span></td>
              <td>${row.shares.toLocaleString('zh-TW')}</td>
              <td>${currency(row.cost)}<br><span>${price(row.avgCost || row.averagePrice)}</span></td>
              <td>${price(row.current)}<br><span>${quoteSession}</span></td>
              <td>${currency(row.netValue)}</td>
              <td class="${row.pnl >= 0 ? 'gain' : 'loss'}">${currency(row.pnl)} (${pct(row.pnlPct)})</td>
              <td>${status}</td>
            </tr>
          `;
        }).join('') || '<tr><td colspan="7">目前沒有持倉，因此沒有未實現損益。</td></tr>'}</tbody>
      </table></div>
    `;
  }

  function initPnlCards() {
    if (window.__pnlCardsPublicReady) return;
    ensureCardStructure();
    ensureModal();
    const modal = document.querySelector('#pnlModal');
    if (!modal) return;
    window.__pnlCardsPublicReady = true;

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

    const originalRender = window.render;
    if (typeof originalRender === 'function') {
      window.render = function renderWithPnlCards(result) {
        originalRender(result);
        renderCards(result, latestScenarioDay());
      };
    }
    renderCards(typeof currentSimulation === 'function' ? currentSimulation() : window.PRECOMPUTED_SIMULATION, latestScenarioDay());
  }

  window.setTimeout(initPnlCards, 0);
})();
