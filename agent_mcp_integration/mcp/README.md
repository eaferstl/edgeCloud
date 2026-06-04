# @edgecloud/agent-mcp

An **MCP server** that lets an Edge Esmeralda attendee's AI agent (Hermes, OpenClaw,
Claude Desktop, or any MCP client) submit **pure-compute jobs** to edgeCloud and read
results signed to its own key.

It is a thin client of the existing edgeCloud HTTP API — it replays the proven
[`scripts/e2e-client.mjs`](../../scripts/e2e-client.mjs) flow using the same
`@edgecloud/shared` code the network already runs. No new protocol, no new payload.

> Background and design: [`../README.md`](../README.md), [`../prd.md`](../prd.md),
> [`../spec.md`](../spec.md).

## What the agent gets

| Tool | Purpose |
|---|---|
| `edgecloud_run` | Submit a JS snippet or WASM module (+ args); optionally block until the result returns. |
| `edgecloud_status` | Live network state (workers online, fleet capacity, jobs submitted). |
| `edgecloud_get_result` | Fetch a prior job's result by `jobId` (for fire-and-forget runs). |

## How it works (MCP architecture)

**Model Context Protocol (MCP)** is a standard way to give an AI agent extra
capabilities. A server can expose three kinds of things:

- **Tools** — actions the model can call (functions with typed inputs)
- **Resources** — readable data/context (like files or records)
- **Prompts** — reusable prompt templates

This is a **tools-only server**, using the **stdio transport**, packaged as a
**local subprocess**. Concretely:

- **Transport = stdio.** The agent's harness (Hermes, Claude Desktop) *launches*
  `node src/index.js` as a child process and talks to it over **stdin/stdout** using
  **JSON-RPC 2.0**. That's why `src/index.js` logs only to **stderr** — stdout is the
  protocol channel and must stay clean.
- **Local, not hosted.** It runs on the attendee's own machine / trust boundary, right
  next to where the agent runs. This is deliberate: the server holds the agent's
  Ed25519 **private key**, and whoever holds that key can read the agent's results
  (risk R-012 in [`../../04_decisions_risks_cuts.md`](../../04_decisions_risks_cuts.md)).
  A shared/hosted server would leak that.
- **Three tools, no resources/prompts.**

> **Why stdio + local instead of an HTTP MCP server?** MCP also supports a remote
> "streamable HTTP" transport. We chose stdio-local *because of the key*. The whole
> edgeCloud privacy model rests on the submitter's secret key never leaving its owner;
> a hosted HTTP MCP server would mean someone else's process holds attendees' keys —
> collapsing the exact guarantee the 403 privacy gate provides. The transport choice
> is a **security** decision, not just convenience.

### A tool call, end to end

```text
agent harness (MCP client)
   │  JSON-RPC "tools/call" { name: "edgecloud_run", arguments: {…} }   ── over stdio ──▶
edgecloud MCP server  (src/server.js)
   │  1. zod validates the arguments against the tool's inputSchema
   │  2. handler calls EdgeCloudClient.run(…)   (src/client.js)
   ▼
EdgeCloudClient                         (the proven e2e-client.mjs flow)
   │  register (idempotent) ─▶ build manifest+zip ─▶ sign envelope (Ed25519)
   │  POST /api/jobs ─▶ poll /status ─▶ challenge/response ─▶ GET /result
   ▼
edgeCloud server (HTTP) ─▶ OrbitDB ─▶ volunteer Docker worker runs it ─▶ result back
   │
   ◀── handler returns { content:[{type:"text", text}], structuredContent }
agent harness gets the result, the model reads it
```

Two mechanics worth calling out:

1. **Schema-driven, self-describing.** On startup the client asks the server
   `tools/list`; the server returns each tool's name, description, and JSON Schema
   (defined as **zod** shapes in `src/server.js`, which the SDK converts to JSON
   Schema). That description is *how the model knows when to use the tool* — which is
   why `edgecloud_run`'s description spells out "PURE compute only, no
   network/filesystem." The prompt-engineering lives in the schema.
2. **State lives in the server, not the protocol.** MCP itself is stateless per call.
   The durable state — the agent's keypair and cached session token — is held by the
   `Keystore` (`~/.edgecloud/keys.json`). So across many tool calls the agent reuses
   one registered identity instead of burning its 4-key quota.

> **The MCP server is a thin adapter, not the system.** All the real work — crypto,
> the job envelope, dedup, the sandbox — already lives in `@edgecloud/shared` and the
> running network. This server's only job is to translate "a model called a tool" into
> "the existing HTTP client flow" and translate the result back into MCP's `content`
> format. That's why it's ~4 small files and adds zero new network protocol: the MCP
> layer is purely an *interface*, and the proof it's faithful is that it reuses the
> same `@edgecloud/shared` functions the workers themselves run.

## Tool reference (schemas)

### `edgecloud_run`

Submit a pure-compute job and (by default) return its result.

| Field | Type | Required | Default | Notes |
|---|---|---|---|---|
| `type` | `"js"` \| `"wasm"` | no | `"js"` | job kind |
| `code` | string | for `js` | — | JS source/expression; its stdout (or last value) is returned |
| `moduleB64` | string | for `wasm` | — | base64-encoded WASM module |
| `args` | string[] (≤16) | no | `[]` | arguments passed to the job |
| `timeoutMs` | integer | no | `10000` | job timeout; hard cap `60000` |
| `label` | string (≤128) | no | derived | short human label |
| `wait` | boolean | no | `true` | block until done; `false` = fire-and-forget |

