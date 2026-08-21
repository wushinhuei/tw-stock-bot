(function () {
  const config = window.TW_STOCK_BOT_CONFIG || {};
  const fallbackMarket = window.TW_STOCK_ACTUAL_DATA || {};
  const fallbackSimulation = window.TW_STOCK_SIMULATION_RESULT || {};
  const feeConfig = {
    commissionRate: 0.001425,
    stockTransactionTaxRate: 0.003,
    minimumCommission: 20
  };
  const state = {
    data: mergePayload(fallbackMarket, fallbackSimulation),
    tradeSignature: fallbackSimulation.tradeSignature || "",
    refreshTimer: null,
    statusTimer: null
  };

  const els = {
    refreshButton: byId("refreshButton"),
    settingsLink: byId("settingsLink"),
    historyButton: byId("historyButton"),
    historyPanel: byId("historyPanel"),
    historyBody: byId("historyBody"),
    lastUpdated: byId("lastUpdated"),
    tradeSignature: byId("tradeSignature"),
    equity: byId("equity"),
    cash: byId("cash"),
    marketValue: byId("marketValue"),
    unrealizedPnl: byId("unrealizedPnl"),
    cashChange: byId("cashChange"),
    stockValue: byId("stockValue"),
    stockChange: byId("stockChange"),
    accountChange: byId("accountChange"),
    dailyPnl: byId("dailyPnl"),
    returnLine: byId("returnLine"),
    cashReserve: byId("cashReserve"),
    targetLine: byId("targetLine"),
    riskMessage: byId("riskMessage"),
    marketSummary: byId("marketSummary"),
    marketBars: byId("marketBars"),
    candidateCount: byId("candidateCount"),
    candidatesBody: byId("candidatesBody"),
    positionsBody: byId("positionsBody"),
    holdingsSummary: byId("holdingsSummary"),
    tradeCount: byId("tradeCount"),
    tradesBody: byId("tradesBody"),
    weeklyReport: byId("weeklyReport"),
    thirtyDayReport: byId("thirtyDayReport")
  };

  init();

  function init() {
    if (els.settingsLink && config.settingsSheetUrl) {
      els.settingsLink.href = config.settingsSheetUrl;
    }
    els.refreshButton.addEventListener("click", () => refreshData(true));
    els.historyButton.addEventListener("click", toggleHistory);
    render(state.data);
    refreshData(false);
    state.refreshTimer = setInterval(() => refreshData(false), config.refreshIntervalMs || 1800000);
    state.statusTimer = setInterval(checkStatus, config.statusIntervalMs || 60000);
  }

  async function refreshData(force) {
    setLoading(true);
    try {
      const action = force ? "refresh" : "read";
      const payload = await requestAppsScript(action, force ? { force: "1" } : {});
      const next = normalizePayload(payload);
      state.data = next;
      state.tradeSignature = next.tradeSignature || state.tradeSignature;
      render(next);
    } catch (error) {
      render(state.data);
      console.warn("refresh failed", error);
    } finally {
      setLoading(false);
    }
  }

  async function checkStatus() {
    try {
      const status = await requestAppsScript("status");
      const nextSignature = status.tradeSignature || status.signature || "";
      if (nextSignature && nextSignature !== state.tradeSignature) {
        state.tradeSignature = nextSignature;
        await refreshData(false);
      }
    } catch (error) {
      console.warn("status failed", error);
    }
  }

  function requestAppsScript(action, params) {
    if (!config.endpoint) {
      return Promise.reject(new Error("Missing Apps Script endpoint"));
    }
    const query = new URLSearchParams(Object.assign({ action }, params || {}));
    const url = `${config.endpoint}?${query.toString()}`;
    return fetchWithTimeout(url, config.requestTimeoutMs || 75000)
      .then((response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then((payload) => {
        if (payload && payload.ok === false) throw new Error(payload.error || "Apps Script error");
        return payload;
      })
      .catch(() => requestJsonp(action, params));
  }

  function requestJsonp(action, params) {
    return new Promise((resolve, reject) => {
      const callbackName = `twStockCallback_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      const query = new URLSearchParams(Object.assign({ action, callback: callbackName }, params || {}));
      const script = document.createElement("script");
      const timer = setTimeout(cleanup, config.requestTimeoutMs || 75000);

      window[callbackName] = (payload) => {
        cleanup();
        if (payload && payload.ok === false) reject(new Error(payload.error || "Apps Script error"));
        else resolve(payload);
      };

      script.src = `${config.endpoint}?${query.toString()}`;
      script.onerror = () => {
        cleanup();
        reject(new Error("JSONP request failed"));
      };
      document.head.appendChild(script);

      function cleanup() {
        clearTimeout(timer);
        delete window[callbackName];
        if (script.parentNode) script.parentNode.removeChild(script);
      }
    });
  }

  function fetchWithTimeout(url, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    return fetch(url, { signal: controller.signal, cache: "no-store" })
      .finally(() => clearTimeout(timer));
  }

  function normalizePayload(payload) {
    const source = payload && payload.data ? payload.data : payload;
    return mergePayload(source || {}, source || {});
  }

  function mergePayload(marketSource, simulationSource) {
    const market = marketSource.market || fallbackMarket.market || {};
    return {
      market,
      candidates: marketSource.candidates || simulationSource.candidates || fallbackMarket.candidates || [],
      asOf: simulationSource.asOf || marketSource.asOf || new Date().toISOString(),
      equity: numberOr(simulationSource.equity, fallbackSimulation.equity, config.initialCapital, 0),
      cash: numberOr(simulationSource.cash, fallbackSimulation.cash, config.initialCapital, 0),
      initialCapital: numberOr(simulationSource.initialCapital, config.initialCapital, fallbackSimulation.initialCapital, 100000),
      dailyPnl: numberOr(simulationSource.dailyPnl, fallbackSimulation.dailyPnl, 0),
      dailyReturnPct: numberOr(simulationSource.dailyReturnPct, fallbackSimulation.dailyReturnPct, 0),
      monthlyTargetMinPct: numberOr(simulationSource.monthlyTargetMinPct, fallbackSimulation.monthlyTargetMinPct, .03),
      monthlyTargetMaxPct: numberOr(simulationSource.monthlyTargetMaxPct, fallbackSimulation.monthlyTargetMaxPct, .05),
      tradeSignature: simulationSource.tradeSignature || marketSource.tradeSignature || fallbackSimulation.tradeSignature || "",
      risk: simulationSource.risk || fallbackSimulation.risk || {},
      positions: simulationSource.positions || [],
      trades: simulationSource.trades || [],
      reports: simulationSource.reports || fallbackSimulation.reports || {}
    };
  }

  function render(data) {
    const initial = numberOr(data.initialCapital, 100000);
    els.lastUpdated.textContent = formatDateTime(data.asOf);
    els.tradeSignature.textContent = data.tradeSignature || "--";
    const positions = data.positions || [];
    const positionCosts = summarizePositionCosts(positions);
    const adjustedCash = Number(data.cash || 0) - positionCosts.buyFees;
    const adjustedEquity = adjustedCash + positionCosts.netMarketValue;
    const adjustedDailyPnl = adjustedEquity - initial;
    const totalReturn = initial ? adjustedDailyPnl / initial : 0;
    els.equity.textContent = money(adjustedEquity);
    els.cash.textContent = money(adjustedCash);
    els.cashChange.textContent = signedMoney(-positionCosts.buyFees);
    els.cashChange.className = positionCosts.buyFees > 0 ? "bad" : "good";
    const stockValue = positionCosts.marketValue;
    const unrealizedPnl = positionCosts.pnl;
    els.marketValue.textContent = money(stockValue);
    els.unrealizedPnl.textContent = signedMoney(unrealizedPnl);
    els.unrealizedPnl.className = unrealizedPnl >= 0 ? "good" : "bad";
    els.stockValue.textContent = money(stockValue);
    els.stockChange.textContent = signedMoney(unrealizedPnl);
    els.stockChange.className = unrealizedPnl >= 0 ? "good" : "bad";
    els.accountChange.textContent = signedMoney(adjustedDailyPnl);
    els.accountChange.className = adjustedDailyPnl >= 0 ? "good" : "bad";
    els.dailyPnl.textContent = signedMoney(adjustedDailyPnl);
    els.dailyPnl.className = adjustedDailyPnl >= 0 ? "good" : "bad";
    els.returnLine.textContent = `累計 ${pct(totalReturn)}`;
    els.cashReserve.textContent = `現金水位 ${pct((data.risk || {}).cashReservePct || adjustedCash / Math.max(adjustedEquity, 1))}`;
    els.targetLine.textContent = `月目標 ${pct(data.monthlyTargetMinPct)} - ${pct(data.monthlyTargetMaxPct)}`;
    els.riskMessage.textContent = (data.risk || {}).message || "等待下一筆有效訊號。";
    renderMarket(data.market || {});
    renderCandidates(data.candidates || []);
    renderPositions(positions, data);
    renderTrades(data.trades || []);
    renderHistory(data.trades || []);
    els.weeklyReport.textContent = (data.reports || {}).weekly || "尚無週檢討資料。";
    els.thirtyDayReport.textContent = (data.reports || {}).thirtyDay || "尚無 30 日檢討資料。";
  }

  function renderMarket(market) {
    els.marketSummary.textContent = `${market.date || "--"}，${market.indexName || "TAIEX"} 收 ${numberText(market.indexClose)}，大盤 ${pct(market.indexChangePct / 100)}。策略以大盤與風控優先，未達條件不操作。`;
    const items = [
      ["台股", market.indexChangePct],
      ["台指期", market.futuresChangePct],
      ["NASDAQ", market.nasdaqChangePct],
      ["費半", market.soxChangePct]
    ];
    els.marketBars.innerHTML = items.map(([label, value]) => {
      const n = Number(value || 0);
      const width = Math.min(100, Math.max(4, Math.abs(n) * 18 + 8));
      const color = n >= 0 ? "var(--good)" : "var(--bad)";
      return `<div class="bar-row"><span>${escapeHtml(label)}</span><div class="bar-track"><div class="bar-fill" style="--w:${width}%;--c:${color}"></div></div><strong class="${n >= 0 ? "good" : "bad"}">${pct(n / 100)}</strong></div>`;
    }).join("");
  }

  function renderCandidates(rows) {
    els.candidateCount.textContent = `${rows.length} 檔候選股`;
    els.candidatesBody.innerHTML = rows.length ? rows.map((row) => `
      <tr>
        <td><button class="row-caret" type="button" title="展開">›</button><strong class="ticker">${escapeHtml(row.symbol)}</strong><br><span>${escapeHtml(row.name)}</span></td>
        <td>${escapeHtml(row.group || "--")}</td>
        <td><span class="grade grade-${String(row.grade || "c").toLowerCase()}">${escapeHtml(row.grade || "-")}</span></td>
        <td>${numberText(row.price)}</td>
        <td class="${Number(row.changePct) >= 0 ? "good" : "bad"}">${pct(Number(row.changePct || 0) / 100)}</td>
        <td>${numberText(row.score)}</td>
        <td>${escapeHtml(row.reason || "等待更多資料")}</td>
      </tr>
    `).join("") : emptyRow(7, "目前沒有符合條件的候選股。");
  }

  function renderPositions(rows, data) {
    const costs = summarizePositionCosts(rows);
    els.holdingsSummary.textContent = `總值 ${money(costs.marketValue)}　預估費稅 ${money(costs.totalFeesAndTax)}　總益損 ${signedMoney(costs.pnl)}`;
    els.positionsBody.innerHTML = rows.length ? rows.map((row) => {
      const cost = positionCost(row);
      return `
      <tr>
        <td><button class="row-caret" type="button" title="展開">›</button><strong class="ticker">${escapeHtml(row.symbol)}</strong><br><span>${escapeHtml(row.name)}</span></td>
        <td>${numberText(row.shares)}</td>
        <td>${sparkline(row)}</td>
        <td>${numberText(row.lastPrice)}</td>
        <td class="${Number(row.change || row.changePct || 0) >= 0 ? "good" : "bad"}">${signedNumber(row.change || 0)}</td>
        <td class="${Number(row.changePct || 0) >= 0 ? "good" : "bad"}">${pct(Number(row.changePct || 0))}</td>
        <td>${money(cost.marketValue)}</td>
        <td>${numberText(cost.unitCost)}</td>
        <td>${money(cost.costBasis)}</td>
        <td class="${cost.pnl >= 0 ? "good" : "bad"}">${signedMoney(cost.pnl)}</td>
        <td class="${cost.pnlPct >= 0 ? "good" : "bad"}">${pct(cost.pnlPct)}</td>
      </tr>
    `;
    }).join("") : emptyRow(11, "目前沒有持倉，策略維持現金水位。");
  }

  function renderTrades(rows) {
    els.tradeCount.textContent = rows.length;
    els.tradesBody.innerHTML = rows.length ? rows.map((row) => {
      const cost = tradeCost(row);
      return `
      <tr>
        <td>${escapeHtml(row.time || "--")}</td>
        <td>${tradeAction(row.action)}</td>
        <td>${numberText(row.shares)}</td>
        <td><strong class="ticker">${escapeHtml(row.symbol || "--")}</strong></td>
        <td>${escapeHtml(row.orderType || "限價")}</td>
        <td>${numberText(row.price)}</td>
        <td>當日有效</td>
        <td>${feeBreakdown(cost)}</td>
        <td class="bad">已成交 @ ${numberText(row.price)}</td>
      </tr>
    `;
    }).join("") : emptyRow(9, "尚無交易紀錄。");
  }

  function renderHistory(rows) {
    if (!els.historyBody) return;
    if (!rows.length) {
      els.historyBody.innerHTML = emptyRow(9, "尚無歷史交易紀錄。");
      return;
    }
    const ordered = [...rows].sort((a, b) => parseDate(b.time) - parseDate(a.time));
    let currentMonth = "";
    els.historyBody.innerHTML = ordered.map((row) => {
      const date = parseDate(row.time);
      const month = monthLabel(date, row.time);
      const cost = tradeCost(row);
      const divider = month !== currentMonth
        ? `<tr class="month-row"><td colspan="9">${escapeHtml(month)}</td></tr>`
        : "";
      currentMonth = month;
      return `${divider}
        <tr>
          <td>${escapeHtml(formatTradeTime(row.time))}</td>
          <td>${tradeAction(row.action)}</td>
          <td><strong class="ticker">${escapeHtml(row.symbol || "--")}</strong></td>
          <td>${numberText(row.shares)}</td>
          <td>${numberText(row.price)}</td>
          <td>${money(cost.grossAmount)}</td>
          <td>${feeBreakdown(cost)}</td>
          <td class="${cost.pnl >= 0 ? "good" : "bad"}">${signedMoney(cost.pnl)}</td>
          <td>${escapeHtml(row.status || `已成交 @ ${numberText(row.price)}`)}</td>
        </tr>`;
    }).join("");
  }

  function toggleHistory() {
    const isHidden = els.historyPanel.hasAttribute("hidden");
    if (isHidden) {
      els.historyPanel.removeAttribute("hidden");
      els.historyButton.setAttribute("aria-expanded", "true");
      els.historyButton.textContent = "隱藏歷史交易";
    } else {
      els.historyPanel.setAttribute("hidden", "");
      els.historyButton.setAttribute("aria-expanded", "false");
      els.historyButton.textContent = "歷史交易紀錄";
    }
  }

  function setLoading(isLoading) {
    els.refreshButton.disabled = isLoading;
    els.refreshButton.textContent = isLoading ? "↻" : "⟳";
  }

  function byId(id) {
    return document.getElementById(id);
  }

  function numberOr(...values) {
    for (const value of values) {
      const n = Number(value);
      if (Number.isFinite(n)) return n;
    }
    return 0;
  }

  function summarizePositionCosts(rows) {
    return rows.reduce((summary, row) => {
      const cost = positionCost(row);
      summary.marketValue += cost.marketValue;
      summary.netMarketValue += cost.netMarketValue;
      summary.costBasis += cost.costBasis;
      summary.buyFees += cost.buyFee;
      summary.totalFeesAndTax += cost.buyFee + cost.sellFee + cost.sellTax;
      summary.pnl += cost.pnl;
      return summary;
    }, { marketValue: 0, netMarketValue: 0, costBasis: 0, buyFees: 0, totalFeesAndTax: 0, pnl: 0 });
  }

  function positionCost(row) {
    const shares = Number(row.shares || 0);
    const avgPrice = Number(row.avgPrice || row.price || 0);
    const lastPrice = Number(row.lastPrice || row.price || avgPrice || 0);
    const buyGross = shares * avgPrice;
    const marketValue = numberOr(row.marketValue, shares * lastPrice);
    const buyFee = commission(buyGross);
    const sellFee = commission(marketValue);
    const sellTax = stockTransactionTax(marketValue);
    const costBasis = buyGross + buyFee;
    const netMarketValue = marketValue - sellFee - sellTax;
    const pnl = netMarketValue - costBasis;
    return {
      marketValue,
      netMarketValue,
      buyFee,
      sellFee,
      sellTax,
      costBasis,
      unitCost: shares ? costBasis / shares : 0,
      pnl,
      pnlPct: costBasis ? pnl / costBasis : 0
    };
  }

  function tradeCost(row) {
    const grossAmount = Number(row.shares || 0) * Number(row.price || 0);
    const action = String(row.action || "").toUpperCase();
    const feeInfo = commissionInfo(grossAmount);
    const fee = feeInfo.amount;
    const tax = action === "SELL" ? stockTransactionTax(grossAmount) : 0;
    const explicitPnl = Number(row.pnl ?? row.realizedPnl);
    const pnl = Number.isFinite(explicitPnl) && action === "SELL"
      ? explicitPnl - fee - tax
      : -(fee + tax);
    return { grossAmount, fee, tax, totalFeeAndTax: fee + tax, pnl, feeReason: feeInfo.reason };
  }

  function commission(amount) {
    return commissionInfo(amount).amount;
  }

  function commissionInfo(amount) {
    const gross = Math.abs(Number(amount || 0));
    if (!gross) return { amount: 0, rawFee: 0, reason: "無成交金額" };
    const rawFee = gross * feeConfig.commissionRate;
    const roundedFee = Math.round(rawFee);
    const amountDue = Math.max(feeConfig.minimumCommission, roundedFee);
    const reason = amountDue === feeConfig.minimumCommission
      ? `成交金額 ${money(gross)} × 0.1425% = ${money(rawFee)}，低於最低手續費 ${money(feeConfig.minimumCommission)}，所以以 ${money(feeConfig.minimumCommission)} 計`
      : `成交金額 ${money(gross)} × 0.1425% = ${money(rawFee)}，四捨五入為 ${money(amountDue)}`;
    return { amount: amountDue, rawFee, reason };
  }

  function stockTransactionTax(amount) {
    const gross = Math.abs(Number(amount || 0));
    return gross ? Math.round(gross * feeConfig.stockTransactionTaxRate) : 0;
  }

  function feeBreakdown(cost) {
    const taxLine = cost.tax
      ? `<small>證交稅 ${money(cost.tax)}，賣出成交金額 × 0.3%</small>`
      : "";
    return `<strong>費稅 ${money(cost.totalFeeAndTax)}</strong><small>${escapeHtml(cost.feeReason)}</small>${taxLine}`;
  }

  function money(value) {
    return Number(value || 0).toLocaleString("zh-TW", { style: "currency", currency: "TWD", maximumFractionDigits: 0 });
  }

  function signedMoney(value) {
    const n = Number(value || 0);
    return `${n >= 0 ? "+" : ""}${money(n)}`;
  }

  function signedNumber(value) {
    const n = Number(value || 0);
    return `${n >= 0 ? "+" : ""}${numberText(n)}`;
  }

  function pct(value) {
    return `${(Number(value || 0) * 100).toFixed(2)}%`;
  }

  function tradeAction(action) {
    const value = String(action || "").toUpperCase();
    if (value === "BUY") return "買進";
    if (value === "SELL") return "賣出";
    return escapeHtml(action || "--");
  }

  function sparkline(row) {
    const seed = String(row.symbol || "0000").split("").reduce((sum, char) => sum + char.charCodeAt(0), 0);
    const points = Array.from({ length: 8 }, (_, index) => {
      const wave = Math.sin((seed + index * 19) / 8) * 8;
      const drift = Number(row.changePct || row.pnlPct || 0) * index * 7;
      const y = Math.max(6, Math.min(30, 20 - wave - drift));
      return `${index * 16},${y.toFixed(1)}`;
    }).join(" ");
    return `<svg class="spark" viewBox="0 0 112 36" aria-hidden="true"><polyline points="${points}"></polyline></svg>`;
  }

  function numberText(value) {
    const n = Number(value);
    return Number.isFinite(n) ? n.toLocaleString("zh-TW", { maximumFractionDigits: 2 }) : "--";
  }

  function formatDateTime(value) {
    const date = value ? new Date(value) : new Date();
    if (Number.isNaN(date.getTime())) return String(value || "--");
    return date.toLocaleString("zh-TW", { hour12: false });
  }

  function parseDate(value) {
    const date = value ? new Date(value) : new Date(0);
    return Number.isNaN(date.getTime()) ? new Date(0) : date;
  }

  function monthLabel(date, fallback) {
    if (!date || date.getTime() === 0) {
      const text = String(fallback || "");
      const match = text.match(/(\d{4})[-/](\d{1,2})/);
      return match ? `${match[1]}-${match[2].padStart(2, "0")}` : "未分類月份";
    }
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  }

  function formatTradeTime(value) {
    const date = parseDate(value);
    if (date.getTime() === 0) return String(value || "--");
    return date.toLocaleString("zh-TW", { hour12: false, month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      "\"": "&quot;",
      "'": "&#039;"
    })[char]);
  }

  function emptyRow(colspan, text) {
    return `<tr><td colspan="${colspan}">${escapeHtml(text)}</td></tr>`;
  }
})();
