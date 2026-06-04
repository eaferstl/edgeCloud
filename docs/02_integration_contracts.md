# Integration Contracts

## 1. Purpose

This file defines the shared technical contracts between teams — the boundary where modules meet.

Team PRDs define each module's responsibility, team specs define local implementation, and this file defines the shared boundary. **Detailed canonical shapes** (full schemas, protocol framing, constants) live in `docs/architecture.md`; this file is the **boundary ledger** teams ratify and freeze.

---

## 0. AS-BUILT CONTRACTS (authoritative, 2026-06-03)

The prototype is implemented. The concrete, running contracts are documented in
**`ARCHITECTURE.md`** and the code under `shared/src/`. Summary:

**OrbitDB databases** (names in `shared/src/constants.js`; all open-write, app-level
Ed25519 auth; no raw emails ever stored):

| DB | Type | Producer → Consumer | Payload |
|---|---|---|---|
| `edgecloud-registry-v1` | events | Server → Workers | `{ pubkey, emailHmac, role, addedAt, attestedBy, attestSig }` — `role`∈{`user`,`worker`}, advisory (not in the signed attestation message; legacy entries ⇒ `user`) |
| `edgecloud-jobs-v1` | events | Server (for browser) → Workers | job envelope (below) |
| `edgecloud-claims-v1` | events | Worker → Workers | `{ v, jobId, workerKey, round, ts, sig }` — **signed**; `workerKey` = registered worker's base64 Ed25519 pubkey; `sig` over `jobId\|workerKey\|round` |
| `edgecloud-results-v1` | documents (`_id`=jobId) | Worker → Server → browser | result envelope (below), **signed** by the worker |
| `edgecloud-servers-v1` | events | Server → all | `{ serverPubkey, multiaddrs, label, addedAt, endorsedBy, endorseSig }` |

**Job envelope**: `{ v, jobId=sha256(zipB64), zipB64, pubkey, sig (over jobId hex),
submittedAt, nonce }`. zip = deterministic STORE zip of `manifest.json` +
`main.js`|`module.wasm`.
**Manifest**: `{ v, type:"js"|"wasm", entry, args, timeoutMs, command? }`. stdout is
the output.
**Result**: `{ v, jobId, stdout, stderr, exitCode, ok, error, executedBy, startedAt,
timestamp, sig }`. `executedBy` = the executing worker's base64 Ed25519 identity key;
`sig` = its signature over the canonical result (excluding `sig`/`_id`). Verified before
caching/serving.

**HTTP endpoints (central server)**: `POST /api/register` (user key, ≤4/email),
`POST /api/register-worker` (worker key, ≤25/email), `GET /api/challenge`,
`POST /api/auth/verify`, `POST /api/jobs`, `GET /api/jobs/:id/status`,
`GET /api/jobs/:id/result` (challenge/response-gated to the submitter),
`GET /api/modules`, `GET /api/dbinfo`, `GET /api/status`,
`GET /api/registry/:pubkey`, `POST /api/admin/endorse` (localhost-only).

**Identity/auth**: per-user Ed25519 keypair (browser, localStorage). Per-server
Ed25519 key attests registrations; trust chains from a genesis key via
`edgecloud-servers`. Result access uses challenge/response signed by the user key.

The placeholder tables below are retained for historical/process reference.

---

## 2. Contract status

Status: `Demo Ready` (as-built; see §0 and ARCHITECTURE.md)  
Owner: Keith / Coordination  
Contract version: 1 (2026-06-03)  
Frozen: No  
Frozen at: TODO  
Approved by:

- [ ] Kevin / Authentication
- [ ] Chao / Device Registry
- [ ] Cam / Job Queue
- [ ] Eliot / Job Queue
- [ ] Steve / Job Execution
- [ ] Maroua / Job Execution
- [ ] Keith / Coordination
- [ ] Legal, if presentation claims depend on these contracts

---

## 3. Shared objects

Boundary summary. Full field lists/types in `docs/architecture.md` §7.

| Object | Key fields | Owner (writer) | Used by (reader) | Status | Spec |
|---|---|---|---|---|---|
| Identity / PeerId | persisted Ed25519 keypair → `peerId` | Authentication | All | Building | arch §6 |
| Device document | `_id`(=peerId), `cpu{cores,load1m,…}`, `ram{totalBytes,freeBytes}`, `storage{…}`, `latencyMs`, `status`, `maxConcurrent`, `currentLoad`, `availableCapacity`, `lastSeen`, `signature` | Device Registry (Execution writes capacity) | Job Queue | Building | arch §7.1 |
| JobOffer | `type`, `jobId`, `submitterPeerId`, `spec{image,cmd,env,timeoutMs,requirements}`, `createdAt`, `signature` | Job Queue (submitter) | Job Execution (worker) | Not Started | arch §7.2 |
| JobResponse | `type`, `jobId`, `workerPeerId`, `accepted`, `reason?`, `signature` | Job Execution (worker) | Job Queue (submitter) | Not Started | arch §7.3 |
| JobResult | `type`, `jobId`, `workerPeerId`, `stdout`, `stderr`, `exitCode`, `durationMs`, `signature` | Job Execution (worker) | Job Queue (submitter) | Not Started | arch §7.4 |

