# edgeCloud

A decentralized cloud built from everyday devices. edgeCloud provides:

- **Authentication** — persistent peer identities that sign and verify every message
- **Device registry** — tracking the devices available to run work
- **Job queue** — accepting and scheduling units of work
- **Job execution** — running queued jobs on registered devices

v1 runs as Node.js worker nodes (Docker) coordinated peer-to-peer over libp2p + an OrbitDB CRDT. A lightweight **rendezvous server** provides relay, discovery, and a browser bridge — so the *compute* is decentralized (jobs run on volunteer devices), though that rendezvous is still a coordination point, not a fully serverless design. See [`ARCHITECTURE.md`](ARCHITECTURE.md) / [`THREAT_MODEL.md`](THREAT_MODEL.md).

---

## ▶ Quickstart (Edge Esmeralda 2026)

A working decentralized-compute demo is built and **live at http://146.190.123.91**.
There are **three roles** — pick yours. How each one gets "onboarded" (i.e. trusted by
the network) differs, so it's called out in each section.

### 1. Non-technical user — just run a job (no install)

1. Open **http://146.190.123.91** on your phone or laptop.
2. Enter the **email you registered for Edge Esmeralda with**. Your browser generates an
   Ed25519 keypair locally (stored in `localStorage`; never leaves your device) and sends
   only the **public** key to the server.
3. **Onboarding:** the server accepts your key only if your email is on the event attendee
   list. Up to **4 keys per email** (e.g. phone + laptop). No secret/seed to manage — your
   key *is* your identity.
4. Pick an example from the dropdown or type a JavaScript expression, hit **Register** then
   submit. The job runs on a volunteer worker node and the result comes back **to you**
   (the website shows it only to a key that submitted it, proven by signing a server
   challenge — note this is HTTP access control, **not** confidentiality: results sit in
   plaintext in the replicated OrbitDB, readable by any node operator; see
   [`THREAT_MODEL.md`](THREAT_MODEL.md)).

<a id="run-a-worker"></a>
### 2. Technical user — donate compute (run a worker node)

Runs the compute. Requires Docker. **A worker is no longer anonymous** — it registers a
persistent Ed25519 identity key against your **Edge Esmeralda attendee email** (set
`EDGECLOUD_EMAIL`), the same allowlist users go through. This is what makes worker
selection accountable: a worker's identity is its base64 public key, every claim and result
is signed with it, and the network only counts claims from registered workers. You may run
up to **25 worker nodes per email** (a Sybil / work-stealing bound — see
[`THREAT_MODEL.md`](THREAT_MODEL.md) R-010). Onboarding is otherwise automatic: it dials the
genesis rendezvous server (baked into `shared/src/constants.js`), replicates the OrbitDB job
queue, and starts claiming jobs.

```bash
git clone <this repo> && cd edgeCloud/worker
export EDGECLOUD_EMAIL=you@example.com   # your Edge Esmeralda attendee email (REQUIRED)
docker compose up --build -d          # needs CAP_NET_ADMIN (compose sets it)
docker compose logs -f                # expect: "worker identity key registered" + "connected to rendezvous …"
```

> **Already running a worker from before this change?** It must be upgraded — the
> server now rejects unsigned/unregistered output and the worker refuses to start
> without an email. **Pull the latest Dockerfile and set `EDGECLOUD_EMAIL`**, then
> rebuild: `git pull && cd worker && EDGECLOUD_EMAIL=you@example.com docker compose up --build -d`.

It will appear at http://146.190.123.91/api/status (`workersOnline`, identified by its
**public key**, with its CPU/RAM/disk and free job slots). Point it at a different server with
`-e RENDEZVOUS_MULTIADDR=/ip4/<host>/tcp/4002/ws/p2p/<peerId>`. The container blocks egress
to private IPs so submitted code can't reach your LAN.

<a id="publish-prebuilt-worker"></a>
#### Publish a prebuilt multi-arch worker image (optional)

`docker compose up --build` already builds the worker **natively** on both Intel/x86
(amd64) and Apple Silicon (arm64) — the Dockerfile maps BuildKit's `TARGETARCH` to the
right wasmtime binary, so nobody needs `--platform linux/amd64` emulation. So you only
need this if you'd rather **distribute** a prebuilt image (e.g. so a roomful of Mac users
can `docker pull` one tag instead of each waiting on a local build).

`worker/build-multiarch.sh` builds `linux/amd64,linux/arm64` in one buildx pass from the
repo root and pushes a single multi-arch tag.

Prerequisites:

- Docker with **buildx** (bundled with Docker Desktop / recent Docker Engine).
- **QEMU binfmt** for cross-arch emulation if your host is single-arch (Docker Desktop
  ships it; on plain Linux run once: `docker run --privileged --rm tonistiigi/binfmt --install all`).
