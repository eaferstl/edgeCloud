# Spec: Coordination

## Status

Status: `Not Started`
Owner: Keith
Team: Coordination
Last updated: TODO

---

## Purpose and sources

TODO: Describe the buildable Coordination approach for the 2-day demo.

This spec translates:

- `prd.md`
- `../00_master_prd.md`
- `../01_top_level_tasks.md`
- `../02_integration_contracts.md`
- `../03_demo_script.md`
- `../04_decisions_risks_cuts.md`

If this spec does not explain what to coordinate and how to verify it, improve this spec before implementation or demo-prep work.

---

## Implementation approach

- What we are building/coordinating: TODO
- Simplest demo path: TODO
- Assumptions: TODO
- Intentionally not building: TODO

---

## Interfaces and contracts

All shared IDs, payloads, commands, events, and statuses must also appear in `../02_integration_contracts.md`.

### Consumed

| Input / service | Provided by | Required for demo | Notes |
|---|---|---|---|
| TODO | TODO | Yes / No |  |

### Provided

| Output / service | Consumed by | Required for demo | Notes |
|---|---|---|---|
| TODO: Demo path | All teams | Yes | Keep aligned with `../03_demo_script.md`. |
| TODO: Integration status | All teams | Yes | Keep aligned with `../01_top_level_tasks.md`. |

---

## Data and state

| Field / value | Type | Owner | Notes |
|---|---|---|---|
| TODO | TODO | Coordination |  |

| State | Meaning | Next states | Notes |
|---|---|---|---|
| Not Started | Work has not begun. | Building / Cut | Shared status value. |
| Building | Work is underway. | Blocked / Integrated / Cut | Shared status value. |
| Blocked | Work needs a decision or dependency. | Building / Cut | Shared status value. |
| Integrated | Work is connected to at least one dependent module. | Demo Ready / Building / Cut | Shared status value. |
| Demo Ready | Work is ready for rehearsal/demo. | Building / Cut | Shared status value. |
| Cut | Work is removed from demo scope. | Building | Requires recorded decision. |

---

## Error cases and fallback

| Case | Expected behavior | Demo impact | Notes |
|---|---|---|---|
| TODO | TODO | TODO |  |

---

## Likely files or modules

| Path | Expected change | Notes |
|---|---|---|
| `../00_master_prd.md` | Keep overall demo promise current. | Master authority. |
| `../01_top_level_tasks.md` | Keep status, blockers, and cuts current. | Execution tracker. |
| `../02_integration_contracts.md` | Keep shared interfaces current. | Contract authority. |
| `../03_demo_script.md` | Keep presenter path aligned to reality. | Do not overpromise. |
| `../04_decisions_risks_cuts.md` | Record material decisions, risks, and cuts. | Prevent repeated debates. |

---

## What an implementer needs before coding or demo-prep work

- [ ] Coordination PRD has enough detail for the demo.
- [ ] Relevant shared contracts are current in `../02_integration_contracts.md`.
- [ ] Inputs, outputs, and demo acceptance checks are clear.
- [ ] Verification steps below are runnable by another person or agent.

---

## Verification

Manual check:

```bash
# TODO
```

Expected result:

```text
TODO
```

Integration check:

- [ ] TODO
- [ ] The demo script matches actual implementation.
- [ ] Relevant tasks, risks, or cuts are updated in top-level docs.

---

## Open questions and cuts

| Item | Owner | Decision needed | Status |
|---|---|---|---|
| TODO | TODO | TODO | Not Started |
