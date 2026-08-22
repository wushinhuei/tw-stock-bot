'use strict';

const { gzipSync } = require('node:zlib');

function previousTaipeiMonth(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit'
  }).formatToParts(now).reduce((out, part) => {
    if (part.type !== 'literal') out[part.type] = part.value;
    return out;
  }, {});
  const first = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, 1));
  first.setUTCMonth(first.getUTCMonth() - 1);
  return `${first.getUTCFullYear()}-${String(first.getUTCMonth() + 1).padStart(2, '0')}`;
}

async function createMonthlyArchive(options = {}) {
  const bucket = options.bucket;
  if (!bucket) throw new Error('bucket is required');
  const month = options.month || previousTaipeiMonth(options.now);
  if (!/^\d{4}-\d{2}$/.test(month)) throw new Error(`invalid archive month: ${month}`);

  const prefix = `raw/${month}-`;
  const destination = `monthly/${month}.jsonl.gz`;
  const [files] = await bucket.getFiles({ prefix });
  const ordered = files.slice().sort((a, b) => a.name.localeCompare(b.name));
  if (!ordered.length) return { skipped: true, reason: 'NO_RAW_SNAPSHOTS', month, prefix, destination, count: 0 };

  const lines = [];
  for (const file of ordered) {
    const [content] = await file.download();
    lines.push(content.toString('utf8').trim());
  }
  const archive = gzipSync(Buffer.from(lines.filter(Boolean).join('\n') + '\n', 'utf8'), { level: 9 });
  await bucket.file(destination).save(archive, {
    resumable: false,
    contentType: 'application/gzip',
    metadata: {
      metadata: { sourcePrefix: prefix, snapshotCount: String(ordered.length), archiveFormat: 'jsonl.gz' }
    }
  });
  return { skipped: false, month, prefix, destination, count: ordered.length, compressedBytes: archive.length };
}

module.exports = { createMonthlyArchive, previousTaipeiMonth };
