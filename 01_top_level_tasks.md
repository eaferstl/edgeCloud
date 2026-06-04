# Top-Level Tasks

## 1. Purpose

This file tracks the project-level tasks required to make the prototype demo-ready.

Teams should update this file when work starts, becomes blocked, is integrated, becomes demo-ready, or is cut.

> **As-built note (2026-06-03):** the end-to-end prototype is implemented, deployed
> to `http://146.190.123.91`, and verified live (register → submit → single-worker
> execution → result to the submitter only; duplicate→cache; worker takeover;
> egress firewall; multi-server endorsement). See `../ARCHITECTURE.md`. The
> per-team rows below are marked `Demo Ready`/`Integrated`; the remaining open work
> is presentation/legal review and rehearsal, not engineering.

---

## 2. Status legend

Use only these statuses:

- `Not Started`
- `Building`
- `Blocked`
- `Integrated`
- `Demo Ready`
- `Cut`

---

## 3. Critical path

Do not pre-fill completion. Team leads should update this during the build.

| ID | Task | Owner | Team | Status | Blocked By | Due | Notes |
|---|---|---|---|---|---|---|---|
| T-001 | Finalize master PRD | Keith | Coordination | Not Started |  | TODO |  |
| T-002 | Define first version of integration contracts | Keith + team leads | Coordination | Not Started | Team review | TODO |  |
| T-003 | Authentication (keys, allowlist, challenge/response) | Kevin | Authentication | Demo Ready |  | done | implemented; see `auth/spec.md` |
| T-004 | Device Registry (worker presence) | Chao | Device Registry | Demo Ready |  | done | heartbeat presence; see `device_registry/spec.md` |
| T-005 | Job Queue (OrbitDB queue + claims) | Cam / Elliot | Job Queue | Demo Ready |  | done | see `job_queue/spec.md` |
| T-006 | Job Execution (workers, JS/WASM, sandbox) | Steve / Maroua | Job Execution | Demo Ready |  | done | see `job_execution/spec.md` |
| T-007 | Define Legal review requirements | Legal | Legal | Not Started |  | TODO | presentation wording still needs review |
| T-008 | Run first integration check | Keith + team leads | Coordination | Integrated | Team readiness | done | full E2E verified live |
| T-009 | Finalize demo script | Keith | Coordination | Building | Working path | TODO | path works; script `03_demo_script.md` still TODO |
| T-010 | Capture fallback demo artifact | Keith | Coordination | Not Started | Working path | TODO |  |
| T-011 | Complete full rehearsal | Keith + all teams | Coordination | Not Started | All teams | TODO |  |
| T-012 | Ratify + build Agent Integration (attendee agents use edgeCloud) | TODO | Agent Integration | Not Started | Owner + scope decision | TODO | spec done (`agent_mcp_integration/spec.md`); see D-012 |

---

## 4. Tasks by team

### Authentication - Kevin

| ID | Task | Status | Notes |
|---|---|---|---|
| AUTH-001 | Fill out `auth/prd.md` | Not Started |  |
| AUTH-002 | Fill out `auth/spec.md` | Not Started |  |
| AUTH-003 | Define auth approach for demo | Not Started |  |
| AUTH-004 | Define manual integration check | Not Started |  |
| AUTH-005 | Integrate with Job Queue or demo flow | Not Started |  |

### Device Registry - Chao

| ID | Task | Status | Notes |
|---|---|---|---|
| DEV-001 | Fill out `device_registry/prd.md` | Not Started |  |
| DEV-002 | Fill out `device_registry/spec.md` | Not Started |  |
| DEV-003 | Define device registration behavior | Building | `index.js` aligned to architecture (D-001…D-008); see registry punch-list in `docs/architecture.md` §15 |
| DEV-004 | Define manual integration check | Not Started |  |
| DEV-005 | Integrate with Job Queue or Job Execution | Not Started |  |

### Job Queue - Cam and Eliot

| ID | Task | Status | Notes |
|---|---|---|---|
| QUEUE-001 | Fill out `job_queue/prd.md` | Not Started |  |
| QUEUE-002 | Fill out `job_queue/spec.md` | Not Started |  |
| QUEUE-003 | Define job lifecycle for demo | Not Started |  |
| QUEUE-004 | Define manual integration check | Not Started |  |
| QUEUE-005 | Integrate with Authentication and Job Execution | Not Started |  |

### Job Execution - Steve and Maroua

| ID | Task | Status | Notes |
|---|---|---|---|
| EXEC-001 | Fill out `job_execution/prd.md` | Not Started |  |
| EXEC-002 | Fill out `job_execution/spec.md` | Not Started |  |
| EXEC-003 | Define demo workload | Not Started |  |
| EXEC-004 | Define manual integration check | Not Started |  |
| EXEC-005 | Integrate with Device Registry and Job Queue | Not Started |  |

### Coordination - Keith

| ID | Task | Status | Notes |
|---|---|---|---|
| COORD-001 | Fill out `coordination/prd.md` | Not Started |  |
| COORD-002 | Fill out `coordination/spec.md` | Not Started |  |
| COORD-003 | Maintain `00_master_prd.md` | Not Started |  |
| COORD-004 | Maintain `01_top_level_tasks.md` | Not Started |  |
| COORD-005 | Maintain `02_integration_contracts.md` | Not Started |  |
| COORD-006 | Maintain `03_demo_script.md` | Not Started |  |
| COORD-007 | Maintain `04_decisions_risks_cuts.md` | Not Started |  |

### Agent Integration

| ID | Task | Status | Notes |
|---|---|---|---|
| AGENT-001 | Fill out `agent_mcp_integration/prd.md` | Demo Ready | done (proposal) |
| AGENT-002 | Fill out `agent_mcp_integration/spec.md` | Demo Ready | done (proposal) |
| AGENT-003 | Assign owner + ratify module into `00_master_prd.md` | Not Started | Coordination/Keith |
| AGENT-004 | Build `@edgecloud/agent-mcp` MCP server (submitter tools) | Integrated | built; local e2e test green (boots real server + 2 workers, all 8 checks). Pending live-server test with an attendee email |
| AGENT-005 | Thin Hermes skill wrapper (`hermes skills install edgecloud`) | Not Started |  |
| AGENT-006 | Worker-enrollment helper + docs (≤25/email) | Not Started | reuses `worker/` Docker node |
| AGENT-007 | Legal review of "your agent runs on the swarm" framing | Not Started | `legal/spec.md` |

### Legal

| ID | Task | Status | Notes |
|---|---|---|---|
| LEGAL-001 | Fill out `legal/prd.md` | Not Started |  |
| LEGAL-002 | Fill out `legal/spec.md` | Not Started |  |
| LEGAL-003 | Define approved presentation language | Not Started |  |
| LEGAL-004 | Define prohibited claims | Not Started |  |
| LEGAL-005 | Review final demo script | Not Started |  |

---

## 5. Current blockers

| ID | Blocker | Owner | Impact | Needed Decision / Action | Status |
|---|---|---|---|---|---|
| B-001 | Auth module (`sign` / `verify`) unimplemented | Kevin / Authentication | All signed paths; nothing reaches Demo Ready (decision D-006) | Implement `auth/` per `docs/architecture.md` §6 | Blocked |

---

## 6. Scope cuts

| ID | Cut | Reason | Approved By | Date |
|---|---|---|---|---|
| CUT-001 | TODO | TODO | TODO | TODO |
