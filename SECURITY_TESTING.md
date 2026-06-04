# edgeCloud — Security Testing Record

This document records the concrete tests run to validate the security claims in
[`THREAT_MODEL.md`](THREAT_MODEL.md). Each entry states **what is claimed**, **how it
was tested**, the **command/method**, and the **observed result**. Automated tests
live under `*/test/`; the sandbox tests were run against the real hardened container
image and the live VPS deployment.

Legend: ✅ = verified pass · 🔬 = empirical validation before implementation.

Reproduce the automated suite:
```bash
EDGECLOUD_SHARED_SALT=testsalt node --test     # 30 tests across shared/ server/ worker/
```

---

## A. Automated tests (30, all passing)

### T-Fuzz — property/fuzz tests for protocol-critical pure logic
`shared/test/fuzz.test.js` (seeded PRNG, reproducible). Claims and results:

| Property tested | Invariant asserted | Result |
|---|---|---|
| `claimWinner` (exactly-once core) | permutation-invariant; one valid winner; ignores other rounds/jobs; duplicates don't change winner; winner has globally-minimal rank | ✅ |
| `validateClaim` | rejects every single-field mutation (bad version/jobId/peerId/round) | ✅ |
| `canonicalJson` | object key-order independent; array-order sensitive; omits `undefined` | ✅ |
| `buildJobZipB64`/`jobIdOf` | same logical job → identical bytes + jobId; parse round-trips | ✅ |
| `verifyEnvelope` | valid accepted; **any** mutation of zip/jobId/pubkey/sig rejected; nonce/submittedAt mutations still accepted (not identity) | ✅ |
| `computeTrustedServers` | endorsement-order independent; transitive from genesis; cycle-safe; **forged endorsements and rogue self-cycles excluded**; empty genesis → empty set | ✅ |
| `verifyAttestation` | only trusted-server attestations accepted; untrusted attester rejected; signed-field tampering rejected | ✅ |

### T-Browser — the real shipped browser crypto pipeline
`server/test/browser-pipeline.test.js`. Loads the **actual vendored** `nacl.min.js`,
`sha256.min.js`, `fflate.min.js` in a VM realm and runs the exact `public/app.js`
zip/hash/sign steps. Asserts the browser-built envelope is deterministic and
**verifies with the shared server/worker code**, and that browser-signed challenges
verify server-side. ✅

### T-Trust — trust chain unit tests
`shared/test/trust.test.js`: genesis→B→C transitive trust; forged-signature
endorsements ignored; attestations only honored from trusted servers; claim winner
deterministic. ✅

### T-CSV — allowlist import
`server/test/csv.test.js`: quoted-field CSV parsing; Email column extraction
(lowercased, blanks skipped); rejects a CSV with no Email column. ✅

---

## B. Worker sandbox — empirical validation (🔬 before implementing)

Before writing the hardening, the three core mechanisms were validated in a
throwaway container so the design couldn't be wrong on deploy.

### T-Mech1 — can the root supervisor drop a job to an unprivileged uid? 🔬
`setpriv --reuid 10002 --regid 10002 --clear-groups node -e 'process.getuid()'` →
**ran as 10002**. ✅

### T-Mech2 — does Node's Permission Model block `/data` reads? 🔬
`node --permission --allow-fs-read=<scratch> --allow-fs-write=… evil.js` where
`evil.js` reads `/data/peer-key.bin` → **`BLOCKED: ERR_ACCESS_DENIED`**. Also, the
same read as uid 10002 *without* `--permission` → **`EACCES`** (filesystem perms).
Double protection. ✅

### T-Mech3 — does per-uid iptables block the job's network but not the worker's? 🔬
`iptables -A OUTPUT -m owner --uid-owner 10002 -j REJECT`; then:
- worker (root) `curl http://146.190.123.91/api/status` → **200** ✅
- sandbox (uid 10002) same curl → **000 (blocked)** ✅

### T-Mech4 — full chain under the real capability set 🔬
Re-ran in a container with `--cap-drop ALL --cap-add NET_ADMIN,CHOWN,SETUID,SETGID,
KILL --security-opt no-new-privileges --read-only --tmpfs /tmp`. Confirmed: effective
caps = exactly the 5 (CapEff `0x10e1`); iptables installs; compute runs as 10002;
worker keeps network. Surfaced the real `cap_drop`→no-`DAC_OVERRIDE` consequence,
which is why the entrypoint explicitly `chown`s `/data` (fixed before deploy). ✅

---

## C. Worker sandbox — full attack matrix (hardened image)

Run **inside the built hardened container** via the worker's own `executeJob()`
(`worker/src/executor/run.js`), i.e. the exact production path. Each row submits a
job and reports what the sandbox allowed.

