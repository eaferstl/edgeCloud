# edgeCloud

A decentralized cloud built from everyday devices. edgeCloud provides:

- **Authentication** — verifying users and devices joining the network
- **Device registry** — tracking the devices available to run work
- **Job queue** — accepting and scheduling units of work
- **Job execution** — running queued jobs on registered devices

It runs on iPhones to start.

---

## ▶ Implemented prototype (Edge Esmeralda 2026)

A working decentralized-compute demo is built and **live at `http://146.190.123.91`**.
Open it (mobile or desktop), register the email you used for Edge Esmeralda, and
submit a JavaScript expression or a WASM module — it runs on a volunteer worker node
over a libp2p/OrbitDB network and the result comes back to you only.

- **Architecture & how it works:** [`ARCHITECTURE.md`](ARCHITECTURE.md) (authoritative)
- **Stack:** js-libp2p 3 · Helia 6 · OrbitDB 4 · Node 22 · Express 5 · tweetnacl (no Kubo)
- **Code:** `shared/` (job/crypto/trust logic), `server/` (rendezvous + webform),
  `worker/` (Docker compute node)
- **Run a worker:** `cd worker && docker compose up --build -d` (needs `NET_ADMIN`)
- **Deploy a server:** [`infra/provision.md`](infra/provision.md)
- **Tests:** `npm test`

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
