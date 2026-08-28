'use strict';

const DEFAULT_REPOSITORY = 'wushinhuei/tw-stock-bot';
const DEFAULT_WORKFLOW = 'update-static-dashboard.yml';
const DEFAULT_REF = 'main';

let lastDispatchAt = 0;
let inFlightDispatch = null;

function envFlag(name) {
  return ['1', 'true', 'yes', 'on'].includes(String(process.env[name] || '').toLowerCase());
}

function staticBackupConfig() {
  return {
    enabled: envFlag('STATIC_BACKUP_ON_TRADE') || Boolean(process.env.GITHUB_STATIC_BACKUP_TOKEN),
    token: process.env.GITHUB_STATIC_BACKUP_TOKEN || '',
    repository: process.env.GITHUB_STATIC_BACKUP_REPOSITORY || DEFAULT_REPOSITORY,
    workflow: process.env.GITHUB_STATIC_BACKUP_WORKFLOW || DEFAULT_WORKFLOW,
    ref: process.env.GITHUB_STATIC_BACKUP_REF || DEFAULT_REF,
    cooldownMs: Math.max(0, Number(process.env.STATIC_BACKUP_COOLDOWN_MS || 120000)),
  };
}

function summarizeTrades(trades) {
  return trades.map(trade => `${trade.tradeDate || ''} ${trade.side || ''} ${trade.symbol || ''} x${trade.filledQuantity || ''}`).join('; ');
}

async function dispatchStaticBackupUpdate(trades, options = {}) {
  const config = { ...staticBackupConfig(), ...options };
  const filledTrades = Array.isArray(trades) ? trades : [];

  if (!filledTrades.length) return { dispatched: false, reason: 'NO_NEW_TRADES' };
  if (!config.enabled) return { dispatched: false, reason: 'STATIC_BACKUP_ON_TRADE_DISABLED' };
  if (!config.token) return { dispatched: false, reason: 'GITHUB_STATIC_BACKUP_TOKEN_MISSING' };

  const now = Date.now();
  if (config.cooldownMs && now - lastDispatchAt < config.cooldownMs) {
    return { dispatched: false, reason: 'COOLDOWN_ACTIVE' };
  }
  if (inFlightDispatch) return inFlightDispatch;

  const [owner, repo] = config.repository.split('/');
  if (!owner || !repo) throw new Error(`Invalid GITHUB_STATIC_BACKUP_REPOSITORY: ${config.repository}`);

  const url = `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${encodeURIComponent(config.workflow)}/dispatches`;
  const body = {
    ref: config.ref,
    inputs: {
      source: 'cloud-simulator-trade',
      reason: summarizeTrades(filledTrades).slice(0, 200),
    },
  };

  inFlightDispatch = fetch(url, {
    method: 'POST',
    headers: {
      accept: 'application/vnd.github+json',
      authorization: `Bearer ${config.token}`,
      'content-type': 'application/json',
      'x-github-api-version': '2022-11-28',
      'user-agent': 'tw-stock-cloud-simulator',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  }).then(async response => {
    const text = await response.text();
    if (!response.ok) {
      throw new Error(`GitHub workflow dispatch failed: HTTP ${response.status} ${text.slice(0, 240)}`);
    }
    lastDispatchAt = Date.now();
    return { dispatched: true, status: response.status, workflow: config.workflow, ref: config.ref };
  }).finally(() => {
    inFlightDispatch = null;
  });

  return inFlightDispatch;
}

async function triggerStaticBackupOnTrades(newTrades) {
  try {
    const result = await dispatchStaticBackupUpdate(newTrades);
    console.log(JSON.stringify({ event: 'static-backup-dispatch', ...result }));
    return result;
  } catch (error) {
    console.warn(JSON.stringify({ event: 'static-backup-dispatch-error', error: String(error.message || error) }));
    return { dispatched: false, reason: 'DISPATCH_ERROR', error: String(error.message || error) };
  }
}

module.exports = { dispatchStaticBackupUpdate, staticBackupConfig, triggerStaticBackupOnTrades };
