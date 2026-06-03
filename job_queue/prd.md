# Job Execution PRD — Decentralized Cloud

## Vision

A serverless compute infrastructure where submitted jobs execute on the closest, smallest node capable of running them. This provides a foundational local compute primitive for the decentralized cloud, with room to grow into a priced compute marketplace.

## Architecture Overview

The system is built on two foundational layers:

**OrbitDB** (built on Helia/IPFS, which is built on libp2p) provides CRDT-replicated data stores shared across all peers. Every node maintains a local replica of the device registry and job log. Writes propagate via eventual consistency — no central coordinator required.

**libp2p** provides the peer-to-peer networking layer: encrypted connections, peer discovery (mDNS for LAN, Kademlia DHT for WAN), multiplexed streams, and NAT traversal.

The critical architectural split: OrbitDB handles shared state (device registry, job log) while direct libp2p streams handle the latency-sensitive hot path (job assignment, result delivery). This keeps assignment times in the millisecond range without waiting for CRDT propagation.

## Subsystems

The system is divided into four independently-owned subsystems. Each subsystem has a defined boundary and communicates with others through explicit interface contracts.

### 1. Device Registry

Owns node lifecycle and the shared device store.

**Workflow:**
1. Node boots and discovers peers via mDNS (LAN) or Kademlia DHT (WAN)
2. Node reads local system specs and writes a registration document to the OrbitDB device store
3. Node maintains its presence through event-driven and periodic updates

**Node states:**
- `available` — accepting jobs, included in fitness scoring
- `draining` — finishing current jobs, excluded from new assignments, auto-transitions to `offline` when running job count hits zero
- `offline` — not participating (voluntary or inferred from stale `lastSeen`)

A node can opt out at any time by setting its status to `draining` or `offline`.

**Heartbeat mechanism:**
- Immediate write on job accepted, job completed, or job failed (capacity changed)
- Conditional periodic write every 15–30 seconds, only if local system resources (CPU, RAM via `os.freemem()`, `os.loadavg()`) shifted more than 10% from last reported values
- A quiet idle node generates zero periodic writes after initial registration
- `lastSeen` timestamp updated on any write; nodes with `lastSeen` older than 60 seconds are treated as dead by other peers

**OrbitDB device document schema:**
```json
{
  "peerId": "12D3KooW...",
  "cpu": 4,
  "ram": 8192,
  "currentLoad": { "jobsRunning": 1, "cpuUsed": 2, "ramUsed": 4096 },
  "availableCapacity": { "cpu": 2, "ram": 4096 },
  "status": "available",
  "lastSeen": 1717430000000
}
```

Each node is the sole author of its own document — no write conflicts possible.

**Interface out:** The device store is replicated to all peers via CRDT. The job queue reads this local replica for fitness scoring. Any schema change here requires coordination with the job queue team.

### 2. Authentication

Owns identity, signing, and verification.

**Workflow:**
1. Node generates an Ed25519 keypair on first boot (libp2p PeerId is derived from the public key)
2. All outbound payloads (job submissions, stream offers, results) are signed with the node's private key
3. All inbound payloads are verified against the sender's public key before being acted on

**Verification checkpoints (called by other subsystems):**
- Job submission — submitter's identity validated before job enters the queue
- Stream offer — worker verifies the submitter's identity before accepting a job
- Result delivery — submitter verifies the worker's identity before accepting a result

**Interface out:** Exposes `sign(payload)` and `verify(payload, signature, peerId)` functions. Every other subsystem calls `verify()` at its boundary. The auth team defines the signing format and the error contract (what happens on verification failure — reject and discard).

### 3. Job Queue

Owns orchestration from job submission through result delivery. This is the coordination core.

**Workflow:**
1. Submitter creates a job spec (Docker image, command, timeout, resource requirements)
2. Submitter reads its local OrbitDB device store replica to get all available nodes
3. Submitter runs the fitness function to score and rank candidate nodes
4. Submitter opens a direct libp2p stream to the top-ranked candidate and sends a job offer
5. Candidate accepts or rejects based on its current capacity
6. On reject: submitter falls through to the next ranked candidate
7. On accept: worker executes the job and streams the result back over the same libp2p connection
8. Submitter receives the result; job log updated in OrbitDB for persistence and audit