> v1 "auth" = peer/device identity + payload signing. There is **no** separate user-account/login object; a USER is represented by their node's `peerId`.

---

## 4. Shared statuses

### Node status (`status` on the device document)

Owner: Device Registry (seeds it); updated by Job Execution at runtime.

| Status | Meaning |
|---|---|
| `available` | Accepting offers; has free capacity. |
| `draining` | Finishing current jobs; refuses new offers. |
| `offline` | Unreachable / `lastSeen` older than 15s. |

### Job status (submitter's view)

Owner: Job Queue.

| Status | Meaning |
|---|---|
| `queued` | Submitted, not yet offered. |
| `offered` | Offered to a candidate worker. |
| `accepted` | Worker accepted; will run. |
| `running` | Executing in Docker. |
| `completed` | Result received and verified. |
| `failed` | No candidate / rejected everywhere / timeout / untrusted result. |

> Not a strict-FIFO / exactly-once queue: assignment is a **retryable offer**; workers are **idempotent on `jobId`** and may reject a re-offer with `reason:"duplicate"` (arch §8).

---

## 5. Cross-team dependencies (the four contracts)

| # | Producer | Consumer | What is shared | Required | Status |
|---|---|---|---|---|---|
| 1 | Device Registry (Execution writes capacity) | Job Queue | `device-registry` OrbitDB document schema (arch §7.1) | Yes | Building |
| 2 | Authentication | All teams | `sign` / `verify` / `canonicalJSON` + persisted PeerId + error contract (arch §6) | Yes | Blocked |
| 3 | Job Queue ↔ Job Execution | both | libp2p stream `/edgecloud/jobs/1.0.0`: JobOffer → JobResponse → JobResult (arch §7.2–7.4) | Yes | Not Started |
| 4 | Job Execution | Device Registry | capacity write-backs (`currentLoad` / `availableCapacity` / `status`) on accept / complete / fail (arch §10) | Yes | Not Started |
| — | Coordination | All teams | per-node bootstrap wiring (libp2p + OrbitDB + modules), shared constants (arch §12–13) | Yes | Not Started |
| — | Legal | Coordination | approved presentation language | Yes | Not Started |
| — | Job Queue / Authentication / Job Execution | Agent Integration | HTTP API consumed unchanged: `/api/register`(-worker), `/api/jobs`, `/api/challenge`+`/api/auth/verify`, `/api/jobs/:id/{status,result}` (+ signed envelope contract) | Proposed | Proposed — new consumer only, no payload change; `agent_mcp_integration/spec.md`, D-012 |

---

## 6. Required calls / APIs / events

| ID | Name | Producer | Consumer | Input | Output | Status |
|---|---|---|---|---|---|---|
| API-001 | `sign(payload)` | Authentication | All | payload object (no `signature`) | base64 signature string | Blocked |
| API-002 | `verify(payload, signature, peerId)` | Authentication | All | payload, signature, peerId | boolean; `false` ⇒ drop & don't act (arch §6) | Blocked |
| EVT-001 | device-registry `put` (OrbitDB documents) | Device Registry / Execution | Job Queue | signed Device document keyed by `_id` | replicated CRDT state | Building |
| STREAM-001 | `/edgecloud/jobs/1.0.0` (libp2p) | Job Queue ↔ Execution | both | JobOffer | JobResponse, then JobResult | Not Started |

Shared constants (protocol id, DB name `device-registry`, fitness weights `0.5/0.3/0.2`, timings `5s/15s`) are canonical in `docs/architecture.md` §12.

---

## 7. Happy path

```text
1. Node boots, loads persisted PeerId, discovers peers (DNS bootstrap + mDNS).
2. Device Registry writes the signed device document to `device-registry` (status=available).
3. Submitter builds a signed JobOffer.
4. Job Queue scores candidates from its local registry replica (fitness: latency .5 / size .3 / load .2).
5. Submitter opens `/edgecloud/jobs/1.0.0` to the top candidate and sends the JobOffer.
6. Worker verifies, checks capacity, replies JobResponse{accepted}. Reject/timeout ⇒ next candidate.
7. On accept, Execution decrements its own capacity (write-back), runs the job in Docker.
8. Worker streams a signed JobResult (stdout/stderr/exitCode/durationMs); submitter verifies and displays.
9. Execution restores capacity (write-back); the registry is fresh for the next scoring round.
```

---

## 8. Contract-change rule

After this file is marked frozen, any change to shared IDs, payloads, statuses, APIs, events, or cross-team assumptions requires approval from:

- Keith / Coordination
- the producing team lead
- the consuming team lead

Approved contract changes must be recorded in `04_decisions_risks_cuts.md`.

---

## 9. Open contract questions

| Question | Owner | Needed By | Status | Resolution |
|---|---|---|---|---|
| Deterministic registry address mechanism (fixed manifest vs. access-controller) — confirm approach | Device Registry + Coordination | before integration | Open | arch A-1 |
| `latencyScore` source: shared-anchor RTT (today) vs. per-peer libp2p ping | Job Queue | before scoring tuning | Open | arch A-2 |
| Auth module delivery — blocks every signed path | Authentication | ASAP | Open | see B-001 in `04_decisions_risks_cuts.md` |