Returns (`structuredContent`, also pretty-printed as text):

```jsonc
{
  "jobId": "<64-hex>",
  "status": "done" | "queued",
  "cached": false,        // true when an identical job was already computed
  "stdout": "…",          // present when status==="done"
  "stderr": "…",
  "exitCode": 0,
  "ok": true,
  "error": null,
  "executedBy": "<worker pubkey b64>"
}
```

### `edgecloud_status`

No input. Returns the live `/api/status` payload:

```jsonc
{
  "workersOnline": 2,
  "workers": ["…"],
  "fleetAvailableCapacity": 8,
  "registeredKeys": 12,
  "jobsSubmitted": 47,
  "allowlistedEmails": 500,
  "cachedResults": 31,
  "trustedServers": 1
}
```

### `edgecloud_get_result`

| Field | Type | Required | Notes |
|---|---|---|---|
| `jobId` | string (64-hex) | yes | id returned by a prior `edgecloud_run` |

Returns the same result shape as `edgecloud_run` when ready, or `{ jobId, status: "queued" }`
if no worker has finished it yet. Gated to this agent's key (a different key gets a 403,
surfaced as an error).

## The one rule

edgeCloud workers are a **hermetic sandbox — no network, no filesystem**. Submit only
**pure, self-contained compute** (scoring, simulation, transforms, crypto, WASM). Code
that calls an LLM, hits an API, or fetches a URL fails by design. The agent stays the
brain; edgeCloud is the calculator.

## Configuration

Set these in the environment (the same way you wire your other MCP servers):

| Variable | Required | Default | Meaning |
|---|---|---|---|
| `EDGECLOUD_SERVER` | yes | — | central server base URL, e.g. `http://146.190.123.91` |
| `EDGECLOUD_EMAIL` | yes | — | your allowlisted Edge Esmeralda attendee email |
| `EDGECLOUD_KEYSTORE` | no | `~/.edgecloud/keys.json` | where the agent's Ed25519 key is stored (keep private) |
| `EDGECLOUD_REQUEST_TIMEOUT_MS` | no | `30000` | per-request HTTP timeout |

> **Key custody:** whoever holds the keystore file can read this agent's results.
> Run this server inside your own trust boundary; don't share the keystore (R-012).

## Run it

```bash
# from the repo root (installs the workspace)
npm install

# sanity check: config + connectivity (does not submit a job)
EDGECLOUD_SERVER=http://146.190.123.91 EDGECLOUD_EMAIL=you@example.com \
  node agent_mcp_integration/mcp/src/index.js --self-test

# start the MCP server over stdio (Claude Desktop / generic MCP clients)
EDGECLOUD_SERVER=http://146.190.123.91 EDGECLOUD_EMAIL=you@example.com \
  npm run agent-mcp

# OR over loopback streamable-http (what Hermes connects to)
EDGECLOUD_SERVER=http://146.190.123.91 EDGECLOUD_EMAIL=you@example.com \
  node agent_mcp_integration/mcp/src/index.js --http 127.0.0.1:8765
```

### Transports

| Transport | Flag | Used by |
|---|---|---|
| stdio | (default) | Claude Desktop, generic MCP clients that launch a subprocess |
| streamable-http (loopback) | `--http [host:port]` | Hermes (`mcp.servers` config) |

The HTTP server binds to `127.0.0.1` by design — the agent's key stays local even
though Hermes connects over HTTP (key custody, R-012).

### Claude Desktop / generic MCP client

```json
{
  "mcpServers": {
    "edgecloud": {
      "command": "node",
      "args": ["/absolute/path/to/edgeCloud/agent_mcp_integration/mcp/src/index.js"],
      "env": {
        "EDGECLOUD_SERVER": "http://146.190.123.91",
        "EDGECLOUD_EMAIL": "you@example.com"
      }
    }
  }
}
```

### Hermes

Run the server in `--http` mode (above), then register it:

```bash
hermes config set mcp.servers.edgecloud \
  '{"url":"http://127.0.0.1:8765/mcp","transport":"streamable-http"}'
```

The packaged skill (`SKILL.md` + `bootstrap.md`) lives in [`../skill/`](../skill/).

## Worker role (contribute compute)

Attendees can also run a worker node so their machine *earns by executing* others'
jobs (≤25 workers per email). That uses the existing [`../../worker/`](../../worker/)
Docker node with `EDGECLOUD_EMAIL` set — see that folder's compose file.

## Example agent calls

```jsonc
// pure JS — returns stdout
edgecloud_run({ "type": "js", "code": "[...Array(1000).keys()].reduce((a,b)=>a+b,0)" })
// → { "jobId": "...", "status": "done", "stdout": "499500", "cached": false }

// fire-and-forget, fetch later
edgecloud_run({ "type": "js", "code": "heavyCompute()", "wait": false })
edgecloud_get_result({ "jobId": "..." })

// network check before offloading
edgecloud_status({})
```

## Test

```bash
# boots a real local server + 2 workers and drives the full flow through the client
node agent_mcp_integration/mcp/test/integration.local.mjs
```
