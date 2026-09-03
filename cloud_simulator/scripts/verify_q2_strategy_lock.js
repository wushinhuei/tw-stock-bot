'use strict';

const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');

const LOCK_PATH = path.resolve(process.env.Q2_STRATEGY_LOCK || 'cloud_simulator/config/q2_frozen_strategy_lock.json');

function gitBlobSha1(buffer) {
  const header = Buffer.from(`blob ${buffer.length}\0`);
  return crypto.createHash('sha1').update(Buffer.concat([header, buffer])).digest('hex');
}

function verify(root = process.cwd()) {
  const lock = JSON.parse(fs.readFileSync(LOCK_PATH, 'utf8'));
  const checks = Object.entries(lock.gitBlobSha1 || {}).map(([relative, expected]) => {
    const absolute = path.resolve(root, relative);
    if (!fs.existsSync(absolute)) return { path: relative, expected, actual: null, passed: false, reason: 'MISSING_FILE' };
    const actual = gitBlobSha1(fs.readFileSync(absolute));
    return { path: relative, expected, actual, passed: actual === expected };
  });
  const passed = checks.every(row => row.passed);
  return {
    generatedAt: new Date().toISOString(),
    period: lock.period,
    lockedAtCommit: lock.lockedAtCommit,
    policy: lock.policy,
    passed,
    changedFiles: checks.filter(row => !row.passed),
    checks
  };
}

function main() {
  const report = verify();
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 2;
}

if (require.main === module) main();

module.exports = { gitBlobSha1, verify };
