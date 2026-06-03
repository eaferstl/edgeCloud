Make sure to read and adhere to AGENTS.md.

## Repo purpose

This repo is a fast prototype for a decentralized edge cloud demo. Team folders are module handoffs for a 3-day build, not standalone product lanes.

The workflow is lightweight:

```text
Master PRD + architecture
  -> team PRD
  -> team spec
  -> code
  -> verification + status/decision updates
```

Do not turn this into a heavy process. Keep docs short, concrete, and demo-oriented.

---

## Authority order

When docs conflict, use this order:

1. `00_master_prd.md` - overall demo promise, scope, teams, and acceptance criteria.
2. `02_integration_contracts.md` - ratified shared interfaces and cross-team boundary ledger.
3. `docs/architecture.md` - shared technical reference for schemas, vocabulary, stack, protocols, constants, and ratified technical decisions.
4. `01_top_level_tasks.md` - project status, blockers, team tasks, and cuts.
5. Team `prd.md` files - what each module contributes to the demo.
6. Team `spec.md` files - how each module should be built and verified.
7. `03_demo_script.md` - live presentation path.
8. `04_decisions_risks_cuts.md` - durable decisions, risks, blockers, cuts, legal concerns, and contract changes.
9. Team `research/` folders - supporting context only.

If `02_integration_contracts.md` and `docs/architecture.md` disagree, reconcile them instead of silently choosing one. `docs/architecture.md` carries detailed technical shapes; `02_integration_contracts.md` is the freezable team-ratified contract ledger.

---

## Required read path

Before changing code in a team-owned area, read:

1. `README.md`
2. `00_master_prd.md`
3. `02_integration_contracts.md`
4. `docs/architecture.md`
5. The relevant team `research/` folder
6. The team's `prd.md`
7. The team's `spec.md`
8. Any relevant entries in `04_decisions_risks_cuts.md`

Before changing docs only, read the target doc plus the authority docs above it.

---

## Team folders

Team-owned areas:

- Authentication: `auth/`
- Device Registry: `device_registry/`
- Job Queue: `job_queue/`
- Job Execution: `job_execution/`
- Coordination: `coordination/`
- Legal: `legal/`

Each team folder should contain:

- `prd.md` - concise module PRD.
- `spec.md` - buildable implementation/review handoff.
- `research/` - supporting notes and references.

Research notes are not authority. If research conflicts with top-level contracts or team docs, update the authoritative doc or record the conflict.

---

## Updating PRDs

Update a team `prd.md` when the module's demo contribution changes:

- purpose,
- owned responsibilities,
- not-owned scope,
- inputs/dependencies,
- outputs/handoffs,
- demo acceptance,
- known limitations.

Team PRDs should not become standalone product PRDs. The master demo promise lives in `00_master_prd.md`; team PRDs describe composable modules that support it.

If a team PRD changes a shared dependency, handoff, API, payload, status, event, ID, or assumption, update `02_integration_contracts.md` too.

---

## Updating specs

Update a team `spec.md` when implementation or verification details change:

- implementation approach,
- interfaces consumed/provided,
- data and state,
- error cases and fallback behavior,
- likely files/modules,
- what an implementer needs before coding,
- manual and integration verification.

Use the spec as the build handoff for humans and AI agents. If the relevant spec does not explain what to build and how to verify it, improve the spec before guessing in code.

When code already exists ahead of the spec, update the spec to describe the current implementation before extending that code.

---

## Updating shared docs

Update these files when the relevant fact changes:

- `00_master_prd.md`: demo promise, scope, goals/non-goals, team responsibilities, top-level requirements, or demo acceptance.
- `01_top_level_tasks.md`: work starts, blocks, integrates, becomes demo-ready, or is cut.
- `02_integration_contracts.md`: shared schemas, APIs, payloads, statuses, events, protocol IDs, constants, or cross-team assumptions are created or changed.
- `docs/architecture.md`: canonical technical schemas, vocabulary, stack choices, protocols, constants, or architecture decisions change.
- `03_demo_script.md`: the live demo path, visible presenter steps, fallback artifacts, or presentation wording changes.
- `04_decisions_risks_cuts.md`: decisions are made, risks are discovered, blockers appear, scope is cut, legal/presentation concerns arise, or frozen contracts change.

Do not update only one side of a shared fact. For example, a new protocol ID usually needs `docs/architecture.md`, `02_integration_contracts.md`, the relevant team spec, and possibly `04_decisions_risks_cuts.md`.

---

## Decisions, risks, blockers, and cuts

Use `04_decisions_risks_cuts.md` to prevent repeated debates and preserve context for future agents.

Record:

- decisions that constrain future work,
- serious risks and mitigations,
- blockers that stop demo readiness,
- scope cuts and who approved them,
- legal or presentation concerns,
- post-freeze contract changes.

If a change rejects an obvious alternative, record the rejection there or in the commit message so future agents do not re-litigate it.

---

## Implementation rules

- Keep diffs small and demo-focused.
- Prefer existing repo patterns before adding abstractions.
- Do not add new dependencies unless the relevant spec or architecture doc calls for them.
- Keep JavaScript as ES modules and follow `docs/architecture.md` coding conventions.
- Use the shared contracts instead of inventing local payload shapes.
- Do not claim production security, compliance, billing, sandboxing, FIFO ordering, or exactly-once behavior unless the docs and verification support it.
- If a cross-team contract is not ready, document the blocker instead of coding around it silently.

---

## Verification and status updates

After code or spec-affecting changes:

- Run the relevant manual check from the team spec.
- Run any available repo check, such as `npm run check:device-registry` when Device Registry code changes.
- Update `01_top_level_tasks.md` with status changes.
- Update `04_decisions_risks_cuts.md` for new decisions, risks, blockers, or cuts.
- Update `03_demo_script.md` if the demo-visible behavior changed.

Use only these project statuses:

- `Not Started`
- `Building`
- `Blocked`
- `Integrated`
- `Demo Ready`
- `Cut`