**Job spec schema:**
```json
{
  "jobId": "uuid-v4",
  "submitter": "12D3KooW...",
  "spec": {
    "image": "node:22-alpine",
    "cmd": ["node", "-e", "console.log(JSON.stringify({result: 42}))"],
    "env": {},
    "timeout": 30000,
    "requirements": { "minCpu": 1, "minRam": 512 }
  },
  "signature": "base64-encoded-signature",
  "submittedAt": 1717430000000
}
```

**Result schema:**
```json
{
  "jobId": "uuid-v4",
  "worker": "12D3KooW...",
  "result": {
    "stdout": "...",
    "stderr": "...",
    "exitCode": 0,
    "durationMs": 1523
  },
  "signature": "base64-encoded-signature",
  "completedAt": 1717430001523
}
```

**Job lifecycle states:**
```
submitted → assigned → running → complete
                  ↘ rejected (try next candidate)
                        running → failed (error or timeout)
```

**Interface in:** Reads device store replica (from device registry). Calls `verify()` (from auth) on incoming results.

**Interface out:** Sends `JobOffer` to execution over libp2p stream. Receives `JobResponse` back.

### 4. Execution

Owns the Docker runtime on worker nodes.

**Workflow:**
1. Worker receives a job offer via direct libp2p stream
2. Worker checks local capacity against job requirements
3. Accept: updates device store (capacity decreased), starts Docker container
4. Reject: responds immediately with `{accepted: false, reason: "..."}`, submitter tries next candidate
5. On accept: pulls image (if not cached), runs `docker run` with specified cmd/env, enforces timeout
6. Captures stdout and stderr from container
7. Streams result payload back to submitter over the libp2p connection
8. Updates device store (capacity restored)

**libp2p stream protocol (two message types):**

Submitter → Worker:
```json
{
  "type": "job_offer",
  "payload": { "...job spec..." },
  "signature": "..."
}
```

Worker → Submitter (immediate response):
```json
{
  "type": "job_response",
  "accepted": true,
  "reason": null
}
```

Worker → Submitter (on completion):
```json
{
  "type": "job_result",
  "payload": { "stdout": "...", "stderr": "...", "exitCode": 0, "durationMs": 1523 },
  "signature": "..."
}
```

**Interface in:** Receives `JobOffer` from job queue over libp2p stream.

**Interface out:** Writes capacity updates to its own device store document (event-driven). Streams `JobResponse` and `JobResult` back to submitter.

## Fitness Function

The fitness function runs on the submitter's node, scoring every `available` device in the local OrbitDB replica against the job's requirements. It produces a deterministic ranking used for sequential direct-stream offers.

**Input filtering:**
```
candidates = devices.filter(d =>
  d.status === 'available' &&
  d.lastSeen > (now - STALE_THRESHOLD) &&
  d.availableCapacity.cpu >= job.requirements.minCpu &&
  d.availableCapacity.ram >= job.requirements.minRam
)
```

**Scoring:**
```
score = (w1 × normalizedLatency) + (w2 × normalizedSize) + (w3 × normalizedLoad)
```

Lower score wins. Each dimension normalized to 0–1 so they are comparable.

**Dimensions:**
| Priority | Dimension | Source | Normalization |
|----------|-----------|--------|---------------|
| 1 | Latency | Submitter's local RTT measurement (libp2p ping) | `RTT / maxRTT` across candidates |
| 2 | Size | Total CPU cores from device store | `cores / maxCores` across candidates |
| 3 | Load | Current job count from device store | `jobs / maxJobs` across candidates |

**Starting weights (tune during demo):**
- `w1 = 0.5` (latency — closest node)
- `w2 = 0.3` (size — smallest node / decentralization)
- `w3 = 0.2` (load — least busy node)

**Deterministic tiebreaker:** If two nodes score identically, `peerId.localeCompare()` breaks the tie. No two nodes share a peerId, so there is always exactly one winner.

