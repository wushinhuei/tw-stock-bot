'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { GoogleRepository } = require('../cloud_simulator/src/repository');
const { SimulationEngine } = require('../cloud_simulator/src/engine');
const { repairZeroPriceSellState } = require('../cloud_simulator/src/state_repair');

function argument(name, fallback = null) {
  const prefix = `--${name}=`;
  const item = process.argv.find(value => value.startsWith(prefix));
  return item ? item.slice(prefix.length) : fallback;
}

function flag(name) {
  return process.argv.includes(`--${name}`);
}

function payloadAccount(payload) {
  if (payload && payload.account) return payload.account;
  if (payload && payload.data && payload.data.account) return payload.data.account;
  throw new Error('Input has no account object');
}

function summary(result) {
  return { mode: flag('apply') ? 'apply' : 'dry-run', ...result.audit };
}

async function dryRun() {
  const input = argument('input');
  if (!input) throw new Error('Dry-run requires --input=<dashboard-or-state.json>');
  const payload = JSON.parse(fs.readFileSync(path.resolve(input), 'utf8'));
  return repairZeroPriceSellState(payloadAccount(payload), { symbol: argument('symbol', '3037') });
}

async function applyRepair() {
  const confirmation = argument('confirm');
  if (confirmation !== 'REMOVE_ZERO_PRICE_SELL_3037') {
    throw new Error('Apply requires --confirm=REMOVE_ZERO_PRICE_SELL_3037');
  }
  const bucketName = argument('bucket') || process.env.GCS_BUCKET;
  const environment = argument('environment') || process.env.SIMULATION_ENV || 'staging';
  if (!bucketName) throw new Error('Apply requires --bucket=<GCS bucket> or GCS_BUCKET');

  const repository = new GoogleRepository({
    bucket: bucketName,
    environment,
    databaseId: argument('database-id') || process.env.FIRESTORE_DATABASE_ID || undefined,
  });
  const stored = await repository.loadState();
  const stateAccount = payloadAccount(stored);
  const [dashboardBytes] = await repository.bucket.file('public/dashboard.json').download();
  const dashboard = JSON.parse(dashboardBytes.toString('utf8'));
  const result = repairZeroPriceSellState(stateAccount, { symbol: argument('symbol', '3037') });

  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const backup = { createdAt: new Date().toISOString(), environment, bucketName, state: stored, dashboard };
  const backupName = `repair-backups/${timestamp}-zero-price-3037.json`;
  await repository.bucket.file(backupName).save(JSON.stringify(backup), {
    contentType: 'application/json',
    cacheControl: 'no-store',
  });

  await repository.saveState({ ...stored, account: result.account });
  const engine = new SimulationEngine({ account: result.account, repository });
  engine.news = Array.isArray(dashboard.internationalNews) ? dashboard.internationalNews : [];
  engine.taiwanMediaNews = Array.isArray(dashboard.taiwanMediaNews) ? dashboard.taiwanMediaNews : [];
  const repairedDashboard = engine.dashboard(Array.isArray(dashboard.candidates) ? dashboard.candidates : []);
  repairedDashboard.repair = { type: 'REMOVE_ZERO_PRICE_SELL', symbol: argument('symbol', '3037'), backupName };
  await repository.publishDashboard(repairedDashboard);
  return { ...result, audit: { ...result.audit, backupName } };
}

async function main() {
  const result = flag('apply') ? await applyRepair() : await dryRun();
  console.log(JSON.stringify(summary(result), null, 2));
}

if (require.main === module) main().catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});

module.exports = { payloadAccount };