| # | Job | Expected | Observed |
|---|---|---|---|
| 1 | `console.log(6*7)` (compute) | runs | **`42`, exit 0** ✅ |
| 2 | `fs.readFileSync('/data/peer-key.bin')` | blocked | **`BLOCKED:ERR_ACCESS_DENIED`** ✅ |
| 3 | `fetch('http://146.190.123.91/...')` | blocked | **`NET-BLOCKED:ENETUNREACH`** ✅ |
| 4 | `child_process.execSync('id')` | blocked | **`BLOCKED:ERR_ACCESS_DENIED`** ✅ |
| 5 | `process.getuid()` | non-root, non-worker | **`uid=10002`** ✅ |
| 6 | WASM `primes.wasm` (compute) | runs | **`2, 3, 5, 7, 11, …`, exit 0** ✅ |
| 7 | WASM manifest with `command:['wasmtime','run','--dir=/data',…]` | injection ignored | **ran with worker-built argv; `--dir=/data` had no effect** ✅ |

## D. Worker sandbox — verified on the LIVE VPS deployment

Run against the actually-deployed Docker worker on `146.190.123.91` (`docker exec`):

| Target | Expected | Observed |
|---|---|---|
| `http://146.190.123.91/api/status` (own public IP) | allowed for worker | **200** ✅ |
| `http://169.254.169.254/` (cloud metadata) | blocked | **000** ✅ |
| `http://10.48.0.12/` (host private IP) | blocked | **000** ✅ |
| `http://172.17.0.1/` (docker bridge gateway) | blocked | **000** ✅ |
| `https://example.com/` (public + DNS) | allowed for worker | **200** ✅ |

Deployed to **both** worker nodes (VPS + a QEMU/KVM VM acting as a separate client
machine); both boot with `[firewall] all egress blocked for sandbox uid 10002`.

---

## E. Application-layer auth & isolation (live network)

### T-Submitter — unregistered / forged submitter rejected
- A job whose pubkey is not in the registry → server `POST /api/jobs` returns **403
  "public key is not registered"**; a worker that sees such a job rejects it **after**
  the registry re-sync grace (never on stale data). ✅
- A hand-built envelope with a bad signature → `verifyEnvelope` rejects before unzip. ✅

### T-ResultAuth — only the submitter reads a result
`scripts/e2e-client.mjs` registers a *second* key and tries to fetch another key's
result via challenge/response → **403** ("this key did not submit that job").
Fetching without a signed-nonce session → **401**. ✅

### T-KeyLimit — ≤4 keys per email
Registering a 5th key for one email → **409 "this email already has 4 registered
keys"**. ✅

### T-Allowlist — non-attendee can't register
`POST /api/register` with an email not on the attendee list → **403 "email is not on
the Edge Esmeralda attendee list"**. ✅

### T-EmailPrivacy — no raw email in OrbitDB
The registry attestation written to OrbitDB contains `{pubkey, emailHmac, addedAt,
attestedBy, attestSig}` — only `HMAC-SHA256(email, SHARED_SALT)`, never the email.
(Code-reviewed; the register path writes only `emailHmac`.) ✅

---

## F. Coordination — race / takeover behavior (live)

### T-ExactlyOnce — one execution per job
With two live workers, each job's result carries a single `executedBy`; the losing
worker cancels its backup timer (worker logs: `round 0 winner is … — standing by`).
✅ (in-the-absence-of-partition guarantee; see THREAT_MODEL §L6)

### T-Takeover — dead winner is recovered
Submitted a slow job, identified the round-0 winner from its logs, **killed that
worker mid-execution**. The surviving worker logged `no result from round-0 winner;
taking over (round 1)` → `won claim round 1 — executing` → `result published`, and
the job completed. ✅

### T-Cache — duplicate submission doesn't re-execute
Submitting identical code twice → second `POST /api/jobs` returns
**`status:"done", cached:true`** with no new claim/execution activity. ✅

### T-Endorse — multi-server trust replicates
Stood up a second central server (untrusted), registered a user on it, submitted a
job → workers **rejected it after the registry grace** (server untrusted). Then
endorsed the second server from the genesis server; the endorsement replicated; the
worker's trusted-server count went **1→2**, verified keys **2→3**, and the
previously-rejected job **executed**. ✅

---

## G. Post-hardening regression (live, both workers)

After deploying the aggressive sandbox to both worker nodes, complex jobs still run:
- 100 digits of π (BigInt Machin formula) → correct, executed by the VPS worker. ✅
- `fibonacci(300)` exact BigInt → correct. ✅
- `primes.wasm` → correct, executed by the VM worker. ✅

Confirms the hardening did not break legitimate compute.

---

## What is NOT covered by these tests (honest gaps)

- **Result spoofing** (THREAT_MODEL R-003): results are unsigned; we did not test
  defense because there is none — a fast attacker can write a wrong result for a
  jobId. Documented, accepted.
- **Partition double-execution** (L6): we tested takeover and dedupe, not a true
  network partition with two simultaneous executors. The design *tolerates* it; the
  coordinator partition-simulation harness is planned but not yet implemented.
- **Kernel/Docker/wasmtime/Node 0-day escape** (R-006): out of scope; mitigated by
  defense-in-depth and the optional gVisor runtime, not eliminated.
- **MITM on plain HTTP** (R-002): no TLS; not tested because it is a known accepted
  limitation for the demo.
- **Server-operator confidentiality**: by design the server sees plaintext jobs and
  results; nothing tested because nothing is claimed (see THREAT_MODEL §5).
