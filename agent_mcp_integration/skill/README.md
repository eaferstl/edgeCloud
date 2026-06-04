# Hermes skill: edgecloud

A thin Hermes skill that points an attendee's agent at the [`@edgecloud/agent-mcp`](../mcp)
server, matching how the Edge Esmeralda agents already wire EdgeOS / Geo / Index Network.

```
skill/
└── edgecloud/
    ├── SKILL.md       # capabilities — when/how the agent uses the edgecloud tools
    └── bootstrap.md   # one-time onboarding ritual (start local server + hermes config)
```

## Install (Hermes)

Hermes installs skills by repo path and configures MCP servers via `hermes config`:

```bash
# install the skill (publish this folder to the Edge-City agentvillage skills repo,
# or install from a local path your Hermes is configured to read)
hermes skills install Edge-City/agentvillage/skills/edgecloud --force

# then follow skill/edgecloud/bootstrap.md to start the local server and run:
hermes config set mcp.servers.edgecloud \
  '{"url":"http://127.0.0.1:8765/mcp","transport":"streamable-http"}'
```

## Why a local (loopback) server

The other village MCP servers are remote (`streamable-http` to a hosted URL with a
bearer token). edgeCloud is different on purpose: the agent's **signing key** must stay
in the attendee's trust boundary (whoever holds it can read that agent's results —
R-012). So the skill runs the MCP server on `127.0.0.1` and Hermes connects to it
locally over the same `streamable-http` transport. Same protocol Hermes expects, key
never leaves the machine.

## Other harnesses

The MCP server also speaks **stdio** for Claude Desktop / generic MCP clients — see
[`../mcp/README.md`](../mcp/README.md). The skill files here are Hermes-specific; the
underlying tools (`edgecloud_run`, `edgecloud_status`, `edgecloud_get_result`) are the
same everywhere.

## Status

The MCP server (stdio + loopback streamable-http) is built and tested. This skill
wrapper is **not yet published** to the Edge-City agentvillage skills repo (that
publish step + a live-server smoke test with a real attendee email are the remaining
work — AGENT-005/006).
