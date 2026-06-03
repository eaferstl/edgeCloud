# Decisions, Risks, Blockers, and Cuts

## 1. Purpose

This file records decisions, serious risks, blockers, and scope cuts.

Use this file to prevent repeated debates and to help future agents understand why the repo is structured the way it is.

---

## 2. Decisions

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

---

## 3. Risks

| ID | Risk | Owner | Severity | Status | Mitigation |
|---|---|---|---|---|---|
| R-001 | CRDT can't give hard exactly-once under partition; a job may rarely execute twice | Steve | Low | Accepted | Results idempotent by jobId; deterministic claim winner + timeout takeover keeps duplicates rare |
| R-002 | No TLS — plain HTTP; user secret key lives in browser localStorage | Steve | Medium | Accepted (demo) | Acceptable for a demo; documented. Future: domain + Caddy TLS + WebCrypto |
| R-003 | Open-write OrbitDB DBs (`claims`, `results`) — anyone on the network can append | Steve | Low | Accepted | Jobs/registry/endorsements are signature-verified; a forged result is bounded (first valid result by jobId wins; not signed — a known limitation) |
| R-004 | Trust chain has no revocation; a compromised server key can endorse rogue servers | Steve | Medium | Open | Out of scope for demo; a `revoke` entry type is the obvious extension |
| R-005 | Worker egress firewall allows DNS to private resolvers (home routers) | Steve | Low | Accepted | Narrow DNS-only exception; residual DNS-exfil risk documented in `worker/entrypoint.sh` |
| R-006 | Submitted code runs with generous permissions inside the container | Steve | Medium | Accepted | Container + egress firewall + non-root user are the boundary; NOT safe for arbitrary untrusted code (a non-goal) |
| R-007 | Concurrent same-email registration on two servers can briefly exceed 4 keys | Steve | Low | Accepted | CRDT merge converges; cosmetic for a demo |
| R-008 | Pinned bleeding-edge libp2p/OrbitDB versions churn fast | Steve | Medium | Mitigated | Exact version pins + a lockfile; cross-impl round-trip + browser-pipeline tests guard the envelope contract |

---

## 4. Blockers

| ID | Blocker | Owner | Blocking | Needed Decision / Action | Status |
|---|---|---|---|---|---|
| B-001 | TODO | TODO | TODO | TODO | Not Started |

---

## 5. Scope cuts

| ID | Cut | Reason | Approved By | Date | Notes |
|---|---|---|---|---|---|
| CUT-001 | TODO | TODO | TODO | TODO | TODO |

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
