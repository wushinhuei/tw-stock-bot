'use strict';

const readline = require('node:readline');
const { MopsMcpHistory } = require('../src/mops_mcp_history');

const service = new MopsMcpHistory();
const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });

function reply(id, result) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, result })}\n`);
}
function fail(id, error) {
  process.stdout.write(`${JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: String(error.message || error) } })}\n`);
}

rl.on('line', async line => {
  if (!line.trim()) return;
  let request;
  try { request = JSON.parse(line); } catch (error) { return fail(null, error); }
  try {
    if (request.method === 'initialize') return reply(request.id, { protocolVersion: '2025-06-18', capabilities: { tools: {} }, serverInfo: { name: 'mops-history-mcp', version: '1.0.0' } });
    if (request.method === 'tools/list') return reply(request.id, { tools: service.tools() });
    if (request.method === 'tools/call') return reply(request.id, await service.callTool(request.params?.name, request.params?.arguments || {}));
    reply(request.id, {});
  } catch (error) { fail(request.id, error); }
});
