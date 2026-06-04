# Spec: Job Execution

> **As-built (2026-06-03 · `Demo Ready`).** Implemented in `worker/`. Workers
> (debian:sid-slim + Node 22 + wasmtime, Docker) replicate the OrbitDB job queue,
> verify each job's Ed25519 signature, confirm the submitter is in the replicated
> registry (waiting out a re-sync grace before rejecting), claim the job (claims
> log + deterministic tiebreak), execute it (`node` child process for JS,
> `wasmtime` for WASM, both with a hard timeout and stdout capture), and write the
> result to `edgecloud-results`. Submitted code is confined by the container plus
> an iptables egress firewall (`worker/entrypoint.sh`) that blocks private/metadata
> IPs. Full design: **`../ARCHITECTURE.md`**. Contracts: **`../02_integration_contracts.md` §0**.
>
> **Manual test / integration check:**
> ```bash
> cd worker && docker compose up --build -d   # needs NET_ADMIN; defaults dial the genesis server
> docker logs -f edgecloud-worker             # expect: "connected to rendezvous …"
> # from a browser at http://146.190.123.91 submit "6 * 7"; or:
> node scripts/e2e-client.mjs http://146.190.123.91 <your-attendee-email> "6 * 7" --expect 42
> # egress block proof:
> docker exec edgecloud-worker curl -s -m5 -o/dev/null -w '%{http_code}\n' http://169.254.169.254/  # 000 (blocked)
> docker exec edgecloud-worker curl -s -m10 -o/dev/null -w '%{http_code}\n' https://example.com/      # 200
> ```
> Verified end-to-end on the live network: exactly one worker executes a job;
> killing the claim winner mid-job triggers round-1 takeover by a backup.

## 1. Status

Status: `Demo Ready`  
Owner: Steve and Maroua  
Team: Job Execution  
Last updated: 2026-06-03

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
