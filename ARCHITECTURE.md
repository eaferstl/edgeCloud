# edgeCloud — Implementation Architecture

This document describes the **implemented** decentralized-compute prototype for
Edge Esmeralda 2026. It is the source of truth for how the running system works;
the team PRD/spec files describe responsibilities at a higher level.

> Prototype for demonstration only. Not production-ready, not a security boundary
> for arbitrary untrusted code, not privacy/compliance-grade. See
> `04_decisions_risks_cuts.md` and `legal/spec.md`.

## What it does

A non-technical attendee opens `http://146.190.123.91` on phone or laptop, enters
the email they registered for Edge Esmeralda with, gets an Ed25519 keypair
generated in-browser, and submits a small compute job (a JS expression or a WASM
module from a dropdown). The job runs on a volunteer's Docker "worker" node
somewhere on the network, and the result comes back to — and only to — the
submitter.

## Stack

Pure-JS peer-to-peer: **js-libp2p 3**, **Helia 6** (IPFS), **OrbitDB 4** (CRDT
databases over libp2p). No Kubo/go-ipfs (the earlier `node-ipfs-container/`
scaffold is superseded). Node 22. Browser crypto via **tweetnacl** +
**js-sha256** (WebCrypto's Ed25519 needs a secure context, which plain-HTTP-on-an-IP
is not). Server HTTP via **Express 5**, allowlist/cache via **better-sqlite3**.

## Three components

```
 Browser (no libp2p)            Central server(s)                 Worker nodes (Docker)
 ─────────────────              ────────────────────              ─────────────────────
 keygen + sign (tweetnacl)      libp2p relay + gossipsub          libp2p (via relay)
 build deterministic zip   ───► Helia + OrbitDB peer        ◄───► Helia + OrbitDB peer
 HTTP only                 HTTP replicates all DBs, never exec    replicate, claim, execute
                               SQLite: allowlist + caches         wasmtime + node child proc
                               attests keys, caches results       iptables egress firewall
```

