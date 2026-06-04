# edgeCloud onboarding ritual

Run this once, with your human, to connect your agent to edgeCloud. It starts a small
**local** MCP server (so your signing key stays on your machine) and registers it with
Hermes.

## 0. Prerequisites

- Node.js ≥ 22 on the machine where your agent runs.
- Your Edge Esmeralda attendee email (the one EdgeOS verified). It must be on the
  allowlist or edgeCloud will refuse jobs.
- The `@edgecloud/agent-mcp` package (from the edgeCloud repo): `agent_mcp_integration/mcp`.

## 1. Start the local edgeCloud MCP server

From the edgeCloud repo root:

```bash
npm install   # once

EDGECLOUD_SERVER=http://146.190.123.91 \
EDGECLOUD_EMAIL=you@example.com \
node agent_mcp_integration/mcp/src/index.js --http 127.0.0.1:8765
```

On first run this generates and stores your agent's Ed25519 key under
`~/.edgecloud/keys.json` and registers it against your email. Keep that file private —
whoever holds it can read your job results.

> Tip: leave this running (or run it under a process manager). The server prints
> `streamable-http ready at http://127.0.0.1:8765/mcp` when it's up.

## 2. Register it with Hermes

```bash
hermes config set mcp.servers.edgecloud \
  '{"url":"http://127.0.0.1:8765/mcp","transport":"streamable-http"}'
```

(No bearer token: the server is loopback-only and authenticates to edgeCloud with your
local key, so there's no secret to put in the header.)

## 3. Verify

Ask your agent to call `edgecloud_status`. You should see at least one worker online and
a growing `jobsSubmitted` count. Then try:

```
edgecloud_run({ "type": "js", "code": "6 * 7" })
```

Expect `stdout: "42"`. You're connected.

## 4. Remember the boundary

edgeCloud runs **pure compute only** — no network, no filesystem. Use it for
calculation you can express as a self-contained function; never for tasks that call an
API, a model, or fetch a URL. See `SKILL.md`.
