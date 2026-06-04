# edgeCloud — Threat Model & Security Assumptions

This document records, explicitly, what edgeCloud defends against, what it does
**not**, and the **load-bearing assumptions** that the security of each layer
rests on. It is deliberately blunt: this is a **prototype/demo**, not a system
for confidential or high-value workloads. Where a guarantee is missing, that is
stated, not glossed.

The companion document [`SECURITY_TESTING.md`](SECURITY_TESTING.md) records the
concrete tests run to validate the claims below. Implementation details are in
[`ARCHITECTURE.md`](ARCHITECTURE.md).

> One-line summary: **edgeCloud protects the *integrity of who may submit and who
> may read results*, and contains *hostile submitted code* on worker nodes. It does
> NOT provide confidentiality from a central server operator, nor a hard guarantee
> against a malicious worker returning a wrong answer, nor exactly-once execution
> under network partition.** For those, see the Aegis/TEE direction at the end.

---

## 1. What the system is

A decentralized compute demo: a browser user submits a small JS/WASM job; it is
signed, queued in an OrbitDB CRDT over libp2p, executed on a volunteer Docker
worker, and the result is returned to the submitter. Three roles: **browser
user**, **central/rendezvous server(s)**, **worker nodes**.

## 2. Assets we try to protect

| # | Asset | Protected against | Primary mechanism |
|---|---|---|---|
| A1 | A user's private key | theft from other users / the network | generated + kept in the browser's localStorage; never transmitted |
| A2 | A worker's libp2p private key + OrbitDB state (`/data`) | theft by submitted code | root-owned mode 700; job runs as a different uid; Node `--permission` |
| A3 | Attendee email addresses (PII) | exposure on the public CRDT | only `HMAC-SHA256(email, SHARED_SALT)` is ever written to OrbitDB |
| A4 | "Only registered attendees can submit" | unregistered/forged submitters | Ed25519 signatures verified against a server-attested registry |
| A5 | "Only the submitter reads their result" | other users reading a result | challenge/response: read requires signing a server nonce with the submitter key |
| A6 | The volunteer's host machine + LAN | attack by submitted code | container + egress firewall + unprivileged job uid + no job network |
| A7 | "A job is not executed twice" (best-effort) | wasted/duplicate execution | claims log + deterministic tiebreak; dedupe by jobId |

## 3. Adversaries (who we model)

- **Curious/malicious user**: holds a valid key, tries to read others' results,
  forge submissions, or replay.
- **Malicious job author**: fully controls the JS/WASM payload; wants to steal the
  worker's keys, attack the host/LAN, exfiltrate data, or DoS the host.
- **Malicious worker operator**: runs a worker, wants to return wrong results, or
  learn job contents.
- **Network attacker on the OrbitDB DBs**: can append to the open-write CRDT DBs
  (claims/results), wants to spoof results or disrupt coordination.
- **Rogue/compromised server**: wants to admit illegitimate users.

We do **not** model: nation-state adversaries, hardware side-channels, supply-chain
compromise of pinned dependencies, or a kernel/hypervisor 0-day (see §10).

---

## 4. Layer-by-layer analysis

### L1 — Browser & user keys (A1)
- **Design**: Ed25519 keypair generated in-browser (tweetnacl), secret key in
  `localStorage`. Email is used only to gate registration.
- **Threats & mitigations**: the key never leaves the device, so the network/server
  can't steal it. A user signs both job envelopes (over `jobId`) and result-fetch
  challenges.
- **Residual risk**: a key in `localStorage` is exposed to any XSS on the origin and
  to anyone with the device. There is **no TLS** (plain HTTP on an IP), so a
  network MITM can read traffic and tamper with the served page — a MITM could
  swap the page's JS and capture the key. **Accepted for the demo** (R-002); do not
  use a key here that matters elsewhere.
- **Assumption**: the served page and vendored crypto libs are delivered intact
  (no MITM, no malicious server operator) at the moment of use.