- **Browser** does only keygen, signing, and HTTP. It never joins libp2p.
- **Central/rendezvous server** (`server/`): a libp2p **circuit-relay-v2 server**
  (so NAT'd workers are reachable) + gossipsub + a Helia/OrbitDB peer that
  replicates and pins every database. It bridges HTTP↔OrbitDB: validates a signed
  job and appends it to the queue; reads results back out. **It never executes
  jobs.** It caches results, so a duplicate submission is answered instantly.
- **Worker** (`worker/`): debian:sid-slim + pinned Node 22 + wasmtime, runs a
  libp2p+OrbitDB peer that dials the rendezvous, replicates the queue, claims
  jobs, executes them, and writes results.

Multiple central servers can run; none holds unique durable state (see
"Decentralization" below).

## OrbitDB databases

All are open-write (`IPFSAccessController({ write: ['*'] })`); authorization is
**app-level Ed25519 signatures**, not the DB ACL. Because every peer opens each DB
with identical options, the `/orbitdb/…` address is derived from the name alone —
no address exchange. **No raw email ever touches OrbitDB.**

| DB (`shared/src/constants.js`) | Type | Holds |
|---|---|---|
| `edgecloud-registry-v1` | events | server-attested user pubkeys: `{ pubkey, emailHmac, addedAt, attestedBy, attestSig }` |
| `edgecloud-jobs-v1` | events | signed job envelopes (the queue) |
| `edgecloud-claims-v1` | events | `{ jobId, peerId, round, ts }` execution claims |
| `edgecloud-results-v1` | documents (`_id`=jobId) | result envelopes, deduped by jobId |
| `edgecloud-servers-v1` | events | server-onboarding endorsements (trust chain) |

## Job envelope, manifest, result

Built in `shared/src/{envelope,zip,manifest,result}.js`, identically in the browser
(`server/src/public/app.js`).

```jsonc
// envelope: browser → POST /api/jobs → edgecloud-jobs
{ "v":1, "jobId":"<hex sha256 of zipB64>", "zipB64":"<base64 deterministic zip>",
  "pubkey":"<b64 Ed25519>", "sig":"<b64 sig over the jobId hex string>",
  "submittedAt": 1730000000000, "nonce":"<b64 16B>" }
```
- `sig` is over the jobId hex → workers verify **before** unzipping (checked first).
- The zip is **deterministic** (fflate STORE, fixed mtime, fixed entry order,
  canonical-JSON manifest) so the *same JS string → same bytes → same jobId* →
  cache hit. `nonce`/`submittedAt` are NOT part of jobId.
- zip contains `manifest.json` + (`main.js` | `module.wasm`). Manifest declares
  `type`, `entry`, `args`, `timeoutMs`, and (wasm) the `command`
  (`["wasmtime","run","--dir",".","module.wasm"]`). **Output convention: captured
  stdout is the result.** A bare JS expression is wrapped client-side so its value
  becomes stdout.

```jsonc
// result: worker → edgecloud-results (key = jobId)
{ "v":1, "jobId":"…", "stdout":"…", "stderr":"", "exitCode":0, "ok":true,
  "error":null, "executedBy":"<peerId>", "startedAt":…, "timestamp":… }
```

## Exactly-once-ish execution (claims log + deterministic tiebreak)

OrbitDB is a CRDT, so under partition you cannot get hard exactly-once; we pick a
strategy that keeps duplicates near-zero and harmless (`worker/src/coordination.js`,
`shared/src/claims.js`):

1. Worker sees a job → **verify signature first**.
2. **Registry check with re-sync grace**: if the submitter's key is unknown, wait
   for the registry to replicate (poll + HTTP fallback) before rejecting — *never
   reject on stale data*.
3. If a result already exists → done (cache).
4. Append a claim for round 0 → wait a settle window → compute the **winner
   deterministically** (`min sha256(jobId|peerId|round)`), which every worker
   agrees on regardless of message order.
5. Winner executes and writes the result; losers watch the results DB and, if no
   result appears within a timeout, re-claim at round+1 (handles a dead winner).
6. Results are idempotent by jobId, so a rare double-execution collapses to one
   record.

Worker presence (gossipsub heartbeat, `edgecloud/heartbeat/v1`) is
**scheduling-advisory / UI-only** — the claim set itself is the candidate set, so
correctness doesn't depend on it. Each heartbeat carries a **device capability
record** (CPU/RAM/storage + live `status`/`maxConcurrent`/`currentLoad`/
`availableCapacity`); `currentLoad` tracks real running executions. This schema is
adapted from Chao Lam's (`chaodoze`) device registry — see
[`CREDITS.md`](CREDITS.md) — carried onto the gossipsub channel (not an OrbitDB
documents DB) to keep high-churn presence off the CRDT oplog.
`worker/src/device-info.js`, `server/src/heartbeats.js`.

## Auth & privacy

- **Registration**: server checks the email against its SQLite allowlist
  (imported from the attendee CSV), enforces ≤4 keys/email, and publishes only
  `HMAC-SHA256(email, SHARED_SALT)` + pubkey to OrbitDB. Raw emails stay in SQLite.
- **Result retrieval**: challenge/response. Server issues a random nonce; the
  browser signs it with the Ed25519 key; a verified signature mints a short-lived
  session bound to that pubkey; only a pubkey that submitted a given jobId can read
  its result.

## Decentralization & multi-server onboarding

Central servers are interchangeable and hold **no unique durable state**: SQLite is
a pure cache rebuildable from (attendee CSV + `SHARED_SALT` + OrbitDB replication).
Trust is a chain rooted at a **genesis key** (the first server's Ed25519 key, baked
into `shared/src/constants.js`):

- Each server has a persistent Ed25519 key and **attests** the user keys it
  registers.
- A server becomes trusted when an already-trusted server **endorses** it via an
  entry in `edgecloud-servers` (`endorseSig` over the record). Trust resolves
  transitively from genesis (`shared/src/trust.js`, cycle-safe).
- Onboard a new server: run the same code with the same CSV + salt, then on any
  trusted server run `npm run endorse-server -- <pubkey> <multiaddrs> <label>`. The
  endorsement replicates; workers accept the new server's attestations
  automatically — no redeploys. (Verified end-to-end: a previously-rejected job
  executed once its server was endorsed.)

Workers and servers tolerate bad blocks from any peer (OrbitDB sync `error` events
are caught, never fatal — `shared/src/orbit.js`).

## Worker sandboxing

Submitted code is untrusted and hostile by assumption, so the worker is locked down
in **defense-in-depth layers** (see `THREAT_MODEL.md` for the full model). The
container is the boundary; the supervisor runs as root but heavily confined, and
**each job is dropped to an unprivileged `sandbox` uid (10002)** that owns nothing.

Per-job isolation (`worker/src/executor/`, run as uid 10002 via `setpriv
--clear-groups --no-new-privs`):
- **No secrets.** `/data` (libp2p private key, OrbitDB state) is root-owned, mode
  700 — the sandbox uid cannot read it. *Verified: `BLOCKED:ERR_ACCESS_DENIED`.*
- **No network.** An iptables `-m owner --uid-owner 10002 -j REJECT` rule drops all
  egress from the job's uid, while the worker keeps libp2p connectivity. Pure-compute
  jobs need none. *Verified: `NET-BLOCKED:ENETUNREACH`.*
- **JS** runs under Node's Permission Model (`--permission
  --allow-fs-read/write=<scratch>`): filesystem confined to a throwaway scratch dir,
  and `child_process` / `worker_threads` / native addons / WASI all denied.
  *Verified: child-process spawn `BLOCKED:ERR_ACCESS_DENIED`.*
- **WASM** runs under wasmtime with a worker-constructed argv — **`manifest.command`
  is ignored** (it was attacker-controllable), only one preopened dir (scratch),
  `inherit-network=n`, `inherit-env=n`, and a 256 MiB memory cap.

Container-level (`worker/docker-compose.yml`): `cap_drop: ALL` plus a 5-cap
allow-list (NET_ADMIN, CHOWN, SETUID, SETGID, KILL), `no-new-privileges`, read-only
root filesystem + `noexec/nosuid` tmpfs scratch, `pids_limit`, `cpus`, `mem_limit`
(no swap), and `ulimits`. Docker's default seccomp stays enforced. A timed-out job
is killed by process group (catches grandchildren). gVisor (`runtime: runsc`) is
documented as an optional stronger-isolation runtime.

Defense-in-depth egress also blocks **everyone** from private/special ranges
(RFC1918, link-local incl. cloud-metadata `169.254.169.254`, CGNAT, loopback-net,
reserved/multicast) while allowing DNS + established + public for the worker.
`EDGECLOUD_SKIP_FIREWALL=1` disables the firewall for local testing only.

This is hardening, not a guarantee — a kernel/Docker escape or wasmtime/Node 0-day
still defeats it. It is **not** an isolation boundary for highly sensitive workloads;
see `THREAT_MODEL.md` and the Aegis/TEE direction for what real confidentiality needs.

## Repository layout

```
shared/   @edgecloud/shared — envelope, deterministic zip, manifest, result,
          claims tiebreak, trust chain, orbit DB helpers, crypto, peer-key
server/   central server: libp2p relay + Helia/OrbitDB + Express + SQLite +
          public/ webform (vendored tweetnacl/sha256/fflate) + example wasm
worker/   Dockerfile + entrypoint (egress firewall) + libp2p/OrbitDB peer +
          claim coordinator + js/wasm executors
infra/    provision.md runbook + edgecloud.service systemd unit
scripts/  e2e-client.mjs (API-level end-to-end harness)
```

## Running it

- **Use it now**: open `http://146.190.123.91`. (You must be on the Edge Esmeralda
  attendee list to register.)
- **Run a worker** (donate compute): `cd worker && docker compose up --build -d`
  (defaults point at the genesis server). Needs `NET_ADMIN`.
- **Run a server / second server / local dev**: see `infra/provision.md`.
- **Tests**: `npm test` (shared determinism/trust + server CSV + the real
  vendored-browser-pipeline test).
