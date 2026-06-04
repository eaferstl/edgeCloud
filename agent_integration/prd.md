# PRD: Agent Integration

## Status

Status: `Not Started` (proposed — pending Coordination ratification into `../00_master_prd.md`)
Owner: TODO (proposed: Coordination / Keith, with Job Queue + Job Execution as contract owners)
Team: Agent Integration
Last updated: 2026-06-04

---

## Module purpose

Let Edge Esmeralda attendees' AI agents use edgeCloud as an on-demand compute fabric. An attendee's agent (Hermes, OpenClaw, or Claude Desktop — see `research/README.md`) gains an `edgecloud` tool surface that lets it **submit pure-compute jobs** to the network and **read back results signed to its own key**, and optionally **enroll the attendee's machine as a worker** that earns by running others' jobs.

This is a module PRD, not a standalone product PRD. It composes existing edgeCloud subsystems (Job Queue HTTP bridge, Authentication allowlist, Job Execution workers) behind an agent-facing tool surface; it does not change the network's protocols.

The integration is gated by the **same Edge Esmeralda attendee email allowlist** edgeCloud already enforces (`server/src/http/app.js` → `q.emailAllowed`). The agent experiment verifies that same email during its own onboarding, so an enrolled attendee's agent is authorized by construction.

---

## Owned responsibilities

- **MCP server** (`@edgecloud/agent-mcp`) exposing edgeCloud as agent tools (`edgecloud_run`, `edgecloud_status`, `edgecloud_get_result`), usable by any MCP-speaking harness.
- **Thin Hermes skill** wrapper (`hermes skills install edgecloud`) that points the recommended onboarding path at the MCP server.
- **Key custody**: generate + persist the agent's Ed25519 keypair (tweetnacl), self-register it against the attendee email (≤4 user keys), and keep it inside the attendee's own trust boundary.
- **Submitter flow**: replicate the proven client sequence in `../scripts/e2e-client.mjs` — build manifest+zip, sign the envelope, `POST /api/jobs`, poll status, do challenge/response, fetch the gated result.
- **Worker enrollment helper**: a documented one-command path to run the existing `../worker/` Docker node with `EDGECLOUD_EMAIL` set (≤25 workers/email).

---

## Not owned

- The edgeCloud server, OrbitDB/libp2p network, or worker sandbox internals (owned by Coordination / Job Queue / Job Execution).
- The agent harness itself (Hermes/OpenClaw) and its model inference (OpenRouter) — out of scope.
- The EdgeOS / Geo / Index Network MCP servers the agents also use — separate experiment surfaces.
- Any change to the signed envelope, manifest, claim, or trust contracts. This module is a **consumer** of those contracts.
- Hardening the sandbox to safely run network- or filesystem-using agent code (it cannot — see Known limitations).

---

## Inputs and dependencies

| Needed from | What Agent Integration needs | Required for demo | Notes |
|---|---|---|---|
| Job Queue | `POST /api/jobs`, `GET /api/jobs/:id/status`, `GET /api/jobs/:id/result` | Yes | submitter path; contract unchanged |
| Authentication | `POST /api/register`, `GET /api/challenge`, `POST /api/auth/verify`; attendee email allowlist | Yes | identity + gated result retrieval |
| Shared contracts | `@edgecloud/shared` `envelope`/`manifest`/`zip`/`crypto` | Yes | reuse, do not re-implement |
| Job Execution | `../worker/` Docker node + `POST /api/register-worker` | For worker role | needed only when an attendee contributes compute |
| Agent experiment | Attendee email already verified by EdgeOS onboarding | Yes | same allowlist edgeCloud gates on |

---

## Outputs and handoffs

| Agent Integration provides | Consumed by | Defined in | Notes |
|---|---|---|---|
| Signed job envelopes (same shape as the webform) | Job Queue (`/api/jobs`) | `../02_integration_contracts.md` | no new payload — reuses the envelope contract |
| Registered worker nodes | Job Execution / Device Registry | `../02_integration_contracts.md` | reuses `/api/register-worker` |
| `edgecloud_*` MCP tool surface | Attendee agents (Hermes/OpenClaw/Claude Desktop) | `spec.md` | the only new external interface |

Shared IDs, payloads, commands, events, or statuses must also be reflected in `../02_integration_contracts.md`. This module introduces **no new shared payloads** — only a new consumer.

---

## Demo acceptance

Agent Integration is good enough for the demo when:

- [ ] An attendee's agent, given only its allowlisted email, can call `edgecloud_run` and get back the correct result of a pure-compute job (e.g. a JS expression or a WASM module).
- [ ] The result is readable by that agent's key only (challenge/response), demonstrably not by another attendee's agent.
- [ ] At least one attendee machine can be enrolled as a worker with one documented command and appears in `GET /api/status`.
- [ ] The agent harness used in the demo (Hermes or Claude Desktop) loads the tool surface via standard MCP config.
- [ ] Relevant contracts are current in `../02_integration_contracts.md`.
- [ ] The implementation check in `spec.md` passes.
- [ ] Presentation wording is cleared with Legal (`../legal/spec.md`) — esp. any "your agent runs on the swarm" framing.

---

## Known limitations

- **Pure compute only.** edgeCloud workers are a hermetic sandbox: no network egress and no filesystem access (decisions D-008/D-010 in `../04_decisions_risks_cuts.md`). Code that calls an LLM, hits EdgeOS, or fetches a URL will fail by design. Agents offload deterministic, self-contained sub-tasks (scoring, simulation, transforms, crypto, WASM workloads) — never their agentic loop.
- **Key custody is a trust boundary.** Whoever holds the agent's Ed25519 key can read that agent's results. For hosted/Telegram-resident agents the MCP server must run inside the attendee's own trust boundary, not be shared.
- **Not a confidentiality or safety boundary for arbitrary code** (`../THREAT_MODEL.md`). Do not claim otherwise.
- **Hard caps:** ≤4 user keys and ≤25 workers per email; job timeout ≤60s (default 10s); payload ≤4 MiB base64; captured output ≤256 KiB (`../shared/src/constants.js`).
- **Liveness:** a result requires at least one worker online; otherwise the job stays `queued` (HTTP 202) until one appears.
