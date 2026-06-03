# PRD: Job Queue

## Status

Status: `Not Started`
Owner: Cam / Elliot
Team: Job Queue
Last updated: TODO

---

## Module purpose

TODO: In one short paragraph, state what Job Queue must make true for the shared demo.

This is a module PRD, not a standalone product PRD. Keep it focused on Job Queue's contribution to the master demo promise in `../00_master_prd.md`.

---

## Owned responsibilities

- TODO: Define how a demo job is submitted or represented.
- TODO: Define the minimum job lifecycle needed for the demo path.
- TODO: Define how job state is exposed to coordination, execution, or the final display.

---

## Not owned

- TODO: List queue-adjacent work this team is not doing for the 2-day demo.
- TODO: List any production scheduling, exactly-once, billing, or general workload support intentionally out of scope.

---

## Inputs and dependencies

| Needed from | What Job Queue needs | Required for demo | Notes |
|---|---|---|---|
| TODO | TODO | Yes / No |  |

---

## Outputs and handoffs

| Job Queue provides | Consumed by | Defined in | Notes |
|---|---|---|---|
| TODO | TODO | `../02_integration_contracts.md` |  |

Shared IDs, payloads, commands, events, or statuses must also be reflected in `../02_integration_contracts.md`.

---

## Demo acceptance

Job Queue is good enough for the demo when:

- [ ] TODO: A demo job can be submitted or staged.
- [ ] TODO: The job can move through the minimum lifecycle needed by Job Execution.
- [ ] TODO: The demo can show or explain job state without unsupported scheduling guarantees.
- [ ] Relevant contracts are current in `../02_integration_contracts.md`.
- [ ] The implementation check in `spec.md` passes.

---

## Known limitations

- TODO: Document prototype-only queue limitations.
- TODO: Document any delivery, ordering, or exactly-once claims the demo must avoid.
