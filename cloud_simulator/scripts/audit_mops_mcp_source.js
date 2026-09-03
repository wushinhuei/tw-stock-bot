'use strict';

const { MopsMcpHistory } = require('../src/mops_mcp_history');

const YEARS = (process.env.MOPS_AUDIT_YEARS || '2025,2026').split(',').map(Number).filter(Number.isFinite);
const CREDENTIALLESS = /^(1|true|yes)$/i.test(process.env.MOPS_CREDENTIALLESS_MODE || '');

async function main() {
  const mcp = new MopsMcpHistory();
  const toolNames = new Set(mcp.tools().map(tool => tool.name));
  const requiredTools = [
    'mops_monthly_revenue',
    'mops_quarterly_financials',
    'mops_major_messages',
    'mops_filing_index'
  ];
  const missingTools = requiredTools.filter(name => !toolNames.has(name));
  const datasets = [];

  if (!CREDENTIALLESS) {
    for (const year of YEARS) {
      for (const tool of requiredTools) {
        try {
          const result = await mcp.callTool(tool, { year });
          const payload = result.structuredContent || {};
          datasets.push({ year, tool, provider: payload.provider || null, rows: Array.isArray(payload.rows) ? payload.rows.length : 0, ok: payload.provider === 'MOPS_MCP' && Array.isArray(payload.rows) });
        } catch (error) {
          datasets.push({ year, tool, provider: null, rows: 0, ok: false, error: String(error.message || error) });
        }
      }
    }
  }

  const failures = datasets.filter(row => !row.ok);
  const report = {
    generatedAt: new Date().toISOString(),
    policy: 'MOPS_MCP_PRIMARY',
    mode: CREDENTIALLESS ? 'CREDENTIALLESS_CAPABILITY' : 'FULL_DATA_PROBE',
    years: YEARS,
    requiredTools,
    missingTools,
    datasets,
    dataProbeSkipped: CREDENTIALLESS,
    credentiallessFallbacks: CREDENTIALLESS ? [
      'official monthly revenue archive CSV',
      'official MOPS XBRL quarterly archive',
      'official historical major-message page by symbol',
      'conservative filing availability when exact timestamp cache is unavailable'
    ] : [],
    passed: missingTools.length === 0 && (CREDENTIALLESS || failures.length === 0),
    note: CREDENTIALLESS
      ? 'Capability audit does not certify Q2 data completeness. The point-in-time builder and strict readiness gate remain authoritative.'
      : 'Full data probe requires readable cached/official datasets.'
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 2;
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
