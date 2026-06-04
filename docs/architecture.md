# edgeCloud — High-Level Architecture (v1)

## 0. Status & how to use this document

Status: `Building`
Owner: Coordination
Last updated: 2026-06-03
Scope: v1 prototype — decentralized **serverless function execution**, scheduled by lowest latency.

This is the **shared technical reference** for the prototype. Its job is to keep the
parallel teams (`auth/`, `device_registry/`, `job_queue/`, `job_execution/`,
`coordination/`) consistent on:

- the **vocabulary** (what we call things),
- the **canonical schemas** (the exact shape of shared objects),
- the **interfaces / protocols** between subsystems,
- the **language and stack** (JavaScript / Node.js),
- the **constants** (protocol IDs, database names, weights, timeouts).

### Relationship to the other docs

This document is a *technical* reference; it does not override the governance docs.
Authority order (from `AGENTS.md`) still holds: `00_master_prd.md` →
`02_integration_contracts.md` (the freezable cross-team contract ledger) → team docs.
As teams ratify pieces of this file, mirror the agreed contracts into
`02_integration_contracts.md` (that is what gets frozen). Items still undecided are
marked **OPEN** — do not silently invent a different answer; raise it.

### Ratified decisions (2026-06-03)

These were decided by the project owner and are canonical. Where a decision differs from
the current `device_registry/index.js` spike, the **code is expected to change** — see
the registry punch-list in §15.

| # | Decision |
|---|---|
| D-A | **Device schema** = the registry spike's nested, bytes-based record, **extended** with `status`, `currentLoad`, `availableCapacity`, `maxConcurrent` (§7.1). |
| D-B | **Discovery** = DNS-addressed bootstrap (coordinator/relay) + mDNS. **No DHT** in v1. |
| D-C | **Registry convergence** = a **deterministic, well-known OrbitDB address** (fixed manifest/access-controller), not out-of-band address sharing. |
| D-D | **Timing** = **5s** heartbeat / **15s** stale-offline threshold. |
| D-E | **Peer identity** = **persisted** libp2p keypair; stable `PeerId` across restarts. |
| D-F | **Signing** = `sign`/`verify` at every trust boundary is **required for demo-ready** (currently unimplemented — a blocker, §6). |
| D-G | **Env vars** = `EDGECLOUD_`-prefixed convention (§14). |
| D-H | **Node.js** = **20 LTS** minimum. |

---

## 1. What we are building (v1)

A user submits a small containerized job. Participating devices ("nodes") discover each
other peer-to-peer, share a live registry of who is available and how loaded they are, and
the submitter streams the job directly to the best-fit node. That node runs the job in
Docker and streams the result back.

**The sweet spot we are targeting** (day-1 Venn diagram): the intersection of
*performance/ease*, *decentralization*, and *local-first* — real compute that runs on the
nearest capable peer, coordinated without a central scheduler.

### In scope (v1)

- Peer discovery (DNS bootstrap + mDNS).
- A replicated **device registry** of node specs/status (OrbitDB CRDT).
- **Identity + signing** of every cross-node message (required for demo-ready).
- A **scheduler** ("job queue") that scores candidates and offers the job to the best one.
- **Execution** of a job in a Docker container, capturing stdout/stderr/exit code.
- **Result delivery** back to the submitter.

### Out of scope (v1)

- DHT-based WAN discovery (deferred; we assume a DNS-reachable coordinator/relay).
- The "cheapest node" pricing dimension (reserved; see §8).
- Strict FIFO ordering or exactly-once delivery guarantees (see §8, §9.2).
- Production-grade security, sandbox isolation guarantees, billing, or compliance.
  Keep all presentation claims within `legal/spec.md`.

> **Runtime:** v1 nodes are **Node.js processes running Docker**, deployed on VMs / hosts
> (cloud VM, server, or laptop). No mobile target in v1.

---

## 2. Architecture at a glance

