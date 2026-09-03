'use strict';

const http = require('node:http');

function storageJsonReader(bucketName, objectName) {
  if (!bucketName) throw new Error('GCS_BUCKET is required for dashboard API');
  const { Storage } = require('@google-cloud/storage');
  const file = new Storage().bucket(bucketName).file(objectName);
  return async function readJson() {
    const [contents] = await file.download();
    return JSON.parse(contents.toString('utf8'));
  };
}

function storageDashboardReader(bucketName) { return storageJsonReader(bucketName, 'public/dashboard.json'); }
function storagePotentialStocksReader(bucketName) { return storageJsonReader(bucketName, 'public/growth_top10.json'); }
function storageDataHealthReader(bucketName) { return storageJsonReader(bucketName, 'public/data_health.json'); }

function json(response, status, payload) {
  response.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
    'X-Content-Type-Options': 'nosniff'
  });
  response.end(JSON.stringify(payload));
}

function deploymentMetadata() {
  return {
    deployCommitSha: String(process.env.DEPLOY_COMMIT_SHA || '').trim() || null,
    deploymentEnvironment: String(process.env.SIMULATION_ENV || '').trim() || null
  };
}

function createDashboardServer(options = {}) {
  const readDashboard = options.readDashboard || storageDashboardReader(process.env.GCS_BUCKET);
  const readPotentialStocks = options.readPotentialStocks || storagePotentialStocksReader(process.env.GCS_BUCKET);
  const readDataHealth = options.readDataHealth || storageDataHealthReader(process.env.GCS_BUCKET);
  return http.createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (request.method !== 'GET') return json(response, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
    if (path === '/health') return json(response, 200, { ok: true, service: 'tw-stock-dashboard-api', ...deploymentMetadata() });
    if (path === '/data-health') {
      try {
        const payload = await readDataHealth();
        return json(response, payload.ok ? 200 : 503, { ...payload, cloudApiAt: new Date().toISOString(), ...deploymentMetadata() });
      } catch (error) {
        console.warn(JSON.stringify({ event: 'data-health-not-ready', error: String(error) }));
        return json(response, 503, { ok: false, status: 'UNKNOWN', error: 'DATA_HEALTH_NOT_READY', ...deploymentMetadata() });
      }
    }
    if (path === '/potential-stocks') {
      try {
        const payload = await readPotentialStocks();
        return json(response, 200, { ok: true, ...payload, cloudApiAt: new Date().toISOString(), ...deploymentMetadata() });
      } catch (error) {
        console.warn(JSON.stringify({ event: 'potential-stocks-not-ready', error: String(error) }));
        return json(response, 503, { ok: false, error: 'POTENTIAL_STOCKS_NOT_READY', ...deploymentMetadata() });
      }
    }
    if (path !== '/' && path !== '/dashboard') return json(response, 404, { ok: false, error: 'NOT_FOUND' });
    try {
      const payload = await readDashboard();
      return json(response, 200, { ...payload, cloudApiAt: new Date().toISOString(), ...deploymentMetadata() });
    } catch (error) {
      console.warn(JSON.stringify({ event: 'dashboard-not-ready', error: String(error) }));
      return json(response, 503, { ok: false, error: 'DASHBOARD_NOT_READY', ...deploymentMetadata() });
    }
  });
}

function startDashboardApi() {
  const port = Number(process.env.PORT || 8080);
  const server = createDashboardServer();
  server.listen(port, '0.0.0.0', () => console.log(JSON.stringify({ event: 'api-ready', port, ...deploymentMetadata() })));
  return server;
}

module.exports = { createDashboardServer, deploymentMetadata, startDashboardApi, storageDashboardReader, storagePotentialStocksReader, storageDataHealthReader };