**Latency measurement:** Each node periodically pings known peers over libp2p and stores RTT values locally. This data is private to each node — Node A's latency to Node C is irrelevant to Node B. The ping interval is independent of the device store heartbeat.

**Future: pricing.** The PRD reserves a fourth dimension (`w4 = cheapest`) for a future pricing/bidding system. The field exists in the fitness function signature but is not implemented. All bids default to 0 for now.

## Data Structures

### OrbitDB Stores

**Device store** (documents store) — one document per node, keyed by peerId. Each node writes only its own document. Used by the job queue for fitness scoring.

**Job log** (documents store) — one document per job, keyed by jobId. Written by the submitter on job submission and updated on assignment, completion, or failure. Used for persistence, audit, and result retrieval.

### Local-Only Data

**Latency table** — each node maintains a private map of `peerId → RTT` from periodic libp2p pings. Not shared via OrbitDB.

**Ranked candidates list** — produced by the fitness function for each job. Consumed sequentially during the direct-stream offer phase. Discarded after assignment or exhaustion.

## Workflow (Updated)

1. A USER with a DEVICE creates a LOAD (job spec: Docker image, command, timeout, resource requirements).
2. The LOAD is signed by the submitter's private key and written to the OrbitDB job log with status `submitted`.
3. The submitter reads its local device store replica, runs the fitness function, and produces a ranked candidate list.
4. The submitter opens a direct libp2p stream to the top candidate and sends a `JobOffer`.
5. The candidate checks local capacity: accept or reject.
6. On reject: submitter falls through to the next candidate. On accept: candidate executes the job in Docker.
7. The executed RESULT streams back to the submitter over the libp2p connection.
8. The submitter verifies the result signature, updates the job log in OrbitDB, and the job is complete.

## Demo Scope

Two demo workloads to validate the system end-to-end:

**Math workload** — pure compute, fast, deterministic:
```json
{
  "image": "node:22-alpine",
  "cmd": ["node", "-e", "console.log(JSON.stringify({result: Array.from({length:1000},(_,i)=>i).reduce((a,b)=>a+b)}))"],
  "timeout": 30000
}
```

**AI inference workload** — heavier, validates resource allocation:
```json
{
  "image": "your-inference-image",
  "cmd": ["python", "infer.py", "--prompt", "Explain gravity in one sentence"],
  "timeout": 120000
}
```

Both follow the same contract: read from env/stdin, write to stdout. The worker captures stdout as the result payload.

## Technology Stack

- **Runtime:** Node.js (primary language: JavaScript)
- **Networking:** libp2p (`@libp2p/...` modules)
- **Shared state:** OrbitDB (CRDT-replicated document stores over Helia/IPFS)
- **Peer discovery:** mDNS (LAN), Kademlia DHT (WAN)
- **Container execution:** Docker on unix-like hosts
- **Identity:** Ed25519 keypairs via libp2p PeerId

## Interface Contracts Summary

| From | To | Interface | Format |
|------|----|-----------|--------|
| Device registry | Job queue | OrbitDB device store replica | Document with peerId, cpu, ram, currentLoad, availableCapacity, status, lastSeen |
| Auth | All subsystems | `sign(payload)` / `verify(payload, sig, peerId)` | Ed25519 signature over JSON payload |
| Job queue | Execution | libp2p direct stream | `JobOffer` message (job spec + signature) |
| Execution | Job queue | libp2p direct stream | `JobResponse` (accept/reject) then `JobResult` (stdout, stderr, exitCode, durationMs + signature) |
| Execution | Device registry | OrbitDB device store write | Update own document on job accept / complete / fail |

## Open Questions

- **Discovery scope for demo:** LAN only (mDNS, simplest) or internet-wide (requires bootstrap nodes, relay servers)?
- **Image caching strategy:** Pre-pull demo images on all nodes, or test cold-pull latency as part of the demo?
- **Timeout enforcement:** Hard kill (`docker kill`) or graceful shutdown signal followed by hard kill after grace period?
- **Multi-job concurrency:** Maximum concurrent jobs per node — hardcoded, configurable, or dynamic based on available resources?
- **Pricing timeline:** When does the `w4 = cheapest` dimension enter the fitness function? What does the bid/wallet model look like?