### L2 — Registration, allowlist & email privacy (A3, A4)
- **Design**: the server checks the email against a SQLite allowlist (from the
  attendee CSV), enforces ≤4 keys/email, and publishes to OrbitDB only the pubkey
  plus `HMAC-SHA256(email, SHARED_SALT)` — never the raw email.
- **Threats & mitigations**: an outsider reading the CRDT sees opaque HMACs, not
  emails. Brute-forcing emails from the HMAC requires the `SHARED_SALT`.
- **Residual risk**: registration is *not* proof-of-email-ownership — anyone who
  knows an allowlisted email can register a key under it (no email round-trip). The
  allowlist gate is about "is this address on the guest list," not authentication of
  the person. The email→HMAC map is guessable by anyone holding both the CSV and the
  salt (i.e. server operators).
- **Assumptions (load-bearing)**: (a) `SHARED_SALT` stays secret; (b) the attendee
  CSV is trustworthy and distributed only to server operators; (c) HMAC-SHA256 is a
  PRF (standard).

### L3 — Central server & the trust chain (A4)
- **Design**: each server has a persistent Ed25519 key and **attests** the user keys
  it registers. A server is trusted iff it is the **genesis** key (baked into
  `shared/src/constants.js`) or transitively **endorsed** by a trusted server via the
  open-write `edgecloud-servers` DB. Workers recompute the trusted set from the
  replicated chain.
- **Threats & mitigations**: an untrusted/rogue server's attestations are ignored by
  workers (verified in `SECURITY_TESTING.md` §T-EndorseChain). Forged endorsements
  (wrong signer) are rejected.
- **Residual risk**: **no revocation** (R-004). A compromised trusted server key can
  endorse rogue servers and attest arbitrary keys, and there is no way to undo it
  short of rotating the genesis key + redeploying. The genesis key is a single root
  of trust.
- **Assumptions (load-bearing)**: (a) the **genesis private key is uncompromised**;
  (b) server operators are honest enough not to attest non-attendees (they *can*);
  (c) `shared/src/trust.js` correctly computes the transitive closure (fuzz-tested).

### L4 — OrbitDB CRDT layer (A4, A7, and the limits of A-everything)
- **Design**: all five DBs are **open-write** (`IPFSAccessController({write:['*']})`).
  Authorization is enforced at the **application layer** by Ed25519 signatures, not
  by the DB. Registry entries are server-attested; job envelopes are user-signed;
  results and claims are unauthenticated.
- **Threats & mitigations**: anyone can append to `edgecloud-jobs/claims/results`,
  but workers/servers **verify signatures before acting** on registry and job
  entries. A forged job (bad signature, or submitter not in the registry) is dropped.
- **Residual risk — IMPORTANT**:
  - **Result spoofing (R-003).** Result documents are **not signed**. Any network
    participant can write a `result` doc for a `jobId`. The server caches the *first*
    result it sees per `jobId`. A fast attacker can therefore feed a **wrong answer**
    to the submitter. We accept this for a compute demo (results are non-sensitive,
    reproducible); a fix is to sign results with the executing worker's key and have
    consumers verify. Documented, not mitigated.
  - **Claim spam / griefing.** An attacker can append bogus claims; the deterministic
    tiebreak still picks one peer, but a flood could distort which peer "wins" or add
    noise. Bounded, not exploited for safety (results dedupe by jobId).
  - **Log growth / no GC of the CRDT oplog** — operational, not security.
- **Assumption**: app-layer signature verification (`shared/src/{envelope,trust}.js`)
  is correct and always run *before* trusting an entry (fuzz-tested; re-verified by
  workers even though the server already validated).

### L5 — Job envelope & replay (A4, A5)
- **Design**: `jobId = SHA256(base64(zip))`; the user signs the `jobId`. The
  signature is checked **first**, before unzip. Identical code → identical `jobId` →
  the server returns the **cached** result (replay = cache hit, by design).
