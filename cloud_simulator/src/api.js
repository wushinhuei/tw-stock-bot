'use strict';

const http = require('node:http');

function storageDashboardReader(bucketName) {
  if (!bucketName) throw new Error('GCS_BUCKET is required for dashboard API');
  const { Storage } = require('@google-cloud/storage');
  const file = new Storage().bucket(bucketName).file('public/dashboard.json');
  return async function readDashboard() {
    const [contents] = await file.download();
    return JSON.parse(contents.toString('utf8'));
  };
}

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
  return http.createServer(async (request, response) => {
    const path = new URL(request.url, 'http://localhost').pathname;
    if (request.method !== 'GET') return json(response, 405, { ok: false, error: 'METHOD_NOT_ALLOWED' });
    if (path === '/health') return json(response, 200, { ok: true, service: 'tw-stock-dashboard-api', ...deploymentMetadata() });
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

module.exports = { createDashboardServer, deploymentMetadata, startDashboardApi, storageDashboardReader };
