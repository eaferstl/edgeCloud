# Decentralized Queuing System for Local Disaster Computing

*A design discussion for resilient local compute infrastructure (e.g. Lebanon disaster scenario)*

---

## Table of Contents

1. [The Core Tension: CAP Theorem in Disaster Scenarios](#1-the-core-tension)
2. [Candidate Technologies by Network Reliability](#2-candidate-technologies-by-network-reliability)
3. [Why Not IPFS as a Queue?](#3-why-not-ipfs-as-a-queue)
4. [IPFS and Contending Writes](#4-ipfs-and-contending-writes)
5. [CRDT vs. libp2p: A False Dichotomy](#5-crdt-vs-libp2p-a-false-dichotomy)
6. [Can You Use libp2p + IPFS Without a CRDT?](#6-libp2p--ipfs-without-a-crdt)

---

## 1. The Core Tension

A strict, globally-ordered FIFO queue and a partition-tolerant decentralized system are in fundamental tension (CAP theorem). In a disaster scenario, **network partitions aren't an edge case — they're the steady state.** Power flaps, links drop, nodes appear and vanish.

### Design Shift

Stop trying to build a strict queue. Instead, build an **eventually-consistent, replicated task pool** with:

- At-least-once delivery
- Idempotent workers
- A claim/lease mechanism

Workers **pull** work when they have capacity and connectivity, rather than having work pushed to them. Pull-based is far more robust under churn.

---

## 2. Candidate Technologies by Network Reliability

### If the local area is mostly a connected LAN/mesh (partitions are occasional)

**NSQ** is a strong, pragmatic fit:

- Explicitly decentralized — independent `nsqd` daemons with no single point of failure
- Messages are re-queued on timeout; delivery is at-least-once
- Single dependency-free Go binary; runs on a Raspberry Pi or old laptop
- Still actively maintained (commits through 2025)
- **Caveat:** No built-in replication. Mitigate by running redundant `nsqd` pairs that receive copies of the same messages. Because consumers are idempotent, double-processing is harmless.

**NATS with leaf-node topology** is the other candidate — lighter-weight pub/sub with edge-friendly clustering. However, its JetStream persistence layer uses Raft (needs quorum, degrades badly under heavy partition). Use core NATS for transport; don't lean on JetStream in the disaster case.

---

### If partitions are frequent and severe (mesh that splits, sneakernet between sites)

Stop using a "message queue" product. Build on **peer-to-peer + CRDT primitives**:

| Component | Role |
|---|---|
| **libp2p** | Networking layer (peer discovery, DHT, GossipSub pub/sub). GossipSub tolerates churn and partition — messages propagate as connectivity allows. |
| **CRDTs** | Consistency model. Use a CRDT set/log for the task pool; each node replicates it and merges deterministically when partitions heal. Libraries: [Automerge](https://automerge.org/), [Yjs](https://yjs.dev/). |

> **Note on strict ordering:** Strict ordering can't be a pure CRDT. Model work as a **bag of tasks plus a claim token**, not a numbered queue.

---

### If connectivity is genuinely intermittent (store-carry-forward, intermittent uplinks)

- **Delay/Disruption-Tolerant Networking (DTN)** — the Bundle Protocol ([RFC 9171](https://www.rfc-editor.org/rfc/rfc9171)), originally built for deep space and now used in disaster relief. Assumes there may be no end-to-end path at any moment and stores data hop-by-hop until a path exists.
- **Secure Scuttlebutt (SSB)** — a friendlier append-log gossip protocol. Works fully offline and syncs opportunistically.

---

### Concrete Recommendation for a Lebanon-Style Local Compute Fabric

```
libp2p GossipSub (transport)
  + CRDT-backed task pool (claim/lease state)
  + idempotent workers
  + [NSQ as simpler fallback if network is LAN-reliable]
  + [LoRa as out-of-band control/heartbeat channel for geographic spread]
```

LoRa survives when Wi-Fi/cellular doesn't.

---

## 3. Why Not IPFS as a Queue?

IPFS solves the **wrong half** of the problem. It is a content-addressed storage and retrieval layer, not a coordination or messaging layer. It has no native notion of:

- "Deliver this task to a worker"
- "Claim this job"
- "Ack/requeue on timeout"
- "This work is done"

### The Deeper Problem: Mutability

A queue is fundamentally mutable — pending/claimed/finished state changes constantly. **IPFS content is immutable by design.** The mutable-pointer layer, IPNS, is notoriously slow to propagate (often tens of seconds) and weakly consistent — disqualifying for any fast-moving claim mechanism. Workers would race on stale pointers.

Under heavy partition — the actual disaster scenario — the DHT that does content routing degrades; peers can't find a CID unless directly connected.

### What IPFS Actually Is

IPFS is built on **libp2p**. The useful part for queuing is libp2p's pubsub (GossipSub), which IPFS exposes. "Use IPFS as a queue" collapses into either:

1. Abusing IPNS for mutable state (slow, inconsistent — bad), or
2. Really just using libp2p pubsub — in which case you don't need the rest of IPFS and its DHT/Bitswap overhead (non-trivial on constrained disaster hardware).

### The Right Division of Labor

| Layer | Responsibility |
|---|---|
| **IPFS** | Heavy payloads — datasets, container images, model weights, computed results. Content addressing means a blob fetched once is verifiable and cacheable everywhere. |
| **Coordination layer** (CRDT task pool / libp2p pubsub / NSQ) | Small, mutable task descriptors. Each task carries the CID of its input and writes back the CID of its output. |

> **Rule:** IPFS moves the bytes. Your queue moves the intent.

---

## 4. IPFS and Contending Writes

### At the storage layer: write conflicts don't exist as a concept

You add content, you get back its hash. Same bytes → same CID (idempotent dedup). Different bytes → two different CIDs that both coexist forever. Nothing is overwritten, so there's nothing to reconcile.

### At the mutability layer (IPNS): last-writer-wins

When a node sees two records for the same name, it takes the higher sequence number (with a deterministic tiebreak on validity time, then byte comparison). If two nodes share a key and publish concurrently:

- One update silently wins
- The other is **lost with no signal to the application**

**This is fatal for a job queue.** Two workers both claim job 47, both publish their claim, IPNS keeps one record, the other evaporates — and now two workers are running the same job each believing they own it.

### The Fix: CRDTs

CRDTs resolve concurrent writes by **merging deterministically** rather than picking a survivor. A "claims" set ends up containing both claims, the conflict is visible, and a deterministic tiebreak can be applied in application logic (e.g. lowest node-id wins the job) without losing the fact that contention happened.

**On the IPFS stack specifically:** [OrbitDB](https://orbitdb.org/), built on `ipfs-log`, is a CRDT database where every operation is an immutable IPFS object and the log is a Merkle-DAG that merges deterministically across partitions. This is the honest version of "a database on IPFS."

> **Rule of thumb:** Anything mutable and contended (the claim/lease state) goes in a CRDT or a quorum-based consensus layer. IPFS/IPNS only ever holds immutable content.

---

## 5. CRDT vs. libp2p: A False Dichotomy

These are **not competitors.** libp2p is a transport layer (how bytes find their way between peers). A CRDT is a consistency model (how concurrent state changes reconcile once the bytes arrive). In a real build you **run a CRDT over libp2p.**

The real architectural fork is: **coordinate by passing messages** (lean on libp2p pubsub as the primary abstraction) vs. **coordinate by replicating state** (lean on a CRDT).

### libp2p / Message-Passing as the Primitive

**Pros:**
- Solves genuinely hard networking problems you don't want to write yourself: peer discovery (mDNS, DHT, rendezvous), NAT traversal and hole-punching, encryption (Noise/TLS), transport-agnostic (TCP/QUIC/WebRTC), multiplexing
- GossipSub is battle-tested (carries Ethereum's consensus layer) and survives churn and partition well
- Conceptually light for ephemeral signaling

**Cons:**
- Gives you delivery, not truth. GossipSub is best-effort with no ordering guarantee and no persistence
- A node that's partitioned simply misses messages — no built-in replay or catch-up
- All application semantics are still on you; you'd have to build your own anti-entropy

### CRDT / State-Replication as the Primitive

**Pros:**
- Deterministic, conflict-free convergence with no coordinator and no quorum — **fully partition-tolerant (AP)**
- Concurrent writes merge rather than one silently winning — contention stays visible
- Offline-first by nature; a rejoining node just syncs and self-heals
- Queryable convergent state: "what's the current set of claims" has an actual answer

**Cons:**
- Still needs libp2p (or some gossip/sync) underneath — you add to it, not replace it
- Metadata overhead is real: version vectors, tombstones, and logs grow unbounded without compaction/GC — problematic on constrained hardware
- **Hard limit:** CRDTs can only absorb writes, never reject them. They cannot enforce invariants. "Exactly one worker holds this lease" is not natively expressible; you resolve it with an application-level tiebreak

### How the Fork Resolves

Pure libp2p pubsub gets you fast signaling but leaves partitioned/rejoining nodes blind. A CRDT gives you the self-healing, contention-preserving claim state you actually want — but only by running on top of libp2p anyway.

**It's not CRDT-or-libp2p; it's libp2p definitely, plus a CRDT if you need convergent shared state — which for a claim/lease table you do.**

> **Sharp edge:** A CRDT cannot give you at-most-once execution by itself. If you need a hard guarantee that a job runs exactly once, that requires real consensus (Raft/quorum) — and that trades away partition-tolerance. Partitioned nodes then can't claim anything. **Whether your workload tolerates occasional double-execution is the single question that picks the whole architecture.**

---

## 6. libp2p + IPFS Without a CRDT

You can do this — but there are only a few honest ways, and the CRDT often doesn't disappear; it just loses its name.

### The Catch

IPFS's own append-log primitive (`ipfs-log`) *is* a CRDT. If your "libp2p + IPFS" plan involves keeping a shared log of claim events in a Merkle-DAG and merging it deterministically across nodes, you haven't avoided a CRDT — **you've hand-rolled one**, with the same costs plus the gaps pubsub leaves for partitioned nodes.

### The Three Genuinely CRDT-Free Paths

These require **removing the contended mutable state**, not resolving it:

#### Path 1: Tolerate Duplicate Execution ✓ (cleanest)

If running a task twice is harmless and cheap, you don't need claims at all. Broadcast the task (or its input CID) over pubsub, anyone with spare capacity grabs it, results are written to IPFS keyed by a deterministic output CID. Two workers doing job 47 just produce the same CID twice; the second write dedupes for free. No shared mutable state exists, so nothing can conflict.

**Lives or dies on whether your workload tolerates redundant work.**

#### Path 2: Deterministic Ownership via Hashing

Shard tasks by a hash (consistent hashing / rendezvous hashing): `owner = argmax(hash(task, node))`. Each task belongs to exactly one node by construction, so no two nodes ever contend for the same job — no claim, no merge.

**Honest cost:** This relocates the consistency problem to **membership**. Everyone has to agree on who's in the cluster, and under partition that view diverges — two partitions can both believe they own a task. You haven't killed the problem; you've moved it to a place where it may be cheaper to manage.

#### Path 3: Accept LWW or Use Consensus (worse options)

- **IPNS + LWW:** Silent claim loss — established to be bad for queues
- **Raft/quorum:** Real exactly-once guarantees, but kills partition-tolerance — partitioned nodes can't claim anything

### Conclusion

> **libp2p + IPFS with no CRDT works if and only if your tasks are idempotent enough that duplicate execution is free (Path 1), or you're willing to push the hard problem into membership management (Path 2).**
>
> If you truly need "this job runs on exactly one worker" with no duplicates and no coordinator — you need either CRDT semantics (named or hand-rolled) or consensus. There is no fourth option; that's CAP doing its job.