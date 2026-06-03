# Master PRD: Decentralized Cloud Prototype

## 1. Status

Status: `Demo Ready`  
Owner: Keith / Coordination  
Last updated: 2026-06-03  
Presentation date: TODO

---

## 2. Summary

**Built and running.** edgeCloud is a decentralized-compute prototype for Edge
Esmeralda 2026. An attendee opens `http://146.190.123.91` (mobile or desktop),
registers the email they signed up with — generating an Ed25519 keypair in the
browser — and submits a small compute job (a JavaScript expression or a WASM module
from a dropdown). The job is signed, placed on an **OrbitDB**-backed job queue that
replicates over **libp2p** to volunteer **Docker worker nodes**, which coordinate so
exactly one runs it, then return the result through OrbitDB to the central server,
which shows it to the submitter and no one else (challenge/response auth).

Implementation details live in **`ARCHITECTURE.md`** (authoritative) and the code
under `shared/`, `server/`, `worker/`. The earlier Kubo/go-ipfs container scaffold
(`node-ipfs-container/`) is superseded by the OrbitDB + Helia + js-libp2p stack.

> This is a prototype for demonstration only — not production-ready, not a security
> boundary for arbitrary untrusted code, not privacy/compliance-grade. See
> `04_decisions_risks_cuts.md` and `legal/spec.md`.

---

## 3. Demo promise

The live demo shows the full end-to-end flow (all steps below are implemented and
verified on the live network):

- [x] A user/session exists (in-browser Ed25519 key, tied to an attendee email).
- [x] A device registers or appears as available (Docker worker shows in `/api/status`).
- [x] A job is submitted (signed envelope via the webform).
- [x] The job enters the queue (OrbitDB `edgecloud-jobs`, replicated to workers).
- [x] A worker/device claims the job (claims log + deterministic tiebreak; exactly one winner).
- [x] The worker/device executes the job (`node` for JS, `wasmtime` for WASM, sandboxed container).
- [x] The worker/device reports the result (OrbitDB `edgecloud-results`).
- [x] The final job status/result is visible to the submitter only (challenge/response auth).
- [ ] Presentation language is legally reviewed.

---

## 4. Goals

TODO: Coordination to complete.

- [ ] Demonstrate the end-to-end prototype workflow.
- [ ] Keep team interfaces clear enough for parallel work.
- [ ] Produce a credible presentation/demo.
- [ ] Identify known limitations honestly.
- [ ] Avoid unsupported production, security, privacy, compliance, or legal claims.

---

## 5. Non-goals

TODO: Coordination and team leads to confirm.

Potential non-goals to consider:

- Production-grade authentication.
- Production-grade sandboxing.
- Production-grade scheduling.
- Production-grade billing.
- Production-grade compliance readiness.
- Arbitrary untrusted code execution.
- Full device fleet management.
- Full customer onboarding.
- Final product UX.
- Final legal/commercial model.

Do not treat this list as final. Team leads and Legal should refine it.

---

## 6. Teams and responsibilities

| Team | Lead / Owner | Folder | Responsibility |
|---|---|---|---|
| Authentication | Kevin | `auth/` | TODO |
| Device Registry | Chao | `device_registry/` | TODO |
| Job Queue | Cam and Elliot | `job_queue/` | TODO |
| Job Execution | Steve and Maroua | `job_execution/` | TODO |
| Coordination | Keith | `coordination/` | TODO |
| Legal | Legal team | `legal/` | TODO |

---

## 7. Target user / audience

TODO: Coordination to complete.

Questions to answer:

- Who is the demo for?
- What should the audience understand after seeing it?
- Is the audience technical, commercial, legal, investor-oriented, internal, or mixed?
- What should the audience believe the prototype proves?
- What should the audience not infer?

---

## 8. End-to-end flow

TODO: Team leads to confirm.

Draft flow to refine:

```text
User/session setup
  -> device registration
  -> job submission
  -> queueing
  -> assignment or claiming
  -> execution
  -> result/status reporting
  -> demo display
```

---

## 9. Top-level requirements

These must be completed by the relevant team leads.

| ID | Requirement | Owner | Priority | Status | Notes |
|---|---|---|---|---|---|
| REQ-001 | TODO | Authentication | Must | Not Started |  |
| REQ-002 | TODO | Device Registry | Must | Not Started |  |
| REQ-003 | TODO | Job Queue | Must | Not Started |  |
| REQ-004 | TODO | Job Execution | Must | Not Started |  |
| REQ-005 | TODO | Coordination | Must | Not Started |  |
| REQ-006 | TODO | Legal | Must | Not Started |  |

Priority values:

- `Must`: required for demo.
- `Should`: important but not demo-blocking.
- `Could`: nice to have.
- `Cut`: removed from demo scope.

---

## 10. Demo acceptance criteria

The prototype is demo-ready when:

- [ ] `auth/prd.md` and `auth/spec.md` are complete enough for demo.
- [ ] `device_registry/prd.md` and `device_registry/spec.md` are complete enough for demo.
- [ ] `job_queue/prd.md` and `job_queue/spec.md` are complete enough for demo.
- [ ] `job_execution/prd.md` and `job_execution/spec.md` are complete enough for demo.
- [ ] `coordination/prd.md` and `coordination/spec.md` are current.
- [ ] `legal/prd.md` and `legal/spec.md` are current.
- [ ] `02_integration_contracts.md` is reviewed by all implementation team leads.
- [ ] At least one end-to-end happy path works.
- [ ] The demo has been rehearsed.
- [ ] A fallback recording, trace, or screenshots exist.
- [ ] Known limitations are documented.
- [ ] Legal has approved presentation wording.

---

## 11. Open questions

| Question | Owner | Needed By | Status | Resolution |
|---|---|---|---|---|
| TODO | TODO | TODO | Not Started |  |
