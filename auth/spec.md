# Spec: Authentication

> **As-built (2026-06-03 · `Demo Ready`).** Three layers, all Ed25519:
> 1. **Registration / allowlist** — a user enters their Edge Esmeralda email; the
>    server checks it against a SQLite allowlist imported from the attendee CSV,
>    enforces ≤4 keys per email, and publishes only `HMAC-SHA256(email, SHARED_SALT)`
>    + the pubkey to the OrbitDB `edgecloud-registry` (raw email never leaves SQLite).
>    The browser generates the keypair locally (tweetnacl) and stores it in
>    localStorage.
> 2. **Job authenticity** — every job envelope is signed over its jobId; workers
>    verify the signature first, then confirm the pubkey has a valid server
>    *attestation* in the registry (re-syncing before rejecting unknown keys).
> 3. **Result retrieval** — challenge/response: the server issues a random nonce,
>    the browser signs it, and only a verified, submitting pubkey may read a result.
>    Server-to-server trust is a signed endorsement chain from a genesis key
>    (`edgecloud-servers`). Code: `server/src/{db,auth}.js`, `shared/src/{crypto,trust}.js`,
>    `server/src/public/app.js`. Full design: **`../ARCHITECTURE.md`**.
>
> **Manual test / integration check:**
> ```bash
> curl -s -XPOST http://146.190.123.91/api/register -H 'content-type: application/json' \
>   -d '{"email":"not-an-attendee@example.com","pubkey":"<32-byte b64>"}'   # 403 not on attendee list
> # registering a 5th key for one email → 409; result fetch without a signed-nonce session → 401;
> # a session whose pubkey did not submit the job → 403. All exercised by:
> node scripts/e2e-client.mjs http://146.190.123.91 <attendee-email> "6 * 7"   # includes the 403-stranger check
> ```

## 1. Status

Status: `Demo Ready`  
Owner: Kevin  
Team: Authentication  
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