- **Threats & mitigations**: tampering with the payload, jobId, pubkey, or signature
  is rejected (fuzz-tested, §T-Fuzz). A replayed envelope just re-fetches the cached
  result; it cannot cause a *different* result for the same code.
- **Residual risk**: result-fetch authorization is by "did this pubkey submit this
  jobId" — two users who submit the *same code* share a `jobId` and both may read the
  (identical) result. That is intended (same input → same public output).

### L6 — Exactly-once coordination under races/partitions (A7)
- **Design**: claims log + deterministic tiebreak (`min sha256(jobId|peerId|round)`);
  the winner executes, backups take over after a timeout; results are idempotent by
  `jobId`.
- **What is guaranteed**: within a set of workers that see the same claims, all agree
  on the winner regardless of message order (fuzz-tested for permutation-invariance,
  §T-Fuzz). In the steady state, exactly one worker executes (verified live).
- **What is NOT guaranteed — by construction (CAP)**: under a **network partition**,
  two partitions can each elect a winner and both execute. This is **tolerated**: the
  results DB is keyed by `jobId`, so duplicates collapse to one logical record, and
  jobs are assumed idempotent/side-effect-free. So the honest guarantee is
  **"at-least-once, and exactly-once in the absence of partition,"** not hard
  exactly-once. A dead winner is recovered by timeout-based round-N+1 takeover
  (verified live by killing the winner mid-job).
- **Assumption (load-bearing)**: submitted jobs are **pure/idempotent** (no external
  side effects), so a rare double-execution is harmless. edgeCloud does not sandbox
  *side effects*, only resources — see L7.

### L7 — Worker sandbox: hostile submitted code (A2, A6)
This is the most adversarial layer: **the job author is assumed fully malicious.**
Defense-in-depth (validated end-to-end, §T-Sandbox):

- **Per-job unprivileged uid.** The root supervisor drops each job to uid `10002`
  (`setpriv --clear-groups --no-new-privs`). The job is not root and not the worker.
- **No access to secrets.** `/data` (libp2p key, OrbitDB state) is root-owned mode
  700 → the job uid cannot read it. *Tested: `ERR_ACCESS_DENIED`/`EACCES`.*
- **No network.** `iptables -m owner --uid-owner 10002 -j REJECT` drops all egress
  from the job uid; the worker keeps connectivity. *Tested: `ENETUNREACH`.* This is
  the key control closing the **key-exfiltration path** (read a secret → POST it
  out): the job can neither read the secret nor reach the network.
