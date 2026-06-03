# Spec: Job Execution

## Status

Status: `Not Started`
Owner: Steve / Maroua
Team: Job Execution
Last updated: TODO

---

## Purpose and sources

TODO: Describe the buildable Job Execution approach for the 3-day demo.

This spec translates:

- `prd.md`
- `../00_master_prd.md`
- `../02_integration_contracts.md`
- `../03_demo_script.md`

If this spec does not explain what to build and how to verify it, improve this spec before coding.

---

## Implementation approach

- What we are building: TODO
- Simplest demo path: TODO
- Assumptions: TODO
- Intentionally not building: TODO

---

## Interfaces and contracts

All shared IDs, payloads, commands, events, and statuses must also appear in `../02_integration_contracts.md`.

Canonical shapes: `../docs/architecture.md` §7.3–7.4, §10. This team co-owns Contract #3 and owns Contract #4.

### Consumed

| Input / service | Provided by | Required for demo | Notes |
|---|---|---|---|
| JobOffer over `/edgecloud/jobs/1.0.0` | Job Queue | Yes | arch §7.2; Contract #3 |
| `sign` / `verify` | Authentication | Yes | verify offers; sign responses/results |
| Own `device-registry` document | Device Registry | Yes | reads/updates own capacity |

### Provided

| Output / service | Consumed by | Required for demo | Notes |
|---|---|---|---|
| JobResponse + JobResult | Job Queue (submitter) | Yes | arch §7.3–7.4; Contract #3 |
| Capacity write-backs to own device doc | Device Registry | Yes | Contract #4 (arch §10) |

---

## Data and state

| Field / value | Type | Owner | Notes |
|---|---|---|---|
| TODO | TODO | Job Execution |  |

| State | Meaning | Next states | Notes |
|---|---|---|---|
| TODO | TODO | TODO |  |

---

## Error cases and fallback

| Case | Expected behavior | Demo impact | Notes |
|---|---|---|---|
| TODO | TODO | TODO |  |

---

## Likely files or modules

| Path | Expected change | Notes |
|---|---|---|
| TODO | TODO |  |

---

## What an implementer needs before coding

- [ ] Job Execution PRD has enough detail for the demo.
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
- [ ] At least one consuming module can use the execution result handoff.
- [ ] Relevant tasks, risks, or cuts are updated in top-level docs.

---

## Open questions and cuts

| Item | Owner | Decision needed | Status |
|---|---|---|---|
| TODO | TODO | TODO | Not Started |
