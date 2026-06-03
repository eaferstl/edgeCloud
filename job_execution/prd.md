# PRD: Job Execution

## Status

Status: `Not Started`
Owner: Steve / Maroua
Team: Job Execution
Last updated: TODO

---

## Module purpose

TODO: In one short paragraph, state what Job Execution must make true for the shared demo.

This is a module PRD, not a standalone product PRD. Keep it focused on Job Execution's contribution to the master demo promise in `../00_master_prd.md`.

---

## Owned responsibilities

- TODO: Define the demo workload that can run on a worker/device.
- TODO: Define how a worker receives, claims, or is assigned work for the demo.
- TODO: Define how execution status and results are reported back.

---

## Not owned

- TODO: List execution-adjacent work this team is not doing for the 2-day demo.
- TODO: List any production sandboxing, arbitrary code execution, or workload isolation intentionally out of scope.

---

## Inputs and dependencies

| Needed from | What Job Execution needs | Required for demo | Notes |
|---|---|---|---|
| TODO | TODO | Yes / No |  |

---

## Outputs and handoffs

| Job Execution provides | Consumed by | Defined in | Notes |
|---|---|---|---|
| TODO | TODO | `../02_integration_contracts.md` |  |

Shared IDs, payloads, commands, events, or statuses must also be reflected in `../02_integration_contracts.md`.

---

## Demo acceptance

Job Execution is good enough for the demo when:

- [ ] TODO: A worker/device can run the selected demo workload.
- [ ] TODO: Execution status and result can be returned to the shared demo flow.
- [ ] TODO: The demo can show or explain execution without unsupported sandboxing or production claims.
- [ ] Relevant contracts are current in `../02_integration_contracts.md`.
- [ ] The implementation check in `spec.md` passes.

---

## Known limitations

- TODO: Document prototype-only execution limitations.
- TODO: Document any sandboxing, security, or arbitrary-code claims the demo must avoid.