- `docker login <registry>` with push rights to the target image.

```bash
# Verify the cross-build works (builds both arches, does NOT push):
./worker/build-multiarch.sh

# Publish a multi-arch tag (after docker login):
IMAGE=ghcr.io/eaferstl/edgecloud-worker:latest PUSH=1 ./worker/build-multiarch.sh
```

A collaborator then skips the build entirely and just pulls + runs it (still **set
`EDGECLOUD_EMAIL`** to their attendee email; the worker needs `CAP_NET_ADMIN` for its
egress firewall):

```bash
docker pull ghcr.io/eaferstl/edgecloud-worker:latest
docker run -d --cap-add NET_ADMIN \
  -e EDGECLOUD_EMAIL=you@example.com \
  -v edgecloud_worker_data:/data \
  ghcr.io/eaferstl/edgecloud-worker:latest
```

Or with compose, point the `worker` service at the published `image:` instead of `build:`
(keep the rest of `worker/docker-compose.yml` — the capability/seccomp/read-only hardening
matters), then: `EDGECLOUD_EMAIL=you@example.com docker compose up -d`.
<a id="gpu-worker"></a>
#### Optional: a GPU worker (LLM inference jobs)

A worker with a GPU can run **`type:"inference"`** jobs — the "🤖 Ask the AI" path on the
webform. The GPU stays on your **host**: the worker just `curl`s your host's
**OpenAI-compatible** endpoint (llama-swap / Ollama / `llama-server` — anything serving
`/v1/chat/completions`), so there's **no `nvidia-container-toolkit` / `--gpus` needed inside
the container**. The election routes inference jobs *only* to GPU-capable workers
(capability-aware), and `minCores`/`minRamBytes` on a job are honored the same way.

Two env vars enable it (point the worker at the endpoint + let the firewall reach it):

```bash
# the host's OpenAI-compatible base URL (we append /v1/chat/completions)
-e EDGECLOUD_LLM_URL=http://<HOST>:9090
# allow the worker (root) to reach just that host — the sandbox uid stays fully blocked
-e EDGECLOUD_FIREWALL_ALLOW=<HOST>/32
# optional: comma-separated model names to advertise (first = default) + bearer key
-e EDGECLOUD_LLM_MODELS=lfm2.5-8b-a1b,qwen3-coder-30b-a3b  -e EDGECLOUD_LLM_API_KEY=<key>
```

What `<HOST>` is, by how the worker container reaches your machine:

| Worker runs in… | `<HOST>` | extra |
|---|---|---|
| Docker on the Linux host directly | `172.17.0.1` (docker bridge gateway) | or `host.docker.internal` with `--add-host=host.docker.internal:host-gateway` |
| Docker **inside a QEMU/KVM VM** (user-net) | `10.0.2.2` (QEMU's host alias) | the host endpoint is reached through QEMU's slirp gateway |

Make sure your inference server is reachable from the container's network (bind it so the
gateway can reach it). Then submit "🤖 Ask the AI" from the webform and the prompt runs on
your GPU worker, with the answer flowing back and replicating like any other result.

### 3. Operator — run your own central/rendezvous server

Runs the relay + OrbitDB peer + webform. Servers are interchangeable and hold **no unique
state**. Two pieces of shared config are required so every server agrees:

