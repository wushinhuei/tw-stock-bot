'use strict';

async function readDataHealth(bucketName, options = {}) {
  if (!bucketName) return { status: 'UNKNOWN', ok: false, reason: 'GCS_BUCKET_NOT_CONFIGURED' };
  const { Storage } = require('@google-cloud/storage');
  const storage = options.storage || new Storage();
  try {
    const [contents] = await storage.bucket(bucketName).file('public/data_health.json').download();
    return JSON.parse(contents.toString('utf8'));
  } catch (error) {
    return { status: 'UNKNOWN', ok: false, reason: 'DATA_HEALTH_NOT_READY', error: String(error) };
  }
}

function isDataHealthy(report) {
  return Boolean(report && report.ok === true && report.status === 'COMPLETE');
}

async function requireDataHealthy(bucketName, options = {}) {
  const report = await readDataHealth(bucketName, options);
  if (!isDataHealthy(report)) {
    const error = new Error(`global data quality gate blocked: ${report.status || 'UNKNOWN'}`);
    error.code = 'DATA_QUALITY_GATE_BLOCKED';
    error.report = report;
    throw error;
  }
  return report;
}

module.exports = { isDataHealthy, readDataHealth, requireDataHealthy };
