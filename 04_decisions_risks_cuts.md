# Decisions, Risks, Blockers, and Cuts

## 1. Purpose

This file records decisions, serious risks, blockers, and scope cuts.

Use this file to prevent repeated debates and to help future agents understand why the repo is structured the way it is.

---

## 2. Decisions

Architecture decisions ratified 2026-06-03; canonical detail in `docs/architecture.md` §0 (labels D-A…D-H).

| ID | Decision | Owner | Date | Reason | Affected Files |
|---|---|---|---|---|---|
| D-001 | Build on OrbitDB 4 + Helia 6 + js-libp2p 3 (pure JS), **not** Kubo/go-ipfs | Steve | 2026-06-03 | OrbitDB gives a CRDT job queue/registry/results over libp2p with no separate daemon; supersedes the `node-ipfs-container/` Kubo scaffold | `shared/`, `server/`, `worker/`, `ARCHITECTURE.md` |
| D-002 | Browser is an HTTP client only; the central server bridges HTTP↔OrbitDB | Steve | 2026-06-03 | A full in-browser libp2p/OrbitDB peer is heavy/flaky; HTTP bridge is simpler and matches "the server shows the result" | `server/src/http/app.js`, `server/src/public/` |
| D-003 | Browser crypto uses tweetnacl + js-sha256 (not WebCrypto) | Steve | 2026-06-03 | Plain HTTP on a bare IP is not a secure context → `crypto.subtle` Ed25519 is unavailable | `server/src/public/app.js`, `server/src/public/vendor/` |
| D-004 | Exactly-once via claims log + deterministic tiebreak | Steve | 2026-06-03 | User choice; leans on OrbitDB CRDT semantics. Duplicates near-zero and harmless (results idempotent by jobId) | `worker/src/coordination.js`, `shared/src/claims.js` |
| D-005 | Deterministic zips; jobId = SHA256(base64(zip)); signature over the jobId | Steve | 2026-06-03 | Same JS string → same jobId → instant cache hit; sig checked before unzip; replay = cache hit | `shared/src/zip.js`, `shared/src/envelope.js` |
| D-006 | Emails never enter OrbitDB; only `HMAC-SHA256(email, SHARED_SALT)` | Steve | 2026-06-03 | Protect attendee PII while still enforcing ≤4 keys/email across servers | `server/src/db.js`, `shared/src/trust.js` |
| D-007 | Multiple interchangeable central servers; trust chain from a genesis key | Steve | 2026-06-03 | Avoid over-centralization; servers hold no unique durable state | `shared/src/trust.js`, `server/src/endorse-server.js` |
| D-008 | Worker egress firewall: iptables blocks private/metadata IPs (NET_ADMIN) | Steve | 2026-06-03 | Submitted code must not reach the host LAN or cloud metadata; the container is the sandbox | `worker/entrypoint.sh` |
| D-009 | Enrich worker heartbeat with a device capability record (adapted from chaodoze's device registry); keep it on gossipsub, not OrbitDB | Steve | 2026-06-03 | Incorporate Chao's device-schema/metadata-collector work (CPU/RAM/storage + live capacity) and wire `currentLoad` to real execution, while preserving the decision to keep high-churn presence off the CRDT (D-001 rationale). See `CREDITS.md` | `worker/src/device-info.js`, `worker/src/coordination.js`, `server/src/heartbeats.js` |
| D-010 | Aggressive worker sandbox: root supervisor drops each job to an unprivileged uid (10002) with no /data access, no network (per-uid iptables), Node `--permission` for JS, worker-built wasmtime argv (ignore `manifest.command`); container `cap_drop ALL`+5, no-new-privileges, read-only rootfs, pids/cpu/mem/ulimits | Steve | 2026-06-03 | Submitted code is hostile by assumption; close the key-exfiltration path (job reading `/data/peer-key.bin` → public POST) and the `manifest.command` injection. Mechanisms empirically validated before deploy. See `THREAT_MODEL.md`, `SECURITY_TESTING.md`, `CREDITS.md` (Codex red-team) | `worker/Dockerfile`, `worker/entrypoint.sh`, `worker/docker-compose.yml`, `worker/src/executor/*`, `worker/src/config.js` |
| D-011 | Accountable worker identity: signed key-bound claims + signed results + email-gated worker registration (≤25 workers/email) | Steve | 2026-06-04 | Close claim-grinding/work-stealing (R-010) and third-party result forgery (R-003). Worker identity is a non-rotatable Ed25519 key (its base64 pubkey) registered against an allowlisted email; the tiebreak `min sha256(jobId\|workerKey\|round)` runs only over signed claims from registered workers, bounding Sybil to the attendee list instead of free peerIds. Results are signed and verified before serving. Redundancy/agreement/reputation deferred (see `ROADMAP.md` §B). | `worker/src/worker-key.js`, `worker/src/register-worker.js`, `worker/src/coordination.js`, `shared/src/claims.js`, `shared/src/result.js`, `server/src/http/app.js`, `server/src/db.js`, `server/src/indexers.js` |

---

## 3. Risks

| ID | Risk | Owner | Severity | Status | Mitigation |
|---|---|---|---|---|---|
| R-001 | CRDT can't give hard exactly-once under partition; a job may rarely execute twice | Steve | Low | Accepted | Results idempotent by jobId; deterministic claim winner + timeout takeover keeps duplicates rare |
| R-002 | No TLS — plain HTTP; user secret key lives in browser localStorage | Steve | Medium | Accepted (demo) | Acceptable for a demo; documented. Future: domain + Caddy TLS + WebCrypto |
| R-003 | Open-write OrbitDB DBs (`claims`, `results`) — anyone on the network can append | Steve | Low | Mitigated | Jobs/registry/endorsements signature-verified; **claims and results now signed too** (D-011) — claims are key-bound to registered workers, results verified before caching/serving, so third-party forgery is closed. Remaining: a registered worker signing a *wrong* answer (needs redundancy/agreement/reputation — `ROADMAP.md` §B) |
| R-010 | Claim-grinding / Sybil work-stealing: original tiebreak ran over free-to-generate peerIds, so an attacker could grind candidates to win (and, with unsigned results, silently forge answers) | Steve | High→Low | Mitigated | D-011: signed key-bound claims + email-gated worker registration (≤25/email) + signed results. Candidate supply bounded by the attendee allowlist. Bounded remainder (in-quota grinding, lying registered worker) deferred to `ROADMAP.md` §B (VRF/reputation/redundancy) |
| R-011 | Worker can drop off the "workers online" pill after a rendezvous/server restart while still replicating + executing jobs — its gossipsub heartbeat mesh doesn't always re-graft | Steve | Low | Mitigated | Root cause: worker only *published* (fan-out), never subscribed. Fix: worker now **subscribes** to `edgecloud/heartbeat/v1` → real mesh member → gossipsub self-heals/re-GRAFTs on reconnect (`worker/src/index.js`). Fallback if it ever recurs: `docker restart edgecloud-worker`. Deeper connection-based presence tracked in `ROADMAP.md` §F |
| R-004 | Trust chain has no revocation; a compromised server key can endorse rogue servers | Steve | Medium | Open | Out of scope for demo; a `revoke` entry type is the obvious extension |
| R-005 | Worker egress firewall allows DNS to private resolvers (home routers) | Steve | Low | Accepted | Narrow DNS-only exception; residual DNS-exfil risk documented in `worker/entrypoint.sh` |
| R-006 | Submitted code is hostile; container escape (kernel/Docker/wasmtime/Node 0-day) would defeat the sandbox | Steve | Medium | Mitigated | Defense-in-depth (D-010): unprivileged job uid, no /data, no network, Node `--permission`, hardened wasmtime, cap_drop/ro-rootfs/seccomp. Residual kernel-escape risk remains; gVisor offered as the stronger option. NOT a confidentiality boundary — see `THREAT_MODEL.md` |
| R-007 | Concurrent same-email registration on two servers can briefly exceed 4 keys | Steve | Low | Accepted | CRDT merge converges; cosmetic for a demo |
| R-008 | Pinned bleeding-edge libp2p/OrbitDB versions churn fast | Steve | Medium | Mitigated | Exact version pins + a lockfile; cross-impl round-trip + browser-pipeline tests guard the envelope contract |

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
