# Integration Contracts

## 1. Purpose

This file defines the shared technical contracts between teams.

If a team-local `spec.md` conflicts with this file, this file wins until the conflict is resolved.

---

## 0. AS-BUILT CONTRACTS (authoritative, 2026-06-03)

The prototype is implemented. The concrete, running contracts are documented in
**`ARCHITECTURE.md`** and the code under `shared/src/`. Summary:

**OrbitDB databases** (names in `shared/src/constants.js`; all open-write, app-level
Ed25519 auth; no raw emails ever stored):

| DB | Type | Producer → Consumer | Payload |
|---|---|---|---|
| `edgecloud-registry-v1` | events | Server → Workers | `{ pubkey, emailHmac, addedAt, attestedBy, attestSig }` |
| `edgecloud-jobs-v1` | events | Server (for browser) → Workers | job envelope (below) |
| `edgecloud-claims-v1` | events | Worker → Workers | `{ jobId, peerId, round, ts }` |
| `edgecloud-results-v1` | documents (`_id`=jobId) | Worker → Server → browser | result envelope (below) |
| `edgecloud-servers-v1` | events | Server → all | `{ serverPubkey, multiaddrs, label, addedAt, endorsedBy, endorseSig }` |

**Job envelope**: `{ v, jobId=sha256(zipB64), zipB64, pubkey, sig (over jobId hex),
submittedAt, nonce }`. zip = deterministic STORE zip of `manifest.json` +
`main.js`|`module.wasm`.
**Manifest**: `{ v, type:"js"|"wasm", entry, args, timeoutMs, command? }`. stdout is
the output.
**Result**: `{ v, jobId, stdout, stderr, exitCode, ok, error, executedBy, startedAt,
timestamp }`.

**HTTP endpoints (central server)**: `POST /api/register`, `GET /api/challenge`,
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
- [ ] Elliot / Job Queue
- [ ] Steve / Job Execution
- [ ] Maroua / Job Execution
- [ ] Keith / Coordination
- [ ] Legal, if presentation claims depend on these contracts

---

## 3. Shared objects

Team leads should fill this out.

| Object | Field / ID | Owner | Used By | Status | Notes |
|---|---|---|---|---|---|
| User / Session | TODO | Authentication | TODO | Not Started |  |
| Device | TODO | Device Registry | TODO | Not Started |  |
| Job | TODO | Job Queue | TODO | Not Started |  |
| Worker / Executor | TODO | Job Execution | TODO | Not Started |  |
| Result | TODO | Job Execution / Job Queue | TODO | Not Started |  |

---

## 4. Shared statuses

Team leads should define agreed statuses.

### User / Session status

| Status | Meaning | Owner |
|---|---|---|
| TODO | TODO | Authentication |

### Device status

| Status | Meaning | Owner |
|---|---|---|
| TODO | TODO | Device Registry |

### Job status

| Status | Meaning | Owner |
|---|---|---|
| TODO | TODO | Job Queue |

### Execution status

| Status | Meaning | Owner |
|---|---|---|
| TODO | TODO | Job Execution |

---

## 5. Cross-team dependencies

| Producer | Consumer | What is shared | Required for demo | Status | Notes |
|---|---|---|---|---|---|
| Authentication | Job Queue | TODO | Yes | Not Started |  |
| Device Registry | Job Execution | TODO | Yes | Not Started |  |
| Device Registry | Job Queue | TODO | TODO | Not Started |  |
| Job Queue | Job Execution | TODO | Yes | Not Started |  |
| Job Execution | Job Queue | TODO | Yes | Not Started |  |
| Coordination | All teams | TODO | Yes | Not Started |  |
| Legal | Coordination | Approved presentation language | Yes | Not Started |  |

---

## 6. Required calls / APIs / events

Do not fill this with invented endpoints. Team leads should decide.

| ID | Name | Producer | Consumer | Request / Input | Response / Output | Status |
|---|---|---|---|---|---|---|
| API-001 | TODO | Authentication | TODO | TODO | TODO | Not Started |
| API-002 | TODO | Device Registry | TODO | TODO | TODO | Not Started |
| API-003 | TODO | Job Queue | TODO | TODO | TODO | Not Started |
| API-004 | TODO | Job Execution | TODO | TODO | TODO | Not Started |

---

## 7. Draft happy path

Coordination and team leads should refine this.

```text
TODO: Define final demo path.

Possible shape:

1. User/session is available.
2. Device is registered or available.
3. Job is submitted.
4. Job is queued.
5. Worker/device receives or claims job.
6. Worker/device executes job.
7. Result/status is reported.
8. Demo shows final status/result.
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
| TODO | TODO | TODO | Not Started |  |