```text
        ┌─────────────┐   ┌─────────────┐   ┌─────────────┐
        │   Node A     │   │   Node B     │   │   Node C     │
        │ (submitter)  │   │  (worker)    │   │  (worker)    │
        └─────────────┘   └─────────────┘   └─────────────┘
              │                  │                  │
   ┌──────────┴──────────────────┴──────────────────┴──────────┐
   │  Per-node process (Node.js 20)                              │
   │  ┌──────────┐ ┌──────────────┐ ┌───────────┐ ┌──────────┐  │
   │  │   Auth    │ │ Device       │ │ Job Queue │ │Execution │  │
   │  │ sign/     │ │ Registry     │ │ fitness + │ │ Docker   │  │
   │  │ verify    │ │ presence     │ │ offer     │ │ runner   │  │
   │  └──────────┘ └──────────────┘ └───────────┘ └──────────┘  │
   └────────────────────────────────────────────────────────────┘
              │                                      │
   ┌──────────┴───────────┐              ┌───────────┴───────────┐
   │  OrbitDB             │              │  libp2p               │
   │  (shared CRDT state) │              │  (transport +         │
   │  device registry,    │              │   discovery + direct  │
   │  replicated via      │              │   job streams)        │
   │  gossipsub           │              │   TCP / noise / yamux │
   └──────────────────────┘              └───────────────────────┘
```

- **OrbitDB** (on **Helia**/IPFS) = the shared, eventually-consistent (CRDT) state. The
  **device registry** lives here as a `documents` store and replicates to every node over
  **gossipsub**. This is the "read the device store" surface the scheduler scores against.
  All nodes converge on it via a **deterministic, well-known address** (D-C).
- **libp2p** = transport. Discovery is a **DNS-addressed bootstrap** to a coordinator/relay
  (`/dnsaddr/…`) plus **mDNS** for same-LAN peers — **no DHT** in v1. It also carries the
  **direct, point-to-point job streams** (offer → response → result). Transport TCP,
  encryption noise, muxing yamux, plus the identify service.
- Every node runs the **same code** and can act as submitter and/or worker.

---

## 3. Technology stack & language conventions

| Concern | Choice (v1) | Notes |
|---|---|---|
| Language | **JavaScript**, Node.js **20 LTS** min, **ES modules** (`"type":"module"`) | No TypeScript required; JSDoc encouraged. Registry uses `fs.statfs` (needs ≥18.15; we standardize on 20). |
| P2P transport | **js-libp2p** over **TCP**, **noise** encryption, **yamux** muxer, **identify** | |
| Discovery | **`@libp2p/bootstrap`** (DNS `/dnsaddr/…` coordinator) + **`@libp2p/mdns`** | No DHT in v1 (D-B). |
| Shared state | **OrbitDB** (`@orbitdb/core`) on **Helia**, replicated via **`@chainsafe/libp2p-gossipsub`** | `documents` store; `blockstore-level` for blocks. |
| Execution sandbox | **Docker**, driven from Node via **dockerode** | One container per job. |
| Identity / crypto | libp2p **Ed25519** keypair → `PeerId`, **persisted** | Same key signs payloads (§6). |
| IDs | `uuid` v4 for `jobId`; libp2p `PeerId` (base58btc) for nodes | |
| Package manager | `npm` | `node_modules/` gitignored. |

**Confirmed dependency set** (from the registry spike — keep consistent across modules):

```text
helia  @orbitdb/core  blockstore-level  libp2p
@chainsafe/libp2p-gossipsub  @chainsafe/libp2p-noise  @chainsafe/libp2p-yamux
@libp2p/tcp  @libp2p/mdns  @libp2p/bootstrap  @libp2p/identify
# execution adds: dockerode      # ids: uuid
```

### Coding conventions (apply everywhere)

- **JSON field names: `camelCase`.** (`peerId`, `currentLoad`, `exitCode`, `durationMs`.)
- **Enum/string values: lowercase** (`"available"`, `"draining"`, `"offline"`).
- **Timestamps: integer epoch milliseconds** (`Date.now()`), suffix `At` or `lastSeen`.
- **Sizes from the host: bytes** with a `Bytes` suffix (`totalBytes`, `freeBytes`) — this
  matches what `os`/`fs.statfs` return, so the registry never converts. **Durations: ms**
  (`timeoutMs`, `durationMs`, `latencyMs`).
- **Protocol IDs: lowercase versioned path** (`/edgecloud/jobs/1.0.0`).
- **OrbitDB store names: dotted lowercase** (`device-registry`); convergence is by the
  deterministic address, not the name (§12).
