# edgeCloud

A decentralized cloud built from everyday devices. edgeCloud provides:

- **Authentication** — verifying users and devices joining the network
- **Device registry** — tracking the devices available to run work
- **Job queue** — accepting and scheduling units of work
- **Job execution** — running queued jobs on registered devices

It runs on iPhones to start.

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
   submit. The job runs on a volunteer worker node and the result comes back **to you only**
   (proven by signing a server challenge with your key).

### 2. Technical user — donate compute (run a worker node)

Runs the compute. Requires Docker. **No registration or secret needed** — a worker is
anonymous; it just needs to reach a server. Onboarding is automatic: it dials the genesis
rendezvous server (baked into `shared/src/constants.js`), replicates the OrbitDB job queue,
and starts claiming jobs.

```bash
git clone <this repo> && cd edgeCloud/worker
docker compose up --build -d          # needs CAP_NET_ADMIN (compose sets it)
docker compose logs -f                # expect: "connected to rendezvous …"
```

It will appear at http://146.190.123.91/api/status (`workersOnline`, with its CPU/RAM/disk
and free job slots). Point it at a different server with
`-e RENDEZVOUS_MULTIADDR=/ip4/<host>/tcp/4002/ws/p2p/<peerId>`. The container blocks egress
to private IPs so submitted code can't reach your LAN.

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
| **Worker** (Docker) | Docker | no | anonymous; just dials a server and replicates |
| **Server** (operator) | Node 22 | yes — shared `EDGECLOUD_SHARED_SALT` + attendee CSV | endorsed by an already-trusted server (chains from genesis) |

- **Architecture & how it works:** [`ARCHITECTURE.md`](ARCHITECTURE.md) (authoritative)
- **Stack:** js-libp2p 3 · Helia 6 · OrbitDB 4 · Node 22 · Express 5 · tweetnacl (no Kubo)
- **Code:** `shared/` (job/crypto/trust logic), `server/` (rendezvous + webform),
  `worker/` (Docker compute node)
- **Tests:** `npm test`
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
| Job Queue | Cam and Elliot | `job_queue/` |
| Job Execution | Steve and Maroua | `job_execution/` |
| Coordination | Keith | `coordination/` |
| Legal | Legal team | `legal/` |

## Prototype goal

TODO: Coordination to finalize.

At a high level, the prototype should demonstrate a decentralized Cloud workflow involving:

- user/session identity,
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
4. `03_demo_script.md` - planned live demo flow.
5. `04_decisions_risks_cuts.md` - decisions, risks, cuts, and blockers.
6. Team folders - local PRDs/specs.

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

All shared assumptions must be reflected in:

```text
02_integration_contracts.md
```

All major decisions, risks, and cuts must be reflected in:

```text
04_decisions_risks_cuts.md
```

Future AI agents should read `AGENTS.md` before making changes.
