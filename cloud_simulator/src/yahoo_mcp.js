'use strict';

const readline = require('node:readline');
const { fetchChartWithRetry, fetchSupplementalHistory, chartBars, chartEvents } = require('./yahoo');

const TOOLS = Object.freeze([
  {
    name: 'yahoo_chart',
    description: 'Read Yahoo Finance chart data as a supplemental MCP source. TWSE/MOPS official data remains authoritative.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string' },
        range: { type: 'string', default: '1y' },
        interval: { type: 'string', default: '1d' }
      },
      required: ['symbol']
    }
  },
  {
    name: 'yahoo_supplemental_history',
    description: 'Read daily/intraday Yahoo Finance supplemental history through the MCP interface.',
    inputSchema: {
      type: 'object',
      properties: {
        symbol: { type: 'string' },
        dailyRange: { type: 'string', default: '5y' },
        intradayRange: { type: 'string', default: '60d' }
      },
      required: ['symbol']
    }
  }
]);

async function callTool(name, args = {}, options = {}) {
  if (name === 'yahoo_chart') {
    const symbol = String(args.symbol || '').trim();
    if (!symbol) throw new Error('symbol is required');
    const range = String(args.range || '1y');
    const interval = String(args.interval || '1d');
    const raw = await fetchChartWithRetry(symbol, range, interval, options);
    return {
      status: 'OK',
      dataSource: 'YAHOO_FINANCE_MCP',
      official: false,
      supplementalOnly: true,
      symbol,
      range,
      interval,
      rows: chartBars(raw),
      events: chartEvents(raw),
      fetchedAt: new Date().toISOString()
    };
  }
  if (name === 'yahoo_supplemental_history') {
    const symbol = String(args.symbol || '').trim();
    if (!symbol) throw new Error('symbol is required');
    const data = await fetchSupplementalHistory(symbol, {
      ...options,
      dailyRange: args.dailyRange || '5y',
      intradayRange: args.intradayRange || '60d'
    });
    return {
      status: 'OK',
      dataSource: 'YAHOO_FINANCE_MCP',
      official: false,
      supplementalOnly: true,
      ...data
    };
  }
  throw new Error(`Unknown Yahoo Finance MCP tool: ${name}`);
}

function rpcResult(id, result) {
  return JSON.stringify({ jsonrpc: '2.0', id, result });
}

function rpcError(id, error) {
  return JSON.stringify({ jsonrpc: '2.0', id, error: { code: -32000, message: String(error.message || error) } });
}

function startStdioServer() {
  const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
  rl.on('line', async line => {
    let request;
    try {
      request = JSON.parse(line);
      if (request.method === 'initialize') {
        process.stdout.write(`${rpcResult(request.id, {
          protocolVersion: '2025-06-18',
          capabilities: { tools: {} },
          serverInfo: { name: 'tw-stock-yahoo-finance-mcp', version: '1.0.0' }
        })}\n`);
        return;
      }
      if (request.method === 'tools/list') {
        process.stdout.write(`${rpcResult(request.id, { tools: TOOLS })}\n`);
        return;
      }
      if (request.method === 'tools/call') {
        const result = await callTool(request.params?.name, request.params?.arguments || {});
        process.stdout.write(`${rpcResult(request.id, {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result
        })}\n`);
        return;
      }
      if (request.id != null) process.stdout.write(`${rpcError(request.id, new Error(`Unsupported method: ${request.method}`))}\n`);
    } catch (error) {
      if (request?.id != null) process.stdout.write(`${rpcError(request.id, error)}\n`);
    }
  });
}

module.exports = { TOOLS, callTool, startStdioServer };
