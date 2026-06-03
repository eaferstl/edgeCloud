# AGENTS.md

## Purpose

This file tells AI agents how to navigate and update this repository.

The repository supports a short prototype build for a decentralized Cloud demo. The repo is organized around team-owned documentation plus top-level coordination files.

Agents should preserve the existing structure unless explicitly asked to reorganize it.

---

## Read order for agents

When starting work, read these files first:

1. `README.md`
2. `00_master_prd.md`
3. `02_integration_contracts.md`
4. `01_top_level_tasks.md`
5. `03_demo_script.md`
6. `04_decisions_risks_cuts.md`

Then read the relevant team folder:

- `auth/prd.md` and `auth/spec.md`
- `device_registry/prd.md` and `device_registry/spec.md`
- `job_queue/prd.md` and `job_queue/spec.md`
- `job_execution/prd.md` and `job_execution/spec.md`
- `coordination/prd.md` and `coordination/spec.md`
- `legal/prd.md` and `legal/spec.md`

---

## Documentation authority order

Use this order when resolving conflicts:

1. `00_master_prd.md` defines the overall demo promise and scope.
2. `02_integration_contracts.md` defines shared interfaces and overrides team-local conflicts.
3. `01_top_level_tasks.md` tracks project execution status.
4. Team `prd.md` files define each team's contribution.
5. Team `spec.md` files define implementation details.
6. `03_demo_script.md` defines the live presentation path.
7. `04_decisions_risks_cuts.md` records decisions, risks, cuts, and blockers.
8. `legal/spec.md` governs legal/commercial presentation language.

Do not silently resolve conflicts. If two docs disagree, update the lower-authority doc or add a note in `04_decisions_risks_cuts.md`.

---

## Team folders

Each team folder contains:

```text
prd.md
spec.md
```

The `prd.md` file explains what the team is responsible for in the prototype.

The `spec.md` file explains how the team expects to implement and integrate that responsibility.

The spec should always include a **Manual Test / Integration Check** section so another team or future agent can verify the subsystem.

---

## Status values

Use these status values consistently:

- `Not Started`
- `Building`
- `Blocked`
- `Integrated`
- `Demo Ready`
- `Cut`

Definitions:

- `Not Started`: no meaningful work yet.
- `Building`: actively being implemented or drafted.
- `Blocked`: cannot proceed without a decision, dependency, or fix.
- `Integrated`: works with at least one other subsystem.
- `Demo Ready`: works in the end-to-end demo path.
- `Cut`: explicitly removed from current demo scope.

---

## Editing rules for agents

When editing docs:

1. Do not invent team requirements unless explicitly instructed.
2. Do not invent APIs, schemas, or legal conclusions.
3. Leave clear TODOs for team-owned decisions.
4. Keep docs short and operational.
5. Prefer tables and checklists over long prose.
6. Update `01_top_level_tasks.md` when adding or changing work.
7. Update `02_integration_contracts.md` when changing shared payloads, IDs, statuses, endpoints, or cross-team assumptions.
8. Update `04_decisions_risks_cuts.md` when making a decision, identifying a serious risk, or cutting scope.
9. If changing presentation language, check `legal/spec.md`.
10. If changing the live demo path, update `03_demo_script.md`.

---

## Contract-change rule

After integration contracts are marked frozen, changes to shared IDs, payloads, statuses, endpoints, or required cross-team calls require approval from:

- Keith / Coordination
- the producing team lead
- the consuming team lead

Record approved contract changes in `04_decisions_risks_cuts.md`.

---

## Demo-readiness rule

A subsystem is not `Demo Ready` merely because its local code works.

A subsystem may be marked `Demo Ready` only when:

- its local acceptance criteria are satisfied,
- its manual integration check passes,
- at least one consuming or producing team has successfully integrated with it,
- its known limitations are documented,
- it does not block the top-level demo path.

---

## Legal/commercial claim rule

Do not add claims that the prototype is:

- production-ready,
- secure against arbitrary malicious devices,
- fully decentralized in every respect,
- compliance-ready,
- privacy-preserving in a production/legal sense,
- trustless,
- enterprise-ready,
- certified,
- audited,
- safe for arbitrary untrusted code execution,

unless Legal has explicitly approved the wording in `legal/spec.md`.

---

## Current teams

| Team | Lead / Owner | Folder |
|---|---|---|
| Authentication | Kevin | `auth/` |
| Device Registry | Chao | `device_registry/` |
| Job Queue | Cam and Elliot | `job_queue/` |
| Job Execution | Steve and Maroua | `job_execution/` |
| Coordination | Keith | `coordination/` |
| Legal | Legal team | `legal/` |
