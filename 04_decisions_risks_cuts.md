# Decisions, Risks, Blockers, and Cuts

## 1. Purpose

This file records decisions, serious risks, blockers, and scope cuts.

Use this file to prevent repeated debates and to help future agents understand why the repo is structured the way it is.

---

## 2. Decisions

Architecture decisions ratified 2026-06-03; canonical detail in `docs/architecture.md` §0 (labels D-A…D-H).

| ID | Decision | Owner | Date | Reason | Affected Files |
|---|---|---|---|---|---|
| D-001 | Device document schema = the registry's nested host record, **extended** with `status` / `maxConcurrent` / `currentLoad` / `availableCapacity` (arch D-A, §7.1) | Eliot / Coordination | 2026-06-03 | Reuse the working spike; add the fields Execution needs for capacity write-back | `docs/architecture.md`, `device_registry/index.js`, `02_integration_contracts.md` |
| D-002 | Discovery = DNS-addressed bootstrap (coordinator/relay) + mDNS; **no DHT** in v1 (arch D-B) | Eliot / Coordination | 2026-06-03 | DNS assumed available; DHT heavier and unneeded for the demo | `docs/architecture.md`, `device_registry/index.js` |
| D-003 | Registry convergence = **deterministic well-known OrbitDB address** (fixed name + `IPFSAccessController({write:['*']})`) (arch D-C) | Eliot / Coordination | 2026-06-03 | Nodes converge without hand-sharing an `/orbitdb/…` address | `docs/architecture.md`, `device_registry/index.js` |
| D-004 | Heartbeat **5s** / stale-offline **15s** (arch D-D) | Eliot / Coordination | 2026-06-03 | Snappier liveness for the live demo | `docs/architecture.md`, `device_registry/index.js` |
| D-005 | **Persisted** libp2p Ed25519 identity; stable PeerId across restarts (arch D-E) | Eliot / Coordination | 2026-06-03 | Stable identity for addressing + signing | `docs/architecture.md`, `device_registry/index.js` |
| D-006 | **Signing required** at every trust boundary before Demo Ready (arch D-F) | Eliot / Coordination | 2026-06-03 | Integrity of jobs/results/registry; matches build-session "sign all payloads" | `docs/architecture.md`, `auth/*`, all modules |
| D-007 | `EDGECLOUD_`-prefixed env var convention (arch D-G) | Eliot / Coordination | 2026-06-03 | Namespaced, collision-safe config across modules | `docs/architecture.md`, `device_registry/index.js` |
| D-008 | Node.js **20 LTS** minimum (arch D-H) | Eliot / Coordination | 2026-06-03 | Above the 18.15 floor; current LTS | `docs/architecture.md`, `package.json` |

---

## 3. Risks

| ID | Risk | Owner | Severity | Status | Mitigation |
|---|---|---|---|---|---|
| R-001 | Registry code targets libp2p/OrbitDB APIs not yet run against installed deps (only `node --check`) — possible API drift | Chao / Device Registry | Medium | Open | `npm i` the documented deps + smoke-run before relying on it |
| R-002 | Provisional registry signing must use the **same** canonicalization as the shared auth module, or signatures won't verify | Kevin / Authentication | Medium | Open | `auth/` implements `canonicalJSON` exactly per arch §6; registry switches to it when it lands |
| R-003 | A CRDT registry cannot enforce single execution; duplicate offers are possible | Cam / Job Queue | Low | Open | idempotent workers keyed on `jobId`; no FIFO/exactly-once claims (arch §8) |

---

## 4. Blockers

| ID | Blocker | Owner | Blocking | Needed Decision / Action | Status |
|---|---|---|---|---|---|
| B-001 | Auth module (`sign` / `verify` / `canonicalJSON`) unimplemented | Kevin / Authentication | Every signed path; nothing reaches Demo Ready (D-006) | Implement `auth/` to architecture §6 interface + error contract | Blocked |

---

## 5. Scope cuts

| ID | Cut | Reason | Approved By | Date | Notes |
|---|---|---|---|---|---|
| CUT-001 | DHT-based WAN discovery | Assumes a DNS-reachable coordinator/relay for v1 | Eliot / Coordination | 2026-06-03 | Revisit for multi-site WAN |
| CUT-002 | "Cheapest node" pricing in fitness scoring | Deferred; `pricePerJobUsd` reserved in schema | Eliot / Coordination | 2026-06-03 | arch §8 |

---

## 6. Legal / presentation concerns

| ID | Concern | Owner | Status | Resolution |
|---|---|---|---|---|
| L-001 | TODO | Legal | Not Started |  |

---

## 7. Contract changes

Record any post-freeze changes to `02_integration_contracts.md`.

| ID | Change | Producer | Consumer | Approved By | Date |
|---|---|---|---|---|---|
| C-001 | TODO | TODO | TODO | TODO | TODO |
