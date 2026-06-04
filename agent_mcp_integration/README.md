# Agent Integration

How Edge Esmeralda attendees' AI agents use edgeCloud as an on-demand compute fabric.

> Status: **proposed / spec'd, not built.** This README is the plain-language overview;
> the build handoff is `spec.md`, the scope is `prd.md`, and the agent-experiment
> findings are in `research/`.

## The idea

Attendee agents already plug in external tools as **MCP servers** (that's how they
reach EdgeOS, Geo, and Index Network). We add **one more MCP server** — `edgecloud` —
to that same config. The agent gains a few new tools, and edgeCloud becomes its
"send heavy compute to the swarm" button.

## How the agent uses it

The agent just calls a tool. Everything underneath is hidden:

```
agent: edgecloud_run({ type: "js", code: "<pure computation>", await: true })
     → { stdout: "<result>", cached: false }
```

Behind that single call, the `edgecloud` MCP server replays the proven flow from
[`../scripts/e2e-client.mjs`](../scripts/e2e-client.mjs):

1. **Register** the agent's key against the attendee's email — the *same* allowlist
   EdgeOS already verified, so the agent is authorized by construction.
2. **Sign + submit** the job to `POST /api/jobs`.
3. **Wait** for a volunteer worker to claim and run it.
4. **Challenge/response auth** → fetch the result, which is gated to that agent's
   key only (no one else can read it).

The agent author writes zero crypto. Optionally, an attendee can also run the
existing Docker worker (`../worker/`) to *contribute* compute — the "worker role".

### Tool surface

| Tool | What it does |
|---|---|
| `edgecloud_run` | Submit a JS expression/script or WASM module (+ args); optionally block until the result returns. |
| `edgecloud_status` | Read the network state (workers online, fleet capacity) to decide whether to offload. |
| `edgecloud_get_result` | Fetch a prior job's result by `jobId` (for async submissions). |

### Setup (mirrors how agents wire EdgeOS/Geo/Index Network)

```bash
hermes skills install edgecloud --force
# config:
#   EDGECLOUD_SERVER=http://146.190.123.91
#   EDGECLOUD_EMAIL=<your attendee email>   # the same one EdgeOS verified
```

## The one rule that shapes everything

edgeCloud workers are a **hermetic sandbox — no network, no filesystem** (submitted
code is assumed hostile; see decisions D-008/D-010 in
[`../04_decisions_risks_cuts.md`](../04_decisions_risks_cuts.md) and
[`../THREAT_MODEL.md`](../THREAT_MODEL.md)).

So the agent **cannot** offload its actual agentic loop — anything that calls an LLM,
hits EdgeOS, or fetches a URL fails by design. It offloads only **pure, self-contained
compute**:

- scoring 500 attendees for matchmaking,
- a simulation or constraint solve,
- a data transform or parse,
- a WASM workload an attendee built.

**Mental model:** the agent stays the brain; edgeCloud is a calculator it hands
deterministic number-crunching to. It works *because* both systems gate on the
identical attendee email — no new login, no new trust relationship, just a tool the
agent is already entitled to call.

## Status

Spec'd, not built. The MCP server (`@edgecloud/agent-mcp`) is task **AGENT-004**,
pending owner assignment and Coordination ratification (**AGENT-003**). See
[`spec.md`](./spec.md) for the buildable plan and verification steps.
