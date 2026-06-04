# PRD: Device Registry

## Status

Status: `Not Started`
Owner: Chao
Team: Device Registry
Last updated: TODO

---

## Module purpose

TODO: In one short paragraph, state what Device Registry must make true for the shared demo.

This is a module PRD, not a standalone product PRD. Keep it focused on Device Registry's contribution to the master demo promise in `../00_master_prd.md`.

---

## Owned responsibilities

- TODO: Define how demo devices appear, register, or advertise availability.
- TODO: Define the minimum device metadata needed by queue/execution modules.
- TODO: Define how the demo can tell whether a device is available enough to receive work.

---

## Not owned

- TODO: List registry-adjacent work this team is not doing for the 3-day demo.
- TODO: List any production fleet management, trust, or monitoring work intentionally out of scope.

---

## Inputs and dependencies

| Needed from | What Device Registry needs | Required for demo | Notes |
|---|---|---|---|
| TODO | TODO | Yes / No |  |

---

## Outputs and handoffs

| Device Registry provides | Consumed by | Defined in | Notes |
|---|---|---|---|
| TODO | TODO | `../02_integration_contracts.md` |  |

Shared IDs, payloads, commands, events, or statuses must also be reflected in `../02_integration_contracts.md`.

---

## Demo acceptance

Device Registry is good enough for the demo when:

- [ ] TODO: At least one demo device can appear as available.
- [ ] TODO: Other modules know what device data to consume.
- [ ] TODO: The demo can show or explain device availability without unsupported fleet claims.
- [ ] Relevant contracts are current in `../02_integration_contracts.md`.
- [ ] The implementation check in `spec.md` passes.

---

## Known limitations

- TODO: Document prototype-only registry limitations.
- TODO: Document any production, trust, or fleet-management claims the demo must avoid.