- **`EDGECLOUD_SHARED_SALT`** — an HMAC secret used to pseudonymize attendee emails before
  they touch OrbitDB (emails are HMAC'd, never stored in the CRDT). **Every server in the
  network must use the same salt**, distributed out-of-band with the attendee CSV. Generate
  once: `openssl rand -hex 24`.
- the **attendee CSV** (the allowlist), imported into local SQLite: `npm run import-allowlist -- attendees.csv`.

**Onboarding a *new* server (this is the trust step):** a fresh server generates its own
Ed25519 key and is **untrusted** until an existing trusted server endorses it. On any
already-trusted server run:

```bash
npm run endorse-server -- <newServerPubkey> <newServerMultiaddrs> <label>
```

The endorsement replicates over OrbitDB and workers immediately accept the new server's
user-registrations — no redeploys. Trust chains transitively from the **genesis** server
(`146.190.123.91`). Full runbook: **[`infra/provision.md`](infra/provision.md)**.

### Onboarding at a glance

| Role | Install | Secret/seed needed? | How it's trusted |
|---|---|---|---|
| **User** (browser) | none | no — keypair auto-generated in-browser | email must be on the attendee allowlist; ≤4 keys/email |
| **Worker** (Docker) | Docker | `EDGECLOUD_EMAIL` (attendee email) | registers a signing identity key against an allowlisted email; ≤25 workers/email |
| **Server** (operator) | Node 22 | yes — shared `EDGECLOUD_SHARED_SALT` + attendee CSV | endorsed by an already-trusted server (chains from genesis) |

- **Architecture & how it works:** [`ARCHITECTURE.md`](ARCHITECTURE.md) (authoritative)
- **Stack:** js-libp2p 3 · Helia 6 · OrbitDB 4 · Node 22 · Express 5 · tweetnacl (no Kubo)
- **Code:** `shared/` (job/crypto/trust logic), `server/` (rendezvous + webform),
  `worker/` (Docker compute node)
- **Tests:** `npm test`
- **Security:** [`THREAT_MODEL.md`](THREAT_MODEL.md) (what it does/doesn't protect, load-bearing assumptions) · [`SECURITY_TESTING.md`](SECURITY_TESTING.md) (every security test we ran + results)
- **Roadmap / vision (decentralized AWS):** [`ROADMAP.md`](ROADMAP.md)
- **Credits / collaborators:** [`CREDITS.md`](CREDITS.md)

The earlier Kubo/go-ipfs container scaffold (`node-ipfs-container/`, `HANDOFF.md`) is
**superseded** by the OrbitDB + Helia stack and kept only for reference.

## Scaffolding sections added by agent

This repository also contains documentation and implementation work for a short prototype build of a decentralized Cloud system.

The build is organized around a 3-day sprint with several parallel teams:

| Team | Lead / Owner | Folder |
|---|---|---|
| Authentication | Kevin | `auth/` |
| Device Registry | Chao | `device_registry/` |
| Job Queue | Cam and Eliot | `job_queue/` |
| Job Execution | Steve and Maroua | `job_execution/` |
| Coordination | Keith | `coordination/` |
| Legal | Legal team | `legal/` |

## Prototype goal

v1 demonstrates decentralized **compute**: a user submits a **signed JS or WASM job**; worker nodes coordinate over an OrbitDB CRDT to run it **exactly-once** (a deterministic claim tiebreak — no central scheduler), execute it in a hardened sandbox, and return the result through OrbitDB. A lightweight rendezvous server provides relay + a browser bridge. (Running arbitrary containers / long-running services is a *future* direction, not the current build.)

The end-to-end workflow spans:

- node/peer identity and signing,
- device registration,
- job submission,
- job queueing,
- job assignment or claiming,
- job execution,
- result/status reporting,
- legally reviewed presentation language.

This is a prototype for demo/presentation purposes. It is not assumed to be production-ready.

---

## Repo navigation

Start here:

1. `00_master_prd.md` - overall prototype scope and demo promise.
2. `01_top_level_tasks.md` - current task list, blockers, cuts, and status.
3. `02_integration_contracts.md` - shared interface contracts between teams.
4. `docs/architecture.md` - shared technical architecture: schemas, stack, protocols, constants.
5. `03_demo_script.md` - planned live demo flow.
6. `04_decisions_risks_cuts.md` - decisions, risks, cuts, and blockers.
7. Team folders - local PRDs/specs.

---

## Documentation authority order

1. `00_master_prd.md` defines the overall demo promise and scope.
2. `02_integration_contracts.md` defines shared interfaces and overrides team-local conflicts.
3. `01_top_level_tasks.md` tracks project execution status.
4. Team `prd.md` files define each team's contribution.
5. Team `spec.md` files define implementation details.
6. `03_demo_script.md` defines the live presentation path.
7. `04_decisions_risks_cuts.md` records decisions, risks, cuts, and blockers.
8. `legal/spec.md` governs legal/commercial presentation language.

Technical reference: `docs/architecture.md` holds the canonical schemas, stack, protocols, and constants. It is the technical source of truth; ratified shared contracts are recorded and frozen in `02_integration_contracts.md`.

---

## Status values

Use these consistently:

- `Not Started`
- `Building`
- `Blocked`
- `Integrated`
- `Demo Ready`
- `Cut`

---

## How teams should work

Each team should fill out its own:

```text
<team>/prd.md
<team>/spec.md
```

Keep team docs short, concrete, and demo-oriented.

Use a lightweight PRD > Spec > Code flow:

1. Team `prd.md` defines the module's demo contribution, boundaries, dependencies, handoffs, acceptance checks, and limitations.
2. Team `spec.md` translates that module PRD into a buildable handoff: approach, interfaces, data/state, likely files, and verification.
3. Code follows the spec. If the spec does not say what to build and how to verify it, update the spec before coding.

Team PRDs should not become standalone product PRDs. The master demo promise lives in `00_master_prd.md`; team PRDs describe composable modules that support it.

All shared assumptions must be reflected in:

```text
02_integration_contracts.md
```

All major decisions, risks, and cuts must be reflected in:

```text
04_decisions_risks_cuts.md
```

Future AI agents should read `AGENTS.md` before making changes.
