// Streamable-HTTP transport for the edgecloud MCP server.
//
// Hermes registers MCP servers as `{"url":…,"transport":"streamable-http"}`, so we
// expose the same tools over HTTP. To preserve the privacy model (whoever holds the
// agent's key can read its results — R-012), this binds to LOOPBACK by default: each
// attendee runs the server on their own machine and points Hermes at 127.0.0.1, so
// the key never leaves their trust boundary.
//
// Session handling follows the standard MCP streamable-http pattern: the initialize
// request creates a session + transport; subsequent requests reuse it via the
// `mcp-session-id` header. All sessions share ONE EdgeCloudClient so the keystore and
// session-token cache persist across them.

import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { EdgeCloudClient } from './client.js';
import { Keystore } from './keystore.js';
import { createServer } from './server.js';

const MCP_PATH = '/mcp';

function readBody(req) {
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      if (!raw) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve(null); // signal a malformed body
      }
    });
    req.on('error', () => resolve(undefined));
  });
}

function sendJsonRpcError(res, status, message) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ jsonrpc: '2.0', error: { code: -32000, message }, id: null }));
}

/**
 * Start the streamable-HTTP MCP server.
 * @returns {Promise<{ httpServer: http.Server, url: string }>}
 */
export async function startHttpServer({ host = '127.0.0.1', port = 8765, log = console.error } = {}) {
  // One shared client for the whole process (key custody + session cache).
  const client = new EdgeCloudClient({
    baseUrl: process.env.EDGECLOUD_SERVER,
    email: process.env.EDGECLOUD_EMAIL,
    keystore: new Keystore(),
  });

  const transports = new Map(); // sessionId -> StreamableHTTPServerTransport

  const httpServer = http.createServer(async (req, res) => {
    if (!req.url || !req.url.startsWith(MCP_PATH)) {
      return sendJsonRpcError(res, 404, 'not found — MCP endpoint is /mcp');
    }

    const sessionId = req.headers['mcp-session-id'];
    let transport = sessionId ? transports.get(sessionId) : undefined;

    // GET (SSE stream) and DELETE (session teardown) require an existing session.
    if (req.method === 'GET' || req.method === 'DELETE') {
      if (!transport) return sendJsonRpcError(res, 400, 'unknown or missing session');
      return transport.handleRequest(req, res);
    }

    if (req.method !== 'POST') return sendJsonRpcError(res, 405, 'method not allowed');

    const body = await readBody(req);
    if (body === null) return sendJsonRpcError(res, 400, 'malformed JSON body');

    if (!transport) {
      // Only an initialize request may open a new session.
      if (!isInitializeRequest(body)) {
        return sendJsonRpcError(res, 400, 'no valid session; expected an initialize request');
      }
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sid) => {
          transports.set(sid, transport);
          log(`[edgecloud-mcp] session ${sid.slice(0, 8)}… opened`);
        },
      });
      transport.onclose = () => {
        if (transport.sessionId) transports.delete(transport.sessionId);
      };
      // Each session gets its own McpServer bound to the SHARED client.
      const { server } = createServer({ client });
      await server.connect(transport);
    }

    return transport.handleRequest(req, res, body);
  });

  await new Promise((resolve) => httpServer.listen(port, host, resolve));
  const url = `http://${host}:${port}${MCP_PATH}`;
  log(`[edgecloud-mcp] streamable-http ready at ${url}`);
  log(`[edgecloud-mcp] server: ${client.baseUrl}  agent: ${client.keypair.publicKey.slice(0, 12)}…`);
  return { httpServer, url, client };
}
