# edgeCloud — Roadmap

The ultimate vision is a **decentralized AWS**: anyone can rent out spare compute, and
anyone can run arbitrary workloads on the network with cloud-grade ergonomics — but
without a central provider. This file collects candidate next steps. It is a wish-list /
design backlog, not a commitment; items are roughly grouped, not strictly ordered.

Today's v1 is a working decentralized-compute prototype: signed JS/WASM jobs, an
OrbitDB-coordinated exactly-once-ish claim protocol, hardened Docker workers. See
`ARCHITECTURE.md` and `THREAT_MODEL.md` for the as-built and its honest limits.

---

## A. Run *anything* (beyond single-shot JS/WASM)

- **Arbitrary job runtimes** — Python, native binaries, etc. (each a sandboxed runtime
  a worker advertises support for), not just JS/WASM.
- **Long-running processes / services** — jobs that stay up (a server, a bot, a daemon),
  with a lifecycle (start/stop/health/restart), logs, and a stable address — not just
  compute-and-exit.
- **Push whole Docker/OCI containers** — submit an image; the worker runs it. (Caveat:
  Docker-in-Docker is fragile.)
- **Fly.io-style image unpacking** — instead of DinD, unpack the OCI image and run its
  rootfs directly in a lightweight VM/sandbox (Firecracker microVM, or `crun`/runc as the
  worker's own runtime) — more efficient, avoids nested Docker.
- **Large-data I/O** — *(empirically motivated: a streaming WASM doubler turns 100 MB →
  200 MB at ~25 MB peak RAM, well under the 256 MiB wasm cap; the blockers are NOT
  compute but the envelope.)* Today the input is embedded in the job zip
  (`MAX_ZIP_B64_BYTES` = 4 MiB) and the result is captured stdout (`MAX_OUTPUT_BYTES` =
  256 KiB), and worker scratch is a 128 MiB tmpfs — so a 100 MB job can't even enter or
  leave. Fix: move inputs/outputs **out-of-band as content-addressed blobs** — the job
  manifest carries blob references (hash/CID + size); the worker streams input blobs to
  real disk (verifying the hash), the program reads/writes files in scratch as today, and
  the worker stores the output as a new blob and returns its hash in the result envelope.
  Needs: a blob store (see §E), scratch backed by real disk (not a 128 MiB tmpfs), and
  fetch/put + integrity checks in the worker.
- **Streaming / interactive jobs** — stdin/stdout streaming, or sending events to a
  running job.

## B. Trust & verification (don't trust the worker)

**✅ Shipped (the accountable-identity baseline):**
- **Accountable, non-grindable worker selection.** The tiebreak is now
  `min sha256(jobId‖workerKey‖round)` over **signed, key-bound** claims, and worker
  identity is a **non-rotatable Ed25519 key registered against an allowlisted attendee
  email** (≤25 worker keys/email). The coordinator counts claims **only from registered
  workers**, so the candidate supply is bounded by the attendee list instead of the
  infinite supply of free peerIds the original design allowed — grinding now costs real,
  rate-limited identities rather than a hash loop. (`THREAT_MODEL.md` R-010.)
- **Signed results.** The executing worker signs its result with its identity key; the
  server verifies before caching/serving and workers verify before treating a job as done
  — closing *third-party* result forgery (`THREAT_MODEL.md` R-003).

**Next (detecting a *registered worker that lies* — signing proves who, not what):**
- **Redundant compute with disagreement-triggered recompute** (the Golem optimization) —
  run a job on 2 workers; compute a **3rd only if the first two disagree**. Near-free
  verification — no 3× cost on the happy path. Composes with reputation (below).
- **Determinism as content-addressing** (the brilliantly-simple version) — since a job is
  a pure function of its inputs, honest workers produce **byte-identical** output, so the
  **hash of the result is itself the agreement token**: matching hashes from independent
  registered identities confirm correctness with no coordinator; a mismatch is a provable
  dispute.
- **Reputation as a disincentive to lie / to grind** — weight selection and result
  acceptance by a per-key / per-email reputation that drops sharply on any detected
  disagreement. With email-gated identity, a burned reputation is costly to shed, which
  also disincentivizes the in-quota grinding remainder under R-010.
- **Non-grindable tiebreak input** — a per-round randomness beacon / VRF / commit-reveal
  revealed only *after* claims are locked, so even a registered worker can't pre-compute
  the winning value.
- **TEEs for execution** — workers run in AMD SEV-SNP / Intel TDX (+ GPU TEEs) so the
  *operator* can't see or tamper with the workload; **remote attestation** proves what
  code ran. (The Aegis/Aestrel direction.)
- **Verifiable compute / proofs** — zk or replicated-execution proofs for workloads that
  warrant it (long-horizon).

## C. Confidentiality (don't let the network see your data)

- **Encrypt results to the submitter** (sealed box) so the public OrbitDB holds only
  ciphertext.
- **Assign-first-then-encrypt** — use the public layer only to *select* a worker; send
  the payload **encrypted point-to-point** to that worker, encrypted result back — so
  inputs aren't world-readable (encrypting only the output is weak if inputs are public).
- **TEEs** (again) — the only thing that hides data from the *worker doing the work*.

## D. The "AWS control plane" — scheduling, reputation & economics

- **Reputation** — a standing attached to identities, used to throttle/revoke abusers and
  to prefer trustworthy workers. **Granularity matters: track reputation per *key* AND
  aggregate per *account* (the email/identity that owns up to 4 keys).** Per-key catches
  a single bad device/credential; per-account prevents someone from dodging a bad
  reputation by rotating to a fresh key under the same account, and lets good standing
  follow the person across their devices. Reputation gates: a "run fresh / no-cache" mode
  (otherwise a DoS vector — resubmit an expensive job forever), worker selection
  (down-weight low-rep or unproven nodes so a grinded Sybil can't win — see §B), and
  rate/quota limits (compute-per-unit-time scaled by standing).
- **A compute market / pricing** — workers advertise a price (`pricePerJobUsd` is a
  reserved field already); requesters choose on price/latency/reputation; spot vs
  on-demand vs priority tiers.
- **Least-loaded / capability-aware scheduling** — route by the live `availableCapacity` +
  specs already published in heartbeats (vs today's deterministic-hash tiebreak).
- **Billing / credits / metering** — pay-per-job accounting (credits, tokens, or usage).
- **SLAs & deadlines** — "run within N seconds or reassign"; retries/backoff as policy.

## E. Storage & state (the S3 / EBS analog)

- **Content-addressed blob store** — durable, replicated dataset storage independent of
  jobs (the input/output substrate for §A's large-data jobs).
- **Persistent volumes** — long-running services that keep data across restarts/migrations.
- **Datasets / caching** — pin popular inputs near compute.

## F. Networking & exposure (the ELB / public-endpoint analog)

- **Resilient worker presence (self-healing heartbeats).** ✅ **baseline shipped.**
  Presence is a gossipsub heartbeat on `edgecloud/heartbeat/v1`, decoupled from correctness
  (the claim set is the candidate set), so a worker can keep replicating + executing jobs
  while *invisible* in the "workers online" pill. The cause was that the worker only
  *published* (ephemeral gossipsub fan-out), so after the rendezvous/server restarted the
  fan-out state went stale and heartbeats stopped arriving though OrbitDB was fine. Fix
  (done): the worker now **subscribes** to the topic, making it a real mesh member;
  gossipsub re-GRAFTs the mesh on its own heartbeat after a reconnect, so presence
  self-heals without a manual container restart. **Remaining (future):** also derive
  presence from live libp2p connections + a server-side liveness probe (belt-and-
  suspenders), so the UI never under-reports a working fleet even if pubsub misbehaves —
  this also feeds a future least-loaded scheduler (§D) that reads the same heartbeats.
- **Expose a service on a stable URL/port** — reach a long-running job from the outside
  (via the relay or a gateway).
- **Service discovery & addressing** — name → current worker(s); migrate transparently.

## G. Decentralize the platform itself

- **Remove the single rendezvous** — multi-rendezvous bootstrap; capable clients join
  libp2p directly (no privileged server in the data path). Multiple interchangeable
  servers already work via the endorsement chain.
- **DHT-free or hardened discovery** — without re-leaking to public IPFS.
- **Geographic / edge placement** — run near the user; "regions" as an emergent property
  of who's online where.

## H. Developer experience

- **CLI + SDK** — `edgecloud run ./job`, `edgecloud deploy`, stream logs, list jobs.
- **Deploy-from-repo** — point at a Git repo / Dockerfile; it builds + runs.
- **Logs, metrics, dashboards** — observability for jobs/services.
- **Web console** — manage jobs/services/keys/credits.

---

## The endgame

Both **decentralized** (A, G — anyone's devices, no central provider) **and**
**confidential + verifiable** (B, C — TEEs/attestation so neither the network nor the
operator is trusted). Those pull in different directions today (TEEs re-centralize on
cloud/hardware vendors); closing that gap — confidential compute that's also genuinely
decentralized — is the hard, interesting problem (cf. darkbloom.dev).
