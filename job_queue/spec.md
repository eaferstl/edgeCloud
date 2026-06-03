# Spec: Job Queue

## Status

Status: `Not Started`
Owner: Cam / Eliot
Team: Job Queue
Last updated: TODO

---

## Purpose and sources

TODO: Describe the buildable Job Queue approach for the 3-day demo.

This spec translates:

- `prd.md`
- `../00_master_prd.md`
- `../02_integration_contracts.md`
- `../03_demo_script.md`

If this spec does not explain what to build and how to verify it, improve this spec before coding.

Research reminder: for the prototype, avoid unsupported strict FIFO or exactly-once claims unless the team explicitly implements and verifies them. A task pool, claim/lease, or duplicate-tolerant path may be more honest for a decentralized demo.

---

## Implementation approach

- What we are building: TODO
- Simplest demo path: TODO
- Assumptions: TODO
- Intentionally not building: TODO

---

## Interfaces and contracts

All shared IDs, payloads, commands, events, and statuses must also appear in `../02_integration_contracts.md`.

Canonical shapes: `../docs/architecture.md` §7.2, §8. This team co-owns Contract #3.

### Consumed

| Input / service | Provided by | Required for demo | Notes |
|---|---|---|---|
| `device-registry` documents (local replica) | Device Registry | Yes | fitness inputs (Contract #1; arch §7.1, §8) |
| `sign` / `verify` | Authentication | Yes | sign JobOffer; verify responses/results |
| JobResponse / JobResult | Job Execution | Yes | over `/edgecloud/jobs/1.0.0` (Contract #3) |

### Provided

| Output / service | Consumed by | Required for demo | Notes |
|---|---|---|---|
| JobOffer over `/edgecloud/jobs/1.0.0` | Job Execution | Yes | arch §7.2; Contract #3 |
| Job status (`queued`…`completed` / `failed`) | Coordination / demo | Yes | arch §9.2 |

---

## Data and state

| Field / value | Type | Owner | Notes |
|---|---|---|---|
| TODO | TODO | Job Queue |  |

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

- [ ] Job Queue PRD has enough detail for the demo.
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
- [ ] At least one consuming module can use the job state handoff.
- [ ] Relevant tasks, risks, or cuts are updated in top-level docs.

---

## Open questions and cuts

| Item | Owner | Decision needed | Status |
|---|---|---|---|
| TODO | TODO | TODO | Not Started |
