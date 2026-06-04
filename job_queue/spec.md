# Spec: Job Queue

> **As-built (2026-06-03 · `Demo Ready`).** The queue is the OrbitDB `edgecloud-jobs`
> events database, replicated to every node. A browser builds a signed job envelope
> (`{ jobId=sha256(zipB64), zipB64, pubkey, sig, … }`) and POSTs it to a central
> server, which validates it and appends it to the queue (the server is the sole
> bridge/injector; the browser never joins libp2p). Workers consume the queue and
> coordinate **exactly-once-ish** execution with no central scheduler: a claims log
> (`edgecloud-claims`) plus a deterministic tiebreak (`min sha256(jobId|peerId|round)`)
> picks one winner per round; a timeout lets a backup take over a dead winner;
> results are deduped by jobId in `edgecloud-results`. Duplicate submission of the
> same code → same jobId → instant cached result, no re-execution. Code:
> `shared/src/{envelope,zip,claims}.js`, `server/src/http/app.js`,
> `worker/src/coordination.js`. Full design: **`../ARCHITECTURE.md`**.
>
> **Manual test / integration check:**
> ```bash
> # submit then resubmit identical code — second is an instant cache hit
> node scripts/e2e-client.mjs http://146.190.123.91 <attendee-email> "6 * 7" --expect 42
> node scripts/e2e-client.mjs http://146.190.123.91 <attendee-email> "6 * 7" --expect 42  # cached:true
> curl -s http://146.190.123.91/api/jobs/<jobId>/status   # queued | done | unknown
> ```
> Verified: with two live workers, each job executes exactly once
> (`result.executedBy` is a single peer; the loser cancels its backup timer).

## 1. Status

Status: `Demo Ready`  
Owner: Cam and Elliot  
Team: Job Queue  
Last updated: 2026-06-03

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
