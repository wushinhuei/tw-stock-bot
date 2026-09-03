'use strict';

const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(process.env.REPO_ROOT || '.');
const POLICY = Object.freeze({
  primary: 'TWSE_MCP',
  driveCache: 'GOOGLE_DRIVE',
  allowedFallbackFiles: new Set([
    'cloud_simulator/src/yahoo.js',
    'cloud_simulator/scripts/download_yahoo_supplement.js',
    'cloud_simulator/scripts/download_shioaji_q2_intraday.py'
  ])
});

function walk(dir, output = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['.git', 'node_modules', 'data', 'tmp', 'dist'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, output);
    else if (/\.(?:js|mjs|py)$/.test(entry.name)) output.push(full);
  }
  return output;
}

function relative(file) { return path.relative(ROOT, file).replaceAll('\\', '/'); }

function main() {
  const violations = [];
  const fallbackReferences = [];
  for (const file of walk(ROOT)) {
    const rel = relative(file);
    const text = fs.readFileSync(file, 'utf8');
    const nonTwse = /query1\.finance\.yahoo\.com|query2\.finance\.yahoo\.com|yahoo\.com|shioaji|finmind/i.test(text);
    if (!nonTwse) continue;
    fallbackReferences.push(rel);
    if (!POLICY.allowedFallbackFiles.has(rel) && !/fallback|supplement|TWSE.*no.*data|無資料/i.test(text)) {
      violations.push({ file: rel, reason: 'non-TWSE provider reference is not explicitly marked as fallback/supplement' });
    }
  }
  const report = {
    generatedAt: new Date().toISOString(),
    primary: POLICY.primary,
    driveCache: POLICY.driveCache,
    fallbackRule: 'Other providers may be used only when TWSE MCP has no usable dataset/value.',
    fallbackReferences,
    violations,
    passed: violations.length === 0
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 2;
}

if (require.main === module) main();
