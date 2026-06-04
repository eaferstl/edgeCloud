// HTTP-transport smoke test for the edgecloud MCP server.
//
// Starts the loopback streamable-http server in-process, then connects with the SDK's
// own MCP client and lists the tools. This validates the full HTTP transport +
// session handshake + tool registration WITHOUT needing a live edgeCloud backend
// (tools/list does not call edgeCloud). Exits 0 on success.
//
//   node agent_mcp_integration/mcp/test/http-smoke.mjs

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { startHttpServer } from '../src/http.js';

// The server constructs a client at boot; give it a (dummy) config so it starts.
// tools/list never dials this, so the URL doesn't need to resolve.
process.env.EDGECLOUD_SERVER ||= 'http://127.0.0.1:9';
process.env.EDGECLOUD_EMAIL ||= 'smoke@e2e.test';
process.env.EDGECLOUD_KEYSTORE ||= '/tmp/edgecloud-http-smoke-keys.json';

let failures = 0;
const check = (name, ok, detail = '') => {
  console.log(ok ? `  ✅ ${name}` : `  ❌ ${name} ${detail}`);
  if (!ok) failures++;
};

const PORT = 8799;
const { httpServer } = await startHttpServer({ host: '127.0.0.1', port: PORT, log: () => {} });

const client = new Client({ name: 'http-smoke', version: '0.0.0' });
const transport = new StreamableHTTPClientTransport(new URL(`http://127.0.0.1:${PORT}/mcp`));

try {
  await client.connect(transport); // performs the MCP initialize handshake over HTTP
  console.log('▶ connected over streamable-http');

  const { tools } = await client.listTools();
  const names = tools.map((t) => t.name).sort();
  console.log(`▶ tools: ${names.join(', ')}`);

  check('handshake + tools/list succeeded', tools.length === 3);
  check('exposes edgecloud_run', names.includes('edgecloud_run'));
  check('exposes edgecloud_status', names.includes('edgecloud_status'));
  check('exposes edgecloud_get_result', names.includes('edgecloud_get_result'));

  const run = tools.find((t) => t.name === 'edgecloud_run');
  check('edgecloud_run advertises an input schema', !!run?.inputSchema?.properties?.type);
} catch (e) {
  console.error('SMOKE ERROR:', e.message);
  failures++;
} finally {
  try { await client.close(); } catch {}
  httpServer.close();
}

console.log(`\n${failures === 0 ? '✅ HTTP SMOKE PASSED' : `❌ ${failures} CHECK(S) FAILED`}`);
process.exit(failures === 0 ? 0 : 1);
