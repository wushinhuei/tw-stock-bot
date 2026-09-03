'use strict';

const { MopsMcpHistory } = require('../src/mops_mcp_history');

const YEARS = (process.env.MOPS_AUDIT_YEARS || '2025,2026').split(',').map(Number).filter(Number.isFinite);

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
  const failures = datasets.filter(row => !row.ok);
  const report = {
    generatedAt: new Date().toISOString(),
    policy: 'MOPS_MCP_PRIMARY',
    years: YEARS,
    requiredTools,
    missingTools,
    datasets,
    passed: missingTools.length === 0 && failures.length === 0
  };
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (!report.passed) process.exitCode = 2;
}

if (require.main === module) main().catch(error => { console.error(error); process.exitCode = 1; });