- One subsystem ↔ one folder/module (§13). Cross-module calls go through the documented
  interface only.

---

## 4. Subsystems & ownership

| Subsystem | Team | Folder | Responsibility (one line) |
|---|---|---|---|
| Authentication | Kevin | `auth/` | Generate/persist `PeerId`; `sign(payload)` / `verify(payload, signature, peerId)`. |
| Device Registry | Chao | `device_registry/` | Discover peers; write & maintain each node's registry document. |
| Job Queue (scheduler) | Cam / Eliot | `job_queue/` | Score candidates from the registry; offer the job over a direct stream. |
| Job Execution | Steve / Maroua | `job_execution/` | Accept/reject offers; run the job in Docker; stream result; write capacity back. |
| Coordination | Keith | `coordination/` | Glue, demo path, keeps this doc and contracts in sync. |
| Legal | Legal | `legal/` | Approves all presentation claims. |

---

## 5. Shared vocabulary (glossary)

Use these exact terms in code, comments, and docs.

| Term | Meaning | Canonical variable |
|---|---|---|
| **Node** | A running Node.js process in the network. Can submit and/or work. | — |
| **PeerId** | A node's libp2p identity, derived from its persisted Ed25519 public key. | `peerId` |
| **Submitter** | The node that originates a job. | `submitterPeerId` |
| **Worker** | The node selected to execute a job. | `workerPeerId` |
| **Job** | A unit of work = a container image + command + limits. | `jobId` |
| **Device document** | One node's entry in the shared registry (specs + live status). | see §7.1 |
| **Offer** | A direct, signed message asking a worker to take a job. | `JobOffer` |
| **Response** | The worker's accept/reject of an offer. | `JobResponse` |
| **Result** | The captured output of a finished job. | `JobResult` |
| **Fitness score** | The scheduler's ranking of a candidate worker (higher = better). | `score` |

> Historical note: early notes used **LOAD-QUEUE / DEVICE-QUEUE / RESULT-QUEUE**. In v1
> these map onto: DEVICE-QUEUE → the OrbitDB **device registry**; LOAD/RESULT → **direct
> libp2p streams** (offer/result are point-to-point, not pulled from a shared queue).

---

## 6. Identity, signing & the auth contract

> **Status: REQUIRED for demo-ready, NOT YET IMPLEMENTED (blocker, D-F).** The auth module
> is still a template, and the registry spike currently writes **unsigned** records. No
> subsystem is `Demo Ready` until it signs its outgoing payloads and `verify`s at its
> boundaries. Teams should code to this interface now.

Each node generates a libp2p **Ed25519 keypair on first boot and persists it** (under
`EDGECLOUD_DATA_DIR`, D-E); its `PeerId` is derived from the public key and is **stable
across restarts**. The **same keypair signs application payloads**, so any node can verify
a message came from the claimed `PeerId` using only the `PeerId`.

### Interface (provided by `auth/`, called by everyone)

```js
/** @returns {string} base64 signature over the canonical payload */
sign(payload)

/** @returns {boolean} true iff signature is valid for payload AND peerId */
verify(payload, signature, peerId)
```

### Canonicalization (so every team signs the same bytes)

```text
signature = sign( utf8( canonicalJSON(payload without its `signature` field) ) )
```

`canonicalJSON` = `JSON.stringify` with **keys sorted lexicographically**, no extra
whitespace; the `signature` field is excluded from the signed bytes. **All teams import
the one shared `canonicalJSON` helper** (§13) — do not hand-roll it.

### Error contract (what happens when verification fails)

`verify` returns `false` (never throws on a merely-invalid signature). At **every trust
boundary** the caller MUST drop the message and not act:

| Boundary | Who verifies | On failure |
|---|---|---|
| Job submission (`JobOffer` received) | Worker | Do **not** run. Reply `JobResponse {accepted:false, reason:"invalid-signature"}`, close. |
| Stream offer / response | Both ends | Drop the stream; scheduler treats as a reject and falls through to next candidate. |
| Result delivery (`JobResult` received) | Submitter | Discard result; mark job `failed`, reason `untrusted-result`. |
| Registry write (device document) | Reader before scoring | Ignore the unsigned/invalid document; treat that node as unschedulable. |

