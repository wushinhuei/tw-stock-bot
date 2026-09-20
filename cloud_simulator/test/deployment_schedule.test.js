'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');

const cloudbuild = fs.readFileSync(path.resolve(__dirname, '..', '..', 'cloudbuild.yaml'), 'utf8');

test('Cloud Build keeps intraday simulation and daily data sync schedulers enabled', () => {
  const required = [
    "upsert_scheduler tw-stock-weekday '*/5 8-13 * * 1-5'",
    'upsert_scheduler tw-stock-twse-drive-sync-after-close',
    'upsert_scheduler tw-stock-mops-drive-sync-evening',
    'upsert_scheduler tw-stock-mcp-daily-sync-evening',
    'upsert_scheduler tw-stock-data-health-evening',
  ];
  required.forEach(value => assert.match(cloudbuild, new RegExp(value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))));

  assert.doesNotMatch(cloudbuild, /scheduler jobs pause tw-stock-twse-drive-sync-after-close/);
  assert.doesNotMatch(cloudbuild, /scheduler jobs pause tw-stock-mops-drive-sync-evening/);
  assert.doesNotMatch(cloudbuild, /scheduler jobs pause tw-stock-mcp-daily-sync-evening/);
});
