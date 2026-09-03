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
