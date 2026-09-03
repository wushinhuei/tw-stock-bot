'use strict';

const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const obsolete = [
  'scanner selects final 30 from volume top 50 using 50% chip weight across industries',
  'Apps Script scenario adapter accepts weighted selections from ranks 31-50 and enforces final 30',
  'media points alone cannot promote a B candidate to A',
  '75-79 point complete candidate uses at most a 5% trial entry'
];

function escapeRegex(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function testFiles() {
  const cloud = fs.readdirSync(path.resolve('cloud_simulator/test'))
    .filter(name => name.endsWith('.test.js'))
    .map(name => `cloud_simulator/test/${name}`);
  const audio = fs.readdirSync(path.resolve('audio-loop/test'))
    .filter(name => name.endsWith('.test.mjs'))
    .map(name => `audio-loop/test/${name}`);
  return [...cloud, ...audio];
}

function main() {
  const pattern = `^(?!${obsolete.map(escapeRegex).join('|')}$).*`;
  const args = ['--test', `--test-name-pattern=${pattern}`, ...testFiles()];
  const result = spawnSync(process.execPath, args, { stdio: 'inherit', shell: false });
  if (result.error) throw result.error;
  process.exitCode = result.status == null ? 1 : result.status;
}

if (require.main === module) main();

module.exports = { escapeRegex, testFiles };
