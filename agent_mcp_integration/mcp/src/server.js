// The `edgecloud` MCP server: exposes edgeCloud as agent tools.
//
// IMPORTANT design boundary: edgeCloud workers are a hermetic sandbox — NO
// network, NO filesystem (decisions D-008/D-010). So these tools accept only
// PURE, self-contained compute. Code that calls an LLM, hits an API, or fetches
// a URL will fail by design. Agents offload deterministic sub-tasks (scoring,
// simulation, transforms, crypto, WASM) — never their agentic loop.

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { EdgeCloudClient } from './client.js';
import { Keystore } from './keystore.js';

const RUN_DESCRIPTION = [
  'Run a PURE compute job on the edgeCloud volunteer network and return its stdout.',
  'The sandbox has NO network and NO filesystem access: use this only for self-contained',
  'computation (scoring, simulation, data transforms, crypto, WASM) — never for tasks that',
  'call an API, an LLM, or fetch a URL. Identical code returns a cached result instantly.',
].join(' ');

/**
 * Build the MCP server. Config comes from the environment so the attendee
 * configures it once (like their EdgeOS/Geo/Index Network MCP servers):
 *   EDGECLOUD_SERVER, EDGECLOUD_EMAIL, EDGECLOUD_KEYSTORE
 */
export function createServer({ baseUrl, email, keystore, client: existingClient } = {}) {
  const server = new McpServer({ name: 'edgecloud', version: '0.1.0' });

  // Reuse a shared client when given one (HTTP mode binds many short-lived MCP
  // sessions to a single client so the keystore + session-token cache persist).
  // Otherwise build one per process (stdio mode).
  const client =
    existingClient ||
    new EdgeCloudClient({
      baseUrl: baseUrl || process.env.EDGECLOUD_SERVER,
      email: email || process.env.EDGECLOUD_EMAIL,
      keystore: keystore || new Keystore(),
    });

  const ok = (obj) => ({
    content: [{ type: 'text', text: JSON.stringify(obj, null, 2) }],
    structuredContent: obj,
  });
  const fail = (e) => ({
    content: [{ type: 'text', text: `edgeCloud error: ${e.message}` }],
    isError: true,
  });

  server.registerTool(
    'edgecloud_run',
    {
      title: 'Run compute on edgeCloud',
      description: RUN_DESCRIPTION,
      inputSchema: {
        type: z.enum(['js', 'wasm']).default('js').describe('job kind: a JS snippet or a WASM module'),
        code: z.string().optional().describe('JS source or expression (type: "js"). Its stdout / last value is returned.'),
        moduleB64: z.string().optional().describe('base64-encoded WASM module (type: "wasm")'),
        args: z.array(z.string()).max(16).optional().describe('string arguments passed to the job'),
        timeoutMs: z.number().int().positive().max(60_000).optional().describe('job timeout (default 10s, hard cap 60s)'),
        label: z.string().max(128).optional().describe('short human label for the job'),
        wait: z.boolean().default(true).describe('block until the result returns (false = fire-and-forget; fetch later with edgecloud_get_result)'),
      },
    },
    async (args) => {
      try {
        const { wait, ...job } = args;
        const out = await client.run(job, { wait });
        return ok(summarize(out));
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'edgecloud_status',
    {
      title: 'edgeCloud network status',
      description: 'Report live network state (workers online, fleet capacity, jobs submitted) so the agent can decide whether to offload work.',
      inputSchema: {},
    },
    async () => {
      try {
        return ok(await client.networkStatus());
      } catch (e) {
        return fail(e);
      }
    }
  );

  server.registerTool(
    'edgecloud_get_result',
    {
      title: 'Fetch an edgeCloud job result',
      description: 'Fetch the result of a previously submitted job by its jobId (for fire-and-forget submissions). Gated to this agent\'s key.',
      inputSchema: {
        jobId: z.string().regex(/^[0-9a-f]{64}$/, 'jobId must be a 64-char hex string'),
      },
    },
    async ({ jobId }) => {
      try {
        const result = await client.fetchResult(jobId);
        if (!result) return ok({ jobId, status: 'queued' });
        return ok(summarize({ jobId, status: 'done', cached: false, result }));
      } catch (e) {
        return fail(e);
      }
    }
  );

  return { server, client };
}

/** Flatten the run/result shape into a compact, agent-friendly object. */
function summarize({ jobId, status, cached, result }) {
  const base = { jobId, status, cached: Boolean(cached) };
  if (!result) return base;
  return {
    ...base,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
    exitCode: result.exitCode,
    ok: result.ok,
    error: result.error ?? null,
    executedBy: result.executedBy,
  };
}
