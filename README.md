# edgeCloud

A decentralized cloud built from everyday devices. edgeCloud provides:

- **Authentication** — persistent peer identities that sign and verify every message
- **Device registry** — tracking the devices available to run work
- **Job queue** — accepting and scheduling units of work
- **Job execution** — running queued jobs on registered devices

v1 runs as Node.js worker nodes running Docker on VMs/hosts, coordinated peer-to-peer over libp2p with a shared OrbitDB device registry — no central server.

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

v1 demonstrates decentralized **serverless function execution**: a user submits a containerized job, and the network schedules it to the lowest-latency capable peer, runs it in Docker, and streams the result back — coordinated peer-to-peer with no central server.

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
