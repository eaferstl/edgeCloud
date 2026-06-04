# Spec: Agent Integration

> **Design (not yet built · `Not Started`).** This spec is a build handoff for an
> `edgecloud` MCP server (+ thin Hermes skill) that lets Edge Esmeralda attendee
> agents submit pure-compute jobs to edgeCloud and read results signed to their own
> key, and optionally enroll their machine as a worker. It introduces **no new
> network protocol or shared payload** — it is a client that replays the proven flow
> in `../scripts/e2e-client.mjs` using the existing `@edgecloud/shared` code and the
> existing HTTP API in `../server/src/http/app.js`. Full network design:
> **`../ARCHITECTURE.md`**.

## 1. Status

Status: `Not Started`
Owner: TODO (proposed Coordination / Keith; contract sign-off from Job Queue + Job Execution leads)
Team: Agent Integration
Last updated: 2026-06-04

---

## Purpose and sources

Translate `prd.md` into a buildable plan. This spec depends on:

- `prd.md`
- `../00_master_prd.md`
- `../02_integration_contracts.md`
- `../docs/architecture.md` (§10 end-to-end flow; §7.2 envelope)
- `../scripts/e2e-client.mjs` (the reference client this MCP server mirrors)
- `research/README.md` (how attendee agents are set up and what they integrate with)

---

## Implementation approach

- **What we are building:** an MCP server `@edgecloud/agent-mcp` (Node ESM, reuses `@edgecloud/shared`), plus a thin `hermes skills install edgecloud` wrapper that registers the same MCP server in Hermes. The server is stateless except for a small on-disk key/session/cache store inside the attendee's trust boundary.
- **Simplest demo path:** agent calls `edgecloud_run({ type:"js", code:"6*7" })` → tool returns `{ jobId, stdout:"42", cached:false }`. Everything else (register, sign, poll, auth, retrieve) happens inside the tool call.
- **Reuse, don't re-implement:** `buildManifest` (`../shared/src/manifest.js`), `buildJobZipB64` (`../shared/src/zip.js`), `createEnvelope` + signing (`../shared/src/envelope.js`, `../shared/src/crypto.js`). The flow is exactly `../scripts/e2e-client.mjs` steps 1–5.
- **Worker role:** documented one-command path to run `../worker/docker-compose.yml` with `EDGECLOUD_EMAIL=<attendee email>`; the worker self-registers via `POST /api/register-worker` (`../worker/src/register-worker.js`) and bootstraps to the genesis rendezvous multiaddrs (`../shared/src/constants.js`).
- **Intentionally not building:** in-browser/in-agent libp2p peers, a new result-delivery channel, sandbox changes, or any path that lets submitted code use the network/filesystem.

### MCP tool surface

| Tool | Input | Behavior | Output |
|---|---|---|---|
| `edgecloud_run` | `{ type:"js"\|"wasm", code?|moduleB64?, args?:string[], timeoutMs?, await?:bool }` | register-if-needed → build+sign envelope → `POST /api/jobs` → (if `await`) poll status → challenge/response → fetch result | `{ jobId, status, cached, stdout?, stderr?, exitCode? }` |
| `edgecloud_status` | `{}` | `GET /api/status` | `{ workersOnline, fleetAvailableCapacity, jobsSubmitted, registeredKeys, … }` |
| `edgecloud_get_result` | `{ jobId }` | challenge/response → `GET /api/jobs/:jobId/result` | `{ jobId, status, stdout? }` or `202 queued` |

### Configuration (mirrors how agents wire EdgeOS/Geo/Index Network)

```
EDGECLOUD_SERVER=http://146.190.123.91     # rendezvous/central server base URL
EDGECLOUD_EMAIL=<attendee email>           # same email EdgeOS verified; must be allowlisted
EDGECLOUD_KEYSTORE=~/.edgecloud/keys.json  # per-attendee key custody (do not share)
```

---

## Interfaces and contracts

All shared IDs, payloads, commands, events, and statuses must also appear in `../02_integration_contracts.md`. This module adds a **consumer** and a new **tool surface**, not a new shared payload.

### Consumed

| Input / service | Provided by | Required for demo | Notes |
|---|---|---|---|
| `POST /api/register` (`{email,pubkey}`) | Authentication | Yes | idempotent; ≤4 user keys/email (HTTP 409 on cap) |
| `POST /api/jobs` (signed envelope) | Job Queue | Yes | envelope contract `../shared/src/envelope.js` |
| `GET /api/jobs/:id/status` | Job Queue | Yes | `queued`\|`done`\|`unknown` |
| `GET /api/challenge` + `POST /api/auth/verify` | Authentication | Yes | yields 30-min session token |
| `GET /api/jobs/:id/result` (Bearer token) | Job Queue | Yes | submitter-only; 202 if not yet done |
| `POST /api/register-worker` (`{email,pubkey}`) | Job Execution | Worker role | ≤25 workers/email |
| `@edgecloud/shared` envelope/manifest/zip/crypto | Shared | Yes | reuse |

