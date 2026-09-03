'use strict';

const { spawnSync } = require('node:child_process');

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: { ...process.env, ...(options.env || {}) },
    shell: false
  });
  return { ok: result.status === 0, status: result.status, signal: result.signal };
}

function runRequired(report, command, args, name) {
  process.stderr.write(`\n[q2-pipeline] START ${name}\n`);
  const result = run(command, args);
  report.push({ name, ...result });
  if (!result.ok) {
    process.stderr.write(`[q2-pipeline] STOP ${name}: exit=${result.status}\n`);
    process.exitCode = result.status || 1;
    return false;
  }
  return true;
}

function main() {
  const report = [];

  if (!runRequired(report, 'node', ['cloud_simulator/scripts/audit_data_source_policy.js'], 'TWSE MCP primary-source policy audit')) return;
  if (!runRequired(report, 'node', ['cloud_simulator/scripts/verify_q2_strategy_lock.js'], 'Frozen Q2 strategy verification')) return;

  const steps = [
    ['node', ['cloud_simulator/scripts/backfill_q2_twse_mcp.js'], 'TWSE MCP Q2 backfill'],
    ['node', ['cloud_simulator/scripts/build_q2_point_in_time_dataset.js'], 'Q2 TWSE point-in-time dataset'],
    ['node', ['cloud_simulator/scripts/build_q2_mops_point_in_time.js'], 'Q2 MOPS point-in-time dataset'],
    ['node', ['cloud_simulator/scripts/prepare_q2_intraday_universe.js'], 'Q2 intraday acquisition universe'],
    ['node', ['cloud_simulator/scripts/backfill_q2_twse_warmup.js'], 'TWSE MCP daily/weekly indicator warmup']
  ];

  for (const [command, args, name] of steps) if (!runRequired(report, command, args, name)) return;

  if (process.env.SKIP_INTRADAY !== '1') {
    if (process.env.SJ_API_KEY && process.env.SJ_SEC_KEY) {
      process.stderr.write('\n[q2-pipeline] START intraday fallback backfill (TWSE public MCP has no minute history)\n');
      const python = process.env.PYTHON || 'python3';
      const result = run(python, ['cloud_simulator/scripts/download_shioaji_q2_intraday.py']);
      report.push({ name: 'Intraday fallback backfill', provider: 'SHIOAJI_ONLY_BECAUSE_TWSE_MINUTE_HISTORY_UNAVAILABLE', ...result });
      if (!result.ok) process.stderr.write(`[q2-pipeline] intraday backfill incomplete: exit=${result.status}\n`);
    } else {
      report.push({ name: 'Intraday fallback backfill', ok: false, status: null, provider: 'SHIOAJI_ONLY_BECAUSE_TWSE_MINUTE_HISTORY_UNAVAILABLE', blocker: 'SJ_API_KEY/SJ_SEC_KEY_NOT_SET' });
      process.stderr.write('[q2-pipeline] TWSE MCP daily data is ready, but public TWSE history does not provide the required minute bars and fallback credentials are absent. No strategy return will be published.\n');
    }
  }

  process.stderr.write('\n[q2-pipeline] START strict readiness audit\n');
  const audit = run('node', ['cloud_simulator/scripts/audit_q2_backtest_readiness.js']);
  report.push({ name: 'Strict readiness audit', ...audit });
  if (!audit.ok) {
    process.stderr.write('[q2-pipeline] Q2 dataset is not yet at the strict restoration gate. Backtest result remains blocked.\n');
    process.exitCode = 2;
    return;
  }

  if (!runRequired(report, 'node', ['cloud_simulator/scripts/verify_q2_strategy_lock.js'], 'Post-acquisition frozen strategy verification')) return;
  if (!runRequired(report, 'node', ['cloud_simulator/scripts/run_q2_strict_replay.js'], 'Frozen-strategy Q2 strict replay')) return;

  process.stdout.write(`${JSON.stringify({
    status: 'Q2_STRICT_REPLAY_COMPLETE',
    policy: {
      dataSource: 'TWSE_MCP_PRIMARY',
      fallbackOnlyWhenTwseUnavailable: true,
      strategyFrozen: true,
      predictionForbidden: true,
      futureLeakageForbidden: true,
      resultPublishedOnlyAfterStrictGate: true
    },
    steps: report
  }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { run, runRequired };
