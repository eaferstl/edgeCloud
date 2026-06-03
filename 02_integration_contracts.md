# Integration Contracts

## 1. Purpose

This file defines the shared technical contracts between teams.

If a team-local `spec.md` conflicts with this file, this file wins until the conflict is resolved.

Do not invent final payloads here unless team leads have agreed. Use placeholders until teams define the real contracts.

---

## 2. Contract status

Status: `Not Started`  
Owner: Keith / Coordination  
Contract version: TODO  
Frozen: No  
Frozen at: TODO  
Approved by:

- [ ] Kevin / Authentication
- [ ] Chao / Device Registry
- [ ] Cam / Job Queue
- [ ] Elliot / Job Queue
- [ ] Steve / Job Execution
- [ ] Maroua / Job Execution
- [ ] Keith / Coordination
- [ ] Legal, if presentation claims depend on these contracts

---

## 3. Shared objects

Team leads should fill this out.

| Object | Field / ID | Owner | Used By | Status | Notes |
|---|---|---|---|---|---|
| User / Session | TODO | Authentication | TODO | Not Started |  |
| Device | TODO | Device Registry | TODO | Not Started |  |
| Job | TODO | Job Queue | TODO | Not Started |  |
| Worker / Executor | TODO | Job Execution | TODO | Not Started |  |
| Result | TODO | Job Execution / Job Queue | TODO | Not Started |  |

---

## 4. Shared statuses

Team leads should define agreed statuses.

### User / Session status

| Status | Meaning | Owner |
|---|---|---|
| TODO | TODO | Authentication |

### Device status

| Status | Meaning | Owner |
|---|---|---|
| TODO | TODO | Device Registry |

### Job status

| Status | Meaning | Owner |
|---|---|---|
| TODO | TODO | Job Queue |

### Execution status

| Status | Meaning | Owner |
|---|---|---|
| TODO | TODO | Job Execution |

---

## 5. Cross-team dependencies

| Producer | Consumer | What is shared | Required for demo | Status | Notes |
|---|---|---|---|---|---|
| Authentication | Job Queue | TODO | Yes | Not Started |  |
| Device Registry | Job Execution | TODO | Yes | Not Started |  |
| Device Registry | Job Queue | TODO | TODO | Not Started |  |
| Job Queue | Job Execution | TODO | Yes | Not Started |  |
| Job Execution | Job Queue | TODO | Yes | Not Started |  |
| Coordination | All teams | TODO | Yes | Not Started |  |
| Legal | Coordination | Approved presentation language | Yes | Not Started |  |

---

## 6. Required calls / APIs / events

Do not fill this with invented endpoints. Team leads should decide.

| ID | Name | Producer | Consumer | Request / Input | Response / Output | Status |
|---|---|---|---|---|---|---|
| API-001 | TODO | Authentication | TODO | TODO | TODO | Not Started |
| API-002 | TODO | Device Registry | TODO | TODO | TODO | Not Started |
| API-003 | TODO | Job Queue | TODO | TODO | TODO | Not Started |
| API-004 | TODO | Job Execution | TODO | TODO | TODO | Not Started |

---

## 7. Draft happy path

Coordination and team leads should refine this.

```text
TODO: Define final demo path.

Possible shape:

1. User/session is available.
2. Device is registered or available.
3. Job is submitted.
4. Job is queued.
5. Worker/device receives or claims job.
6. Worker/device executes job.
7. Result/status is reported.
8. Demo shows final status/result.
```

---

## 8. Contract-change rule

After this file is marked frozen, any change to shared IDs, payloads, statuses, APIs, events, or cross-team assumptions requires approval from:

- Keith / Coordination
- the producing team lead
- the consuming team lead

Approved contract changes must be recorded in `04_decisions_risks_cuts.md`.

---

## 9. Open contract questions

| Question | Owner | Needed By | Status | Resolution |
|---|---|---|---|---|
| TODO | TODO | TODO | Not Started |  |