A node MUST sign **device documents, jobs, responses/claims, and results**. Reserved
reason strings: `invalid-signature`, `untrusted-result`.

---

## 7. Canonical schemas

These are the shared objects. **Field names and types here are the source of truth.**

### 7.1 Device document — OrbitDB `documents` store `device-registry`

Keyed by `_id` (== the node's `peerId`). Replicated to all nodes via gossipsub.
**Base fields** are already written by `device_registry/index.js`; **added fields** (D-A)
must be introduced so the Execution→Registry write-back (contract #4) and status-based
filtering work. **Read by** the Job Queue fitness function.

```js
{
  // --- base (registry writes; present in the spike today) ---
  _id: "12D3Koo...",          // string, == peerId (libp2p), documents key
  hostname: "worker-01",      // string
  storage: { totalBytes: 5.0e11, freeBytes: 2.1e11 }, // numbers, bytes (fs.statfs)
  ram:     { totalBytes: 1.7e10, freeBytes: 8.0e9 },  // numbers, bytes (os.*mem)
  cpu: {
    model: "Apple M2",        // string
    cores: 8,                 // number, logical cores
    arch: "arm64",            // string (os.arch)
    platform: "darwin",       // string (os.platform)
    load1m: 1.42              // number, 1-min OS load average; [0] on Windows
  },
  latencyMs: 23,              // number | null, RTT to the DNS anchor host
  lastSeen: 1717430400000,    // number, epoch ms — heartbeat liveness

  // --- added (D-A); Registry seeds, Execution updates on accept/complete/fail ---
  status: "available",        // "available" | "draining" | "offline"
  maxConcurrent: 4,           // number, max simultaneous jobs this node accepts
  currentLoad: 1,             // number, edgeCloud jobs running now (integer ≥ 0)
  availableCapacity: 3,       // number, free slots = maxConcurrent - currentLoad

  // --- reserved ---
  pricePerJobUsd: null        // number | null — reserved for later (cheapest-node)
}
```

Notes:
- **`cpu.load1m`** (host load average) and **`currentLoad`** (count of edgeCloud jobs) are
  different signals — keep both. The scheduler's *load* term uses `currentLoad` /
  `availableCapacity`; `cpu.load1m` is a secondary signal.
- **`latencyMs`** is RTT to the shared DNS anchor host (a coarse "how well connected am I"),
  not GPS and not per-peer. Per-peer libp2p ping RTT is a later refinement (§15).
- The fields the fitness function depends on — `cpu.cores`, `ram.totalBytes`,
  `currentLoad`, `availableCapacity`, `status`, `lastSeen`, `latencyMs` — MUST be present
  and consistently written.

### 7.2 `JobOffer` — libp2p stream, submitter → worker

```js
{
  type: "JobOffer",
  jobId: "9f1c...-uuid",      // string, uuid v4
  submitterPeerId: "12D3...",
  spec: {
    image: "alpine:3.20",     // string, docker image reference
    cmd: ["sh","-c","echo hi"], // string[], command + args
    env: {},                  // object<string,string>, optional
    timeoutMs: 60000,         // number, hard execution timeout
    requirements: { minRamMb: 256, minCpuCores: 1 } // optional minimums
  },
  createdAt: 1717430400000,   // number, epoch ms
  signature: "base64..."      // string, see §6
}
```

### 7.3 `JobResponse` — libp2p stream, worker → submitter

```js
{ type:"JobResponse", jobId, workerPeerId, accepted:true,  signature }
{ type:"JobResponse", jobId, workerPeerId, accepted:false, reason:"at-capacity", signature }
```

Reserved `reason` values: `at-capacity`, `requirements-unmet`, `invalid-signature`,
`draining`, `duplicate`.

### 7.4 `JobResult` — libp2p stream, worker → submitter (after an accept)

```js
{
  type: "JobResult",
  jobId: "9f1c...-uuid",
  workerPeerId: "12D3...",
  stdout: "hi\n",             // string
  stderr: "",                 // string
  exitCode: 0,                // number, container exit code
  durationMs: 412,            // number, execution wall time
  signature: "base64..."
}
```

All four message types carry a `signature` over every field except `signature` itself.

---

## 8. Scheduling: the fitness function

The scheduler reads its **local OrbitDB replica** of `device-registry`, filters to
schedulable candidates, scores them, and offers the job to the highest scorer.

> **Honesty constraint (from `job_queue/spec.md`):** this is **not** a strict-FIFO,
> exactly-once queue. Treat assignment as a **claim/offer that may be retried**; workers
> must be **idempotent on `jobId`** and may reject a re-offer with `reason:"duplicate"`.
> Do not present FIFO or exactly-once guarantees in the demo.

### Candidate filter (hard constraints)

A device is a candidate only if:

- `status === "available"`, and
- `availableCapacity >= 1`, and
- `lastSeen` is within `OFFLINE_THRESHOLD_MS` (15s) of now, and
- it satisfies `spec.requirements` (`ram.totalBytes >= minRamMb*1e6`, `cpu.cores >= minCpuCores`).

### Score (higher is better)

```text
score = w_latency * latencyScore + w_size * sizeScore + w_load * loadScore
w_latency = 0.5   // prefer closest (localization)
w_size    = 0.3   // prefer smaller node (decentralization)
w_load    = 0.2   // prefer less-loaded node
```

Each sub-score is normalized to `[0,1]`, higher = more desirable:

- `latencyScore` — higher when `latencyMs` is lower (per-peer libp2p RTT later). **Latency
  weighted highest**, matching "closest node first."
- `sizeScore` — higher when the node is **smaller** (lower `ram.totalBytes` / `cpu.cores`).
- `loadScore` — higher when `currentLoad` is lower / `availableCapacity` higher.

**Tie-break:** lower `currentLoad`, then lexicographically lower `peerId` (deterministic).

> `pricePerJobUsd` exists in the schema but the "cheapest node" dimension is **reserved**
> for a later version — not in the v1 weights.

### Offer & fall-through

1. Rank candidates by `score` (desc).
2. Open a direct libp2p stream (`PROTOCOL_JOBS`) to the top candidate; send the signed `JobOffer`.
3. Wait up to `OFFER_RESPONSE_TIMEOUT_MS` for a `JobResponse`.
4. On `accepted:false`, stream drop, or timeout → **fall through to the next candidate**.
   Repeat until accepted or the list is exhausted (→ job `failed`, reason `no-capacity`).

---

## 9. Lifecycles / state machines

### 9.1 Node status (`status` field, D-A)

The spike today only distinguishes **live vs STALE** by `lastSeen`. The canonical model
adds an explicit `status` the registry seeds and execution/operator updates:

| State | Meaning | Enters from | Transitions to |
|---|---|---|---|
| `available` | Accepting offers; has free capacity. | boot; job completes and a slot frees | `draining`, `offline` |
| `draining` | Finishing current jobs, refusing new offers. | operator signal or `availableCapacity == 0` | `available`, `offline` |
| `offline` | Unreachable / `lastSeen` older than 15s. | disconnect; stale heartbeat | `available` |

Workers reject offers with reason `draining` while draining, and `at-capacity` when
`availableCapacity == 0`.

### 9.2 Job status (submitter's view; for demo display)

```text
queued → offered → accepted → running → completed
   │         │          │          │
   │         └──reject/timeout──────┘   (→ re-offer next candidate)
   └→ failed (no candidates / no-capacity / untrusted-result / timeout)
```

Because re-offers are possible, a worker may receive the same `jobId` twice; it MUST treat
the second as a duplicate (idempotent), not run it again.

---

## 10. End-to-end flow (the closed loop)

Signed payloads marked 🔏.

1. **Boot & discover.** Each node loads its **persisted** `PeerId` (auth), starts libp2p,
   and discovers peers via the DNS-addressed bootstrap coordinator + mDNS.
2. **Register.** Device Registry writes the node's **device document** to the
   deterministic-address `device-registry` store (base fields + `status:"available"`,
   `maxConcurrent`, `availableCapacity`). OrbitDB replicates it to all nodes via gossipsub.
3. **Maintain presence.** Registry rewrites a delta (refreshing `latencyMs`, free RAM,
   `lastSeen`, status) every `HEARTBEAT_INTERVAL_MS` (5s).
4. **Submit.** A submitter builds a `JobSpec` and wraps it in a 🔏 `JobOffer`.
5. **Score.** Job Queue reads its local replica, filters + scores candidates (§8), ranks.
6. **Offer.** Submitter opens a direct libp2p stream to the top candidate, sends the 🔏 `JobOffer`.
7. **Verify & decide.** Worker `verify`s the offer (§6). If invalid → reject. Else checks
   capacity and replies 🔏 `JobResponse {accepted:true|false}`. Reject/timeout → next candidate.
8. **Accept → write-back.** Execution updates its **own** device document:
   `currentLoad += 1`, `availableCapacity -= 1` (capacity decreased).
9. **Run.** Execution `docker pull` + run with `spec.cmd`/`env` and a hard `spec.timeoutMs`;
   captures `stdout`, `stderr`, `exitCode`, `durationMs`.
10. **Deliver.** Worker streams a 🔏 `JobResult`; submitter `verify`s it and marks
    `completed` (or `failed`/`untrusted-result`).
11. **Complete → write-back.** Execution updates its document: `currentLoad -= 1`,
    `availableCapacity += 1` (capacity restored). This keeps the store fresh for the next
    **Device Registry → Job Queue** scoring round.

---

## 11. The four cross-team contracts

| # | Edge | The contract | Owner |
|---|---|---|---|
| 1 | Device Registry → Job Queue | The `device-registry` document **schema** (§7.1). Every fitness-read field defined & consistently written. | Device Registry |
| 2 | Auth → Everyone | `sign` / `verify` + the **error contract** (§6). Teams *call* verify at their boundary. | Authentication |
| 3 | Job Queue → Execution | The libp2p **stream protocol** `PROTOCOL_JOBS` carrying `JobOffer` / `JobResponse` / `JobResult` (§7.2–7.4). | Job Queue + Execution |
| 4 | Execution → Device Registry | **Event-driven write-backs** on accept / complete / failure to `currentLoad` & `availableCapacity` (§7.1 names). | Job Execution |

Changes after `02_integration_contracts.md` freezes require the `AGENTS.md` approval flow.

---

## 12. Shared constants

Define these **once** in the shared module (§13) and import everywhere. Values are v1
defaults and env-tunable.

```js
export const PROTOCOL_JOBS = "/edgecloud/jobs/1.0.0"; // libp2p stream protocol id
export const DB_DEVICES    = "device-registry";        // OrbitDB documents store name

export const FITNESS_WEIGHTS = { latency: 0.5, size: 0.3, load: 0.2 };

export const HEARTBEAT_INTERVAL_MS     = 5000;   // presence write cadence (D-D)
export const OFFLINE_THRESHOLD_MS      = 15000;  // stale → offline (3 missed beats) (D-D)
export const DEFAULT_JOB_TIMEOUT_MS    = 60000;  // used when spec.timeoutMs absent
export const OFFER_RESPONSE_TIMEOUT_MS = 5000;   // wait for accept before next candidate
```

- **Registry convergence (D-C):** all nodes open the registry at a **deterministic,
  well-known OrbitDB address** derived from a fixed manifest + access-controller, so a fresh
  node converges without anyone hand-sharing a `/orbitdb/…` string. `EDGECLOUD_REGISTRY`
  may override it for testing. (The spike currently shares the address out-of-band — see §15.)
- **Wire framing on `PROTOCOL_JOBS`:** length-prefixed UTF-8 JSON, one object per message
  (`it-length-prefixed` + `it-pipe`). Order: `JobOffer` → `JobResponse` → (if accepted) `JobResult`.

---

## 13. Module layout & verification

Target: each subsystem is an ES module exporting a small, documented surface; a `shared/`
module holds constants (§12), `canonicalJSON`, and schema validators so nothing is
duplicated. **Current reality:** `device_registry/index.js` is a standalone runnable spike
(`main()`), and `shared/` does not exist yet.

```text
edgeCloud/
  shared/            # constants (§12), canonicalJSON, schema validators — single source (TO BUILD)
  auth/              # createIdentity()/loadIdentity(), sign(), verify()                  (TO BUILD)
  device_registry/   # index.js spike → export start(orbitdb,libp2p), writeDevice(), heartbeat(), readDevices()
  job_queue/         # scoreCandidates(devices, spec), offerJob(spec) -> result            (TO BUILD)
  job_execution/     # handleOffer(stream), runJob(spec) -> {stdout,stderr,exitCode,durationMs} (TO BUILD)
  coordination/      # bootstraps a node: wires libp2p + OrbitDB + all four modules         (TO BUILD)
```

**Verification convention:** each module gets an `npm run check:<module>` script. Today:
`npm run check:device-registry` (`node --check device_registry/index.js`). Add equivalents
as modules land.

> **OPEN (module boundary):** `shared/` as a local workspace package (`@edgecloud/shared`)
> vs. a plain relative-imported folder. Default: plain folder for v1.

---

## 14. Configuration / environment

`EDGECLOUD_`-prefixed convention (D-G). The registry spike's current vars
(`BOOTSTRAP_ADDRS`, `REGISTRY_ADDRESS`, `ANCHOR_HOST/PORT`) are renamed to these:

| Var | Purpose | Default |
|---|---|---|
| `EDGECLOUD_BOOTSTRAP` | Comma-separated libp2p multiaddrs (DNS `/dnsaddr/…` coordinator) | (empty → mDNS only) |
| `EDGECLOUD_REGISTRY` | Override the deterministic registry address (testing) | (derived address) |
| `EDGECLOUD_ANCHOR_HOST` | Latency-anchor hostname (RTT probe) | coordinator host |
| `EDGECLOUD_ANCHOR_PORT` | Latency-anchor port | `443` |
| `EDGECLOUD_LISTEN` | libp2p listen multiaddr(s) | `/ip4/0.0.0.0/tcp/0` |
| `EDGECLOUD_DATA_DIR` | Datastore + **persisted identity key** path | `./.edgecloud` |
| `EDGECLOUD_MAX_CONCURRENT` | `maxConcurrent` for this node | `4` |
| `DOCKER_HOST` | Docker endpoint (dockerode) — standard, unprefixed | local socket |

Secrets/keys are gitignored (`.env`, `*.pem`, `*.key`). The identity key persists under
`EDGECLOUD_DATA_DIR` so the node keeps its `PeerId` across restarts (D-E).

---

## 15. Open questions & the registry punch-list

### Registry code → canonical alignment (`device_registry/index.js`)

The ratified decisions move several things off the current spike. Device Registry team to apply:

| Item | From (spike) | To (canonical) |
|---|---|---|
| Schema fields | base only | add `status`, `maxConcurrent`, `currentLoad`, `availableCapacity` (D-A) |
| Peer key | regenerated each run | **persist** under `EDGECLOUD_DATA_DIR` (D-E) |
| Registry address | shared out-of-band via `REGISTRY_ADDRESS` | **deterministic** well-known address (D-C) |
| Heartbeat / stale | 15s / 30s | **5s / 15s** (D-D) |
| Env vars | `BOOTSTRAP_ADDRS`, `REGISTRY_ADDRESS`, `ANCHOR_*` | `EDGECLOUD_*` (D-G) |
| Signing | unsigned records | **sign** device docs; readers `verify` before scoring (D-F) |

### Remaining open questions

| ID | Question | Default until decided | Owner |
|---|---|---|---|
| A-1 | Deterministic-address mechanism: fixed manifest, static access-controller, or a known seed identity? | static access-controller + fixed DB name | Device Registry + Coordination |
| A-2 | `latencyScore` source: shared-anchor RTT (today) vs. per-peer libp2p ping. | anchor RTT for v1; per-peer later | Job Queue |
| A-3 | Single-writer rule: only the **owning** node writes its own document (`_id`). | yes — one writer per `_id` | Device + Execution |
| A-4 | Optional `edgecloud.jobs` audit log for demo visibility — ship or cut? | cut unless demo needs it | Coordination |
| A-5 | `shared/` packaging (see §13). | plain folder | Coordination |

---

## 16. Prototype guardrails (claims)

This is a **prototype for demo purposes**. Do not describe it (in code, READMEs, or the
demo) as production-ready, secure against malicious nodes, trustless, fully decentralized
in every respect, compliance-ready, FIFO/exactly-once, or safe for arbitrary untrusted code
— unless Legal has approved the exact wording in `legal/spec.md`. The Docker sandbox is a
convenience boundary for the demo, **not** a hardened isolation guarantee.
