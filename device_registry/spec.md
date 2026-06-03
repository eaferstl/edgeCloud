# Spec: Device Registry

## Status

Status: `Not Started`
Owner: Chao
Team: Device Registry
Last updated: TODO

---

## Purpose and sources

TODO: Describe the buildable Device Registry approach for the 2-day demo.

This spec translates:

- `prd.md`
- `../00_master_prd.md`
- `../02_integration_contracts.md`
- `../03_demo_script.md`

If this spec does not explain what to build and how to verify it, improve this spec before coding.

Current implementation note: `device_registry/index.js` is an existing registry spike using OrbitDB over libp2p with DNS bootstrap and mDNS fallback. Treat it as the current implementation candidate until the team confirms or cuts it.

---

## Implementation approach

- What we are building: TODO
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
| TODO: Device availability record | Job Queue / Job Execution | Yes / No | Reflect final fields in contracts. |

---

## Data and state

| Field / value | Type | Owner | Notes |
|---|---|---|---|
| TODO | TODO | Device Registry |  |

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
| `device_registry/index.js` | Confirm, simplify, or replace current registry spike. | Current code uses OrbitDB/libp2p DNS bootstrap. |
| `package.json` | Keep or update verification scripts. | Existing check: `npm run check:device-registry`. |

---

## What an implementer needs before coding

- [ ] Device Registry PRD has enough detail for the demo.
- [ ] Relevant shared contracts are current in `../02_integration_contracts.md`.
- [ ] Inputs, outputs, and demo acceptance checks are clear.
- [ ] Verification steps below are runnable by another person or agent.

---

## Verification

Manual check:

```bash
npm run check:device-registry
```

Expected result:

```text
Node reports no syntax errors for device_registry/index.js.
```

Integration check:

- [ ] TODO
- [ ] At least one consuming module can use the device availability handoff.
- [ ] Relevant tasks, risks, or cuts are updated in top-level docs.

---

## Open questions and cuts

| Item | Owner | Decision needed | Status |
|---|---|---|---|
| TODO | TODO | TODO | Not Started |