- **JS** under Node's Permission Model (`--permission --allow-fs-read/write=
  <scratch>`): filesystem confined to a throwaway scratch dir; `child_process`,
  `worker_threads`, native addons, WASI all denied. *Tested: child_process
  `ERR_ACCESS_DENIED`.*
- **WASM** under wasmtime with a **worker-constructed** argv — **`manifest.command`
  is ignored** (it was attacker-controllable and could request `--dir=/data` or
  network). One preopened dir, `inherit-network=n`, `inherit-env=n`, 256 MiB cap.
  *Tested: injected `--dir=/data` had no effect.*
- **Container**: `cap_drop: ALL` + a 5-cap allow-list (NET_ADMIN, CHOWN, SETUID,
  SETGID, KILL), `no-new-privileges`, read-only rootfs + `noexec/nosuid` tmpfs
  scratch, `pids_limit`, `cpus`, `mem_limit` (no swap), `ulimits`. Docker default
  seccomp enforced. Timeouts kill the whole process group.
- **Defense-in-depth egress**: everyone (incl. the worker) is blocked from private/
  LAN/metadata ranges (RFC1918, `169.254.169.254`, CGNAT, …).

- **Residual risk (R-006)**: this is **hardening, not a hard isolation boundary**. A
  Linux kernel / Docker / wasmtime / Node 0-day, or a container escape, defeats it.
  The worker supervisor runs as root-in-container (confined to 5 caps); a root escape
  is lower-probability but not impossible. **Side effects** of pure computation
  (CPU/heat/time) are not hidden. **gVisor (`runtime: runsc`)** is documented as the
  stronger option for the paranoid volunteer.
- **Assumptions (load-bearing)**: (a) the **container/kernel boundary holds**;
  (b) **wasmtime's WASI sandbox and Node's Permission Model are sound**; (c) Docker's
  default seccomp + the dropped caps are correctly applied by the host;
  (d) the volunteer accepts running untrusted compute at all.

### L8 — Transport / network
- **Design**: libp2p (Noise-encrypted, Yamux) between peers; the central server is a
  circuit-relay so NAT'd workers are reachable. The browser↔server channel is **plain
  HTTP**.
- **Residual risk**: no TLS on the HTTP channel (R-002): MITM can read/modify it.
  libp2p links are encrypted+authenticated by peer key, but peer *identity* is not
  tied to any human identity.
- **Assumption**: libp2p's Noise/peer-id crypto is sound (standard).

---

## 5. The central server is "honest-but-curious" — and that is the headline limitation

Because the browser is a thin client and the server bridges HTTP↔OrbitDB, **the
server sees every job's code and every result in plaintext.** A server operator (or
anyone who compromises a server, or MITMs the un-TLS'd HTTP) can:
- read what every user submits and the results they get back,
- learn which pubkeys are active,
- attest arbitrary keys (admit non-attendees).

edgeCloud provides **no confidentiality or integrity against the server operator**.
This is acceptable for a public-compute demo where jobs are non-secret. It is the
single most important thing to understand before using it for anything real — and it
is exactly the gap the Aegis/TEE direction closes.

## 6. Explicit non-goals (out of scope)

- Confidentiality of jobs/results from server operators or worker operators.
- A hard guarantee that a worker returns the *correct* result (results unsigned).
- Hard exactly-once execution under partition (at-least-once + idempotency instead).
- Proof-of-email-ownership / Sybil resistance beyond the attendee allowlist.
- Protection against kernel/hypervisor/runtime 0-days, hardware side-channels,
  rowhammer, or physical attacks on a volunteer's machine.
- Revocation of compromised server keys.
- TLS / production transport security.
- Production-grade availability / anti-DoS.

## 7. Consolidated load-bearing assumptions

1. The **genesis server private key** is uncompromised (root of all trust).
2. `EDGECLOUD_SHARED_SALT` and the **attendee CSV** stay with honest server operators.
3. **Server operators are honest** (they can read everything and attest anyone).
4. The **Docker/Linux kernel boundary**, **wasmtime WASI**, and **Node Permission
   Model** are sound (no escape from submitted code).
5. Submitted jobs are **pure/idempotent**, so rare double-execution is harmless.
6. App-layer Ed25519 verification is always run before trusting CRDT entries (it is).
7. Pinned crypto libs (tweetnacl, node:crypto) are correct, and the served page is
   delivered un-MITM'd at use time.
8. Workers/clients run the genuine, unmodified edgeCloud code.

## 8. Where the real guarantees come from next: Aegis / TEEs

The limitations above (server sees everything; worker could lie; no confidentiality)
are *architectural* for a thin-client + volunteer-Docker design. The Aegis direction
replaces the trust assumptions with hardware:
- **Confidential computing**: workers run inside **TEEs** (AMD SEV-SNP / Intel TDX
  CPUs, talking to NVIDIA GPU TEEs) so that **even the server/host operator cannot
  read or tamper with** the workload — closing §5 entirely.
- **Remote attestation**: a worker proves *what code* it is running before receiving
  work — turning the unsigned-result problem (L4/R-003) into a hardware-rooted
  integrity guarantee.
- **Physical security**: locked, camera-monitored, tamper-responding racks (key
  erasure on breach) extend the boundary to the physical layer.

That is a different security class than this prototype. edgeCloud-v1 is for **fun,
public, non-sensitive compute among Edge Esmeralda attendees**; Aegis is for
**confidential agent workloads** where not even the operator is trusted.
