window.APPS_SCRIPT_ENDPOINT = 'https://script.google.com/macros/s/AKfycbxMSe1WvXNjTbAzxZSP8mD_9wt11BIGQSyaFTktoet_v7WQ1KujUu19pflwS6zHfhqt/exec';
window.CLOUD_DASHBOARD_ENDPOINT = 'https://tw-stock-dashboard-api-702657072551.asia-east1.run.app/dashboard';

(function installHistoryTradeDomSortFix() {
  function rowDateTimeKey(row) { const cell=row?.cells?.[0]; if(!cell)return ''; const parts=String(cell.innerText||cell.textContent||'').trim().split(/\s+/).filter(Boolean); const date=parts.find(v=>/^\d{4}-\d{2}-\d{2}$/.test(v))||''; const time=parts.find(v=>/^\d{2}:\d{2}:\d{2}$/.test(v))||'00:00:00'; return date?`${date}T${time}`:''; }
  function sortHistoryRows(tbody) { if(!tbody)return; const rows=Array.from(tbody.querySelectorAll(':scope > tr')); if(rows.length<2)return; const sorted=rows.slice().sort((a,b)=>rowDateTimeKey(b).localeCompare(rowDateTimeKey(a))); const changed=sorted.some((row,index)=>row!==rows[index]); if(!changed)return; observer.disconnect(); sorted.forEach(row=>tbody.appendChild(row)); observer.observe(tbody,{childList:true}); }
  let activeTbody=null; const observer=new MutationObserver(()=>{if(activeTbody)sortHistoryRows(activeTbody);});
  function attach(){const tbody=document.querySelector('#historyTradeRows');if(!tbody)return false;if(activeTbody!==tbody){observer.disconnect();activeTbody=tbody;observer.observe(tbody,{childList:true});}sortHistoryRows(tbody);return true;} attach(); window.addEventListener('load',attach);
})();

(function installHoldingMonitorLookup() {
  window.addEventListener('load',()=>{const originalFindCandidate=window.findCandidate;if(typeof originalFindCandidate!=='function'||originalFindCandidate.__holdingMonitorAware)return;function holdingMonitorAwareFindCandidate(day,symbol){const candidate=originalFindCandidate(day,symbol);if(candidate)return candidate;const code=String(symbol||'').replace(/\.TW$/i,'');const monitors=Array.isArray(day?.positionMonitors)?day.positionMonitors:[];return monitors.find(item=>String(item?.symbol||'').replace(/\.TW$/i,'')===code)||null;}holdingMonitorAwareFindCandidate.__holdingMonitorAware=true;window.findCandidate=holdingMonitorAwareFindCandidate;});
})();

(function installCandidateWatchlistCopy() {
  function applyCopy(){const summary=document.querySelector('#candidateUniverseSummary');if(summary)summary.textContent='先由 TWSE 上市普通股依流動性建立 Top100 可交易母池，再以籌碼30%、技術30%、基本面25%、新聞／事件15%做綜合排序；每小時重新排序一次並顯示前30檔。此名單僅供觀察，不代表要進行任何買賣操作。';const panel=document.querySelector('#candidateUniverse')?.closest('.scanner-panel');const title=panel?.querySelector('h2');if(title)title.textContent='今日觀察候選30檔';}applyCopy();window.addEventListener('load',applyCopy);
})();

// 全系統資料健康狀態：行情、Top100、法人/融資、MOPS、20季、新聞與潛力股都必須通過。
(function installGlobalDataHealth() {
  function endpoint(){return String(window.CLOUD_DASHBOARD_ENDPOINT||'').replace(/\/dashboard\/?$/i,'/data-health');}
  function mount(){let node=document.querySelector('#globalDataHealth');if(node)return node;const anchor=document.querySelector('#lastUpdatedAt')||document.querySelector('.top-actions');if(!anchor)return null;node=document.createElement('div');node.id='globalDataHealth';node.style.cssText='grid-column:1/-1;font-size:12px;line-height:1.5;padding:6px 9px;border-radius:7px;background:#f3f6f9;color:#526174;';if(anchor.id==='lastUpdatedAt')anchor.insertAdjacentElement('afterend',node);else anchor.appendChild(node);return node;}
  async function refresh(){const node=mount();if(!node)return;node.textContent='全系統資料：檢查中…';try{const response=await fetch(`${endpoint()}?t=${Date.now()}`,{cache:'no-store'});const data=await response.json();const complete=data?.ok===true&&data?.status==='COMPLETE';const failed=Array.isArray(data?.failedChecks)&&data.failedChecks.length?`；異常：${data.failedChecks.join('、')}`:'';node.textContent=complete?`全系統資料：✅ 完整｜最後完整交易日 ${data.latestCompleteTradeDate||'-'}｜每日完整性檢查已通過`:`全系統資料：⚠️ ${data?.status||'UNKNOWN'}｜最後完整交易日 ${data?.latestCompleteTradeDate||'-'}${failed}｜未通過時禁止以不完整資料新增交易`;node.style.background=complete?'#eef8f2':'#fff4e5';node.style.color=complete?'#17633d':'#8a5500';}catch(error){node.textContent='全系統資料：⚠️ 無法取得完整性檢查結果；視為未通過。';node.style.background='#fff4e5';node.style.color='#8a5500';}}
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',refresh,{once:true});else refresh();window.addEventListener('load',refresh);setInterval(refresh,5*60*1000);
})();

// 潛力股 Top10：獨立中長期研究線，不受交易 Top100 限制。
(function loadPotentialStocksUi() {
  function installSummary(){const button=document.querySelector('#openPotentialStocksButton');if(!button||document.querySelector('#potentialTop10Summary'))return false;const note=document.createElement('div');note.id='potentialTop10Summary';note.className='potential-top10-summary';note.textContent='選股：基本面50＋已求證新聞事件25＋法人資金25；70分進、65分出，新股連續2週達標，原則每月換榜一次，重大風險立即排除。中長期6–24個月觀察，不受交易Top100限制。';note.style.cssText='grid-column:1/-1;font-size:12px;line-height:1.55;color:#657487;padding:2px 4px 6px;';button.insertAdjacentElement('afterend',note);return true;}
  const load=()=>{if(document.querySelector('script[data-potential-stocks-ui]')){installSummary();return;}const script=document.createElement('script');script.src=`potential_stocks_ui.js?v=${Date.now()}`;script.async=false;script.dataset.potentialStocksUi='1';script.addEventListener('load',()=>{installSummary();setTimeout(installSummary,100);});document.body.appendChild(script);};
  if(document.readyState==='loading')document.addEventListener('DOMContentLoaded',load,{once:true});else load();window.addEventListener('load',()=>setTimeout(installSummary,150));
})();