### Provided

| Output / service | Consumed by | Required for demo | Notes |
|---|---|---|---|
| `edgecloud_*` MCP tools | Attendee agents | Yes | new external interface; defined above |
| Signed job envelopes | Job Queue | Yes | identical shape to the webform's |
| Registered worker node | Job Execution / Device Registry | Worker role | visible in `GET /api/status` |

---

## Data and state

| Field / value | Type | Owner | Notes |
|---|---|---|---|
| keypair (per attendee email) | Ed25519 (tweetnacl) | this module | persisted in `EDGECLOUD_KEYSTORE`; reused to respect the 4-key cap (see `../scripts/e2e-client.mjs:19-28`) |
| session token | string | this module | cached up to `SESSION_TTL_MS` (30 min) |
| jobId → result | cache | edgeCloud server | dedup is server-side; identical code → cache hit |

---

## Error cases and fallback

| Case | Expected behavior | Demo impact | Notes |
|---|---|---|---|
| Email not allowlisted | tool returns a clear "not on attendee list" error (HTTP 403) | Blocks that agent | same gate as the webform |
| Key cap exceeded | HTTP 409; reuse the existing persisted key instead of minting a new one | Avoidable | keystore reuse prevents this |
| No worker online | `await` times out with `status:"queued"` (HTTP 202) | Result delayed | retry later via `edgecloud_get_result` |
| Code uses network/filesystem | job fails in the sandbox (no egress / no `/data`) | Returns error stdout/stderr | by design — see Known limitations in `prd.md` |
| Payload > 4 MiB / output > 256 KiB | rejected (`invalid envelope`) / output truncated | Graceful | `../shared/src/constants.js` |
| Wrong key fetches result | HTTP 403 | Demonstrates privacy gate | negative check in `../scripts/e2e-client.mjs:92-108` |

---

## Likely files or modules

| Path | Expected change | Notes |
|---|---|---|
| `agent_integration/mcp/package.json` | new | `@edgecloud/agent-mcp`; depends on `@edgecloud/shared` + an MCP SDK |
| `agent_integration/mcp/src/server.js` | new | MCP server: tool registration + transport |
| `agent_integration/mcp/src/client.js` | new | edgeCloud client (the `e2e-client.mjs` flow, factored for reuse) |
| `agent_integration/mcp/src/keystore.js` | new | key custody + session cache |
| `agent_integration/skill/` | new | thin Hermes skill manifest pointing at the MCP server |
| `agent_integration/README.md` | new | attendee setup (submitter + worker enrollment) |

---

## What an implementer needs before coding

- [ ] An allowlisted Edge Esmeralda attendee email for testing against the live server.
- [ ] Confirmation of the target MCP SDK / transport (stdio vs HTTP) for Hermes + Claude Desktop.
- [ ] Owner assignment and Coordination ratification of this module into `../00_master_prd.md`.
- [ ] Verification steps below are runnable by another person or agent.

---

## Verification

Manual check (baseline already passes today — the MCP server must reproduce it):

```bash
# proves the exact flow the MCP server wraps, against the live server
node ../scripts/e2e-client.mjs http://146.190.123.91 <attendee-email> "6 * 7" --expect 42

# once the MCP server exists, drive it with an MCP inspector / the agent harness:
#   edgecloud_run({ type:"js", code:"6*7", await:true })  -> stdout "42"
#   edgecloud_status({})                                  -> workersOnline >= 1
```

Expected result:

```text
e2e-client: [5] result ... "42"  + [6] stranger fetch -> 403  + PASS
MCP: edgecloud_run returns { stdout:"42", cached:false }; a second identical call returns cached:true
```

Integration check:

- [ ] An attendee agent (Hermes or Claude Desktop) loads the MCP server and runs a job end-to-end.
- [ ] Result is gated to the submitting agent's key (stranger gets 403).
- [ ] At least one enrolled worker (the worker role) executes a job and shows in `GET /api/status`.
- [ ] Relevant tasks, risks, or cuts are updated in the top-level docs.

---

## Open questions and cuts

| Item | Owner | Decision needed | Status |
|---|---|---|---|
| MCP transport: stdio vs HTTP+token (to match hosted/Telegram agents) | TODO | Which the target harnesses support best | Not Started |
| Where the key custody process runs for hosted agents | TODO | Attendee-local vs experiment-hosted (trust boundary) | Not Started |
| Should worker enrollment be in-scope for the demo or a follow-up | Coordination | Demo scope | Not Started |
| Ratify `agent_integration/` as a module in `../00_master_prd.md` | Coordination / Keith | Add team row + acceptance | Not Started |
