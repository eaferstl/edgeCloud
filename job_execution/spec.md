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

## 2. Purpose

TODO: Team to complete.

Describe what this spec defines.

This spec should support:

- `prd.md`
- `../00_master_prd.md`
- `../02_integration_contracts.md`
- `../03_demo_script.md`

---

## 3. Scope

### In scope

- TODO
- TODO
- TODO

### Out of scope

- TODO
- TODO
- TODO

---

## 4. Requirements covered

Link this spec back to requirements in `prd.md`.

| Requirement ID | How this spec addresses it | Status |
|---|---|---|
| REQ-001 | TODO | Not Started |
| REQ-002 | TODO | Not Started |

---

## 5. Design / implementation approach

TODO: Team to complete.

Keep this practical and prototype-focused.

Questions to answer:

- What are we building for the demo?
- What is the simplest implementation that satisfies the PRD?
- What are we intentionally not building?
- What assumptions are we making?
- What needs to be stable for other teams?

---

## 6. Interfaces

Document anything other teams need to call, consume, provide, or depend on.

All shared contracts must also be reflected in `../02_integration_contracts.md`.

### Interfaces consumed

| Interface / Data / Service | Provided By | Required for Demo | Notes |
|---|---|---|---|
| TODO | TODO | Yes / No |  |

### Interfaces provided

| Interface / Data / Service | Consumed By | Required for Demo | Notes |
|---|---|---|---|
| TODO | TODO | Yes / No |  |

---

## 7. API / events / commands

Do not invent APIs before the team decides them. Fill this in when known.

| ID | Name | Type | Consumer | Status | Notes |
|---|---|---|---|---|---|
| API-001 | TODO | HTTP / CLI / Event / Other | TODO | Not Started |  |

Example format, if needed:

```http
TODO METHOD /path
```

Request:

```json
{
  "TODO": "TODO"
}
```

Response:

```json
{
  "TODO": "TODO"
}
```

---

## 8. Data model

Do not invent final fields. Fill this in when known.

| Field | Type | Required | Owner | Notes |
|---|---|---:|---|---|
| TODO | TODO | TODO | TODO | TODO |

---

## 9. State / lifecycle

If this subsystem has statuses or lifecycle states, define them here and mirror shared states in `../02_integration_contracts.md`.

| State | Meaning | Next States | Notes |
|---|---|---|---|
| TODO | TODO | TODO | TODO |

---

## 10. Error cases

| Case | Expected Behavior | Visible in Demo? | Notes |
|---|---|---|---|
| TODO | TODO | Yes / No |  |

---

## 11. Security / privacy / safety considerations

TODO: Team to complete.

Do not make production claims unless confirmed.

Questions to answer:

- What data does this component handle?
- What should not be logged?
- What assumptions are prototype-only?
- What would need to change for production?
- Does Legal need to review any claim related to this component?

---

## 12. Manual test / integration check

Every team must provide a way for another team or future agent to verify the subsystem.

### Manual check

TODO: Team to complete.

Steps:

```bash
# TODO
```

Expected result:

```text
TODO
```

### Integration check

This subsystem is integrated when:

- [ ] TODO
- [ ] TODO
- [ ] At least one other team has successfully consumed or provided the relevant interface.
- [ ] Any shared contract changes are reflected in `../02_integration_contracts.md`.

---

## 13. Demo readiness checklist

- [ ] Required features are implemented or explicitly cut.
- [ ] Required interfaces are documented.
- [ ] Manual test passes.
- [ ] Integration check passes.
- [ ] Known limitations are documented.
- [ ] Relevant top-level tasks are updated in `../01_top_level_tasks.md`.
- [ ] Relevant risks or cuts are recorded in `../04_decisions_risks_cuts.md`.

---

## 14. Open questions

| Question | Owner | Needed By | Status | Resolution |
|---|---|---|---|---|
| TODO | TODO | TODO | Not Started |  |
