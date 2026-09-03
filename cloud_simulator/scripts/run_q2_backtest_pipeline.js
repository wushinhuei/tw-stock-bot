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

function main() {
  const steps = [
    ['node', ['cloud_simulator/scripts/backfill_q2_twse_mcp.js'], 'TWSE MCP Q2 backfill'],
    ['node', ['cloud_simulator/scripts/build_q2_point_in_time_dataset.js'], 'Q2 TWSE point-in-time dataset'],
    ['node', ['cloud_simulator/scripts/build_q2_mops_point_in_time.js'], 'Q2 MOPS point-in-time dataset'],
    ['node', ['cloud_simulator/scripts/prepare_q2_intraday_universe.js'], 'Q2 intraday acquisition universe']
  ];

  const report = [];
  for (const [command, args, name] of steps) {
    process.stderr.write(`\n[q2-pipeline] START ${name}\n`);
    const result = run(command, args);
    report.push({ name, ...result });
    if (!result.ok) {
      process.stderr.write(`[q2-pipeline] STOP ${name}: exit=${result.status}\n`);
      process.exitCode = result.status || 1;
      return;
    }
  }

  if (process.env.SKIP_INTRADAY !== '1') {
    if (process.env.SJ_API_KEY && process.env.SJ_SEC_KEY) {
      process.stderr.write('\n[q2-pipeline] START Shioaji Q2 1m/5m/15m backfill\n');
      const python = process.env.PYTHON || 'python3';
      const result = run(python, ['cloud_simulator/scripts/download_shioaji_q2_intraday.py']);
      report.push({ name: 'Shioaji Q2 intraday backfill', ...result });
      if (!result.ok) {
        process.stderr.write(`[q2-pipeline] intraday backfill incomplete: exit=${result.status}\n`);
      }
    } else {
      report.push({ name: 'Shioaji Q2 intraday backfill', ok: false, status: null, blocker: 'SJ_API_KEY/SJ_SEC_KEY_NOT_SET' });
      process.stderr.write('[q2-pipeline] intraday backfill not executed because Market/Data credentials are not present. No strategy result will be published.\n');
    }
  }

  process.stderr.write('\n[q2-pipeline] START strict readiness audit\n');
  const audit = run('node', ['cloud_simulator/scripts/audit_q2_backtest_readiness.js']);
  report.push({ name: 'Strict readiness audit', ...audit });

  if (!audit.ok) {
    process.stderr.write('[q2-pipeline] Q2 dataset is not yet at the >=85 restoration gate. Backtest result remains blocked.\n');
    process.exitCode = 2;
    return;
  }

  process.stdout.write(`${JSON.stringify({ status: 'READY_FOR_STRICT_REPLAY', steps: report }, null, 2)}\n`);
}

if (require.main === module) main();

module.exports = { run };
