'use strict';

const { adaptCandidatePayload } = require('../src/candidate_adapter');

async function main() {
  const url = process.env.CANDIDATE_SNAPSHOT_URL;
  if (!url) throw new Error('CANDIDATE_SNAPSHOT_URL is required');
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Candidate endpoint HTTP ${response.status}`);
  const payload = await response.json();
  const adapted = adaptCandidatePayload(payload, { time: '11:52' });
  if (!adapted.candidates.length) throw new Error('No top-30 candidates after adaptation');
  const invalid = adapted.candidates.filter(row => !row.symbol || !row.strategy || !row.components || !Number.isFinite(row.score));
  if (invalid.length) throw new Error(`${invalid.length} invalid candidates`);
  console.log(JSON.stringify({
    ok: true, mode: adapted.mode, generatedAt: adapted.generatedAt, date: adapted.date,
    candidateCount: adapted.candidates.length,
    grades: adapted.candidates.reduce((out, row) => ({ ...out, [row.grade]: (out[row.grade] || 0) + 1 }), {}),
    top: adapted.candidates.slice().sort((a, b) => b.score - a.score).slice(0, 5).map(row => ({ symbol: row.symbol, score: row.score, grade: row.grade, strategy: row.strategy }))
  }, null, 2));
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
