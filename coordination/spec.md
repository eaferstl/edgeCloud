# Spec: Coordination

## 1. Status

Status: `Not Started`  
Owner: Keith  
Team: Coordination  
Last updated: TODO

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

---

## 15. Operating rhythm

Keith / Coordination to complete.

| Time / Checkpoint | Goal | Required Output | Status |
|---|---|---|---|
| Day 1 kickoff | Align scope | Master PRD accepted | Not Started |
| Day 1 contract review | Align interfaces | Integration contracts v0 | Not Started |
| Day 2 integration check | Force end-to-end progress | First integrated path attempt | Not Started |
| Day 3 rehearsal | Stabilize presentation | Full demo rehearsal | Not Started |
| Final presentation prep | Prepare fallback | Recording/trace/screenshots | Not Started |

---

## 16. Scope control rules

Coordination to complete.

Suggested rules to consider:

- Cut work that is not required for the demo promise.
- Cut work that creates a new cross-team dependency after contract freeze.
- Cut work that cannot be tested before rehearsal.
- Cut work that creates legal or presentation ambiguity.
- Do not expand from prototype to production-hardening unless explicitly approved.

---

## 17. Integration review checklist

- [ ] All team PRDs exist.
- [ ] All team specs exist.
- [ ] Integration contracts are reviewed.
- [ ] Manual tests exist in team specs.
- [ ] Critical path tasks are current.
- [ ] Blockers are current.
- [ ] Scope cuts are recorded.
- [ ] Demo script matches actual implementation.
- [ ] Legal has reviewed final presentation language.
