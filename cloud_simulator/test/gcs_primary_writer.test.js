'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { DrivePrimaryWriter } = require('../src/drive_primary_writer');
const { latestDateOf } = require('../scripts/check_all_data_health');

function memoryStorage() {
  const objects = new Map();
  return {
    objects,
    bucket(bucketName) {
      return {
        file(objectName) {
          return {
            async save(text, options) { objects.set(`${bucketName}/${objectName}`, { text, options }); },
            async download() {
              const entry = objects.get(`${bucketName}/${objectName}`);
              if (!entry) throw new Error('missing object');
              return [Buffer.from(entry.text, 'utf8')];
            }
          };
        }
      };
    }
  };
}

test('Cloud Run persistence uses GCS without attempting consumer Drive writes', async () => {
  const storage = memoryStorage();
  const writer = new DrivePrimaryWriter({
    bucketName: 'test-bucket',
    folderName: 'MCP_DAILY_SYNC_AUDIT',
    storage,
    fetchImpl: async () => { throw new Error('Drive must not be called'); }
  });

  const saved = await writer.upsertText('manifest.json', '{"ok":true}\n');

  assert.equal(saved.storage, 'gcs');
  assert.equal(saved.object, 'MCP_DAILY_SYNC_AUDIT/manifest.json');
  assert.equal(saved.id, 'gs://test-bucket/MCP_DAILY_SYNC_AUDIT/manifest.json');
  assert.equal(await writer.readText('manifest.json'), '{"ok":true}\n');
  assert.equal(storage.objects.get('test-bucket/MCP_DAILY_SYNC_AUDIT/manifest.json').options.metadata.cacheControl, 'no-store');
});

test('Drive mirroring is best-effort unless explicitly required', async () => {
  const storage = memoryStorage();
  const writer = new DrivePrimaryWriter({
    bucketName: 'test-bucket',
    folderName: 'MOPS_MCP_PRIMARY',
    storage,
    driveMirrorEnabled: true,
    fetchImpl: async () => ({ ok: false, status: 403, json: async () => ({}) })
  });

  const saved = await writer.upsertText('manifest.json', '{}\n');

  assert.equal(saved.storage, 'gcs');
  assert.equal(saved.driveMirror, undefined);
  assert.equal(await writer.readText('manifest.json'), '{}\n');
});

test('data health recognizes the official Drive manifest trade-date field', () => {
  assert.equal(latestDateOf({ latest_successful_trade_date: '2026-09-04' }), '2026-09-04');
});
