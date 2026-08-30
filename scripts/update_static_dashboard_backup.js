'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT_DIR = path.resolve(__dirname, '..');
const WEB_DIR = path.join(ROOT_DIR, '台股策略系統', 'web');
const ACTUAL_DATA_FILE = path.join(WEB_DIR, 'actual_data.js');
const SIMULATION_FILE = path.join(WEB_DIR, 'simulation_result.js');

const CLOUD_DASHBOARD_ENDPOINT = process.env.CLOUD_DASHBOARD_ENDPOINT
  || 'https://tw-stock-dashboard-api-702657072551.asia-east1.run.app/dashboard';
const APPS_SCRIPT_ENDPOINT = process.env.APPS_SCRIPT_ENDPOINT
  || 'https://script.google.com/macros/s/AKfycbxMSe1WvXNjTbAzxZSP8mD_9wt11BIGQSyaFTktoet_v7WQ1KujUu19pflwS6zHfhqt/exec';

function addParams(baseUrl, params) {
  const url = new URL(baseUrl);
  Object.entries(params).forEach(([key, value]) => {
    if (value !== undefined && value !== null) {
      url.searchParams.set(key, String(value));
    }
  });
  return url.toString();
}

function appsScriptUrl(action, extraParams = {}) {
  return addParams(APPS_SCRIPT_ENDPOINT, { action, ...extraParams });
}

async function fetchJson(label, url) {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
    signal: AbortSignal.timeout(120000),
  });

  const text = await response.text();
  if (!response.ok) {
    throw new Error(`${label} returned HTTP ${response.status}: ${text.slice(0, 240)}`);
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} did not return JSON: ${text.slice(0, 240)}`);
  }
}

function normalizePayload(payload, sourceLabel) {
  const scenario = payload.scenario || payload.actualScenario || payload.data?.scenario;
  const simulation = payload.simulation || payload.precomputedSimulation || payload.data?.simulation;

  if (!Array.isArray(scenario) || scenario.length === 0) {
    throw new Error(`${sourceLabel} payload has no scenario array`);
  }
  if (!simulation || typeof simulation !== 'object' || Array.isArray(simulation)) {
    throw new Error(`${sourceLabel} payload has no simulation object`);
  }

  const newestScenario = scenario[scenario.length - 1] || {};
  return {
    sourceLabel,
    scenario,
    simulation: {
      ...simulation,
      source: {
        ...(simulation.source || {}),
        staticBackupProvider: sourceLabel,
        staticBackupUpdatedAt: new Date().toISOString(),
        newestScenarioDate: newestScenario.date || null,
      },
    },
  };
}

async function loadLatestDashboard() {
  const cacheBust = Date.now();
  const attempts = [
    {
      label: 'cloud-dashboard',
      url: addParams(CLOUD_DASHBOARD_ENDPOINT, { t: cacheBust }),
    },
    {
      label: 'apps-script-refresh',
      url: appsScriptUrl('refresh', { force: 1, t: cacheBust }),
    },
    {
      label: 'apps-script-read',
      url: appsScriptUrl('read', { t: cacheBust }),
    },
  ];

  const errors = [];
  for (const attempt of attempts) {
    try {
      const payload = await fetchJson(attempt.label, attempt.url);
      return normalizePayload(payload, attempt.label);
    } catch (error) {
      errors.push(`${attempt.label}: ${error.message}`);
    }
  }

  throw new Error(`Unable to update static dashboard backup. Attempts failed:\n${errors.join('\n')}`);
}

function writeWindowAssignment(filePath, globalName, value) {
  const content = `window.${globalName} = ${JSON.stringify(value, null, 2)};\n`;
  fs.writeFileSync(filePath, content, 'utf8');
}

async function main() {
  const latest = await loadLatestDashboard();
  writeWindowAssignment(ACTUAL_DATA_FILE, 'ACTUAL_SCENARIO', latest.scenario);
  writeWindowAssignment(SIMULATION_FILE, 'PRECOMPUTED_SIMULATION', latest.simulation);

  const newestScenario = latest.scenario[latest.scenario.length - 1] || {};
  console.log(JSON.stringify({
    event: 'static-dashboard-backup-updated',
    source: latest.sourceLabel,
    newestScenarioDate: newestScenario.date || null,
    scenarioCount: latest.scenario.length,
    tradeCount: Array.isArray(latest.simulation.trades) ? latest.simulation.trades.length : null,
  }, null, 2));
}

main().catch((error) => {
  console.error(error.stack || error.message);
  process.exit(1);
});
