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

## Purpose and sources

TODO: Describe the buildable Authentication approach for the 3-day demo.

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

Canonical shapes: `../docs/architecture.md` §6. This team owns Contract #2.

### Consumed

| Input / service | Provided by | Required for demo | Notes |
|---|---|---|---|
| Persisted Ed25519 key / `PeerId` | libp2p (Coordination bootstrap) | Yes | identity = node key (arch §6) |

### Provided

| Output / service | Consumed by | Required for demo | Notes |
|---|---|---|---|
| `sign(payload)` → base64 signature | All teams | Yes | API-001 (arch §6) |
| `verify(payload, signature, peerId)` + error contract | All teams | Yes | API-002; `false` ⇒ drop & don't act (arch §6) |
| `canonicalJSON(payload)` | All teams | Yes | shared canonicalization (arch §6) |

---

## Data and state

| Field / value | Type | Owner | Notes |
|---|---|---|---|
| TODO | TODO | Authentication |  |

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

- [ ] Authentication PRD has enough detail for the demo.
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
- [ ] At least one consuming module can use the auth/session handoff.
- [ ] Relevant tasks, risks, or cuts are updated in top-level docs.

---

## Open questions and cuts

| Item | Owner | Decision needed | Status |
|---|---|---|---|
| TODO | TODO | TODO | Not Started |
