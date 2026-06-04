#!/usr/bin/env node
// Entry point for the `edgecloud` MCP server.
//
// Configuration (env, like the attendee's other MCP servers):
//   EDGECLOUD_SERVER   base URL of a central server (e.g. http://146.190.123.91)
//   EDGECLOUD_EMAIL    the attendee's allowlisted Edge Esmeralda email
//   EDGECLOUD_KEYSTORE optional path for the agent's key (default ~/.edgecloud/keys.json)
//
// Usage:
//   edgecloud-mcp                 # start the MCP server over stdio (for the agent harness)
//   edgecloud-mcp --self-test     # config + connectivity check, then exit
//   edgecloud-mcp --version

import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { createServer } from './server.js';

const argv = process.argv.slice(2);

if (argv.includes('--version')) {
  console.log('@edgecloud/agent-mcp 0.1.0');
  process.exit(0);
}

if (argv.includes('--self-test')) {
  // Validate config + reach the network without standing up a transport.
  try {
    const { client } = createServer();
    const status = await client.networkStatus();
    console.log('[self-test] config OK');
    console.log(`[self-test] server: ${client.baseUrl}`);
    console.log(`[self-test] agent pubkey: ${client.keypair.publicKey.slice(0, 16)}…`);
    console.log(`[self-test] network: ${status.workersOnline} worker(s) online, ${status.jobsSubmitted} jobs submitted`);
    process.exit(0);
  } catch (e) {
    console.error(`[self-test] FAILED: ${e.message}`);
    process.exit(1);
  }
}

// Default: serve over stdio (what Hermes / Claude Desktop launch).
try {
  const { server } = createServer();
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr only — stdout is the MCP transport and must stay clean.
  console.error('[edgecloud-mcp] ready (stdio)');
} catch (e) {
  console.error(`[edgecloud-mcp] failed to start: ${e.message}`);
  process.exit(1);
}
