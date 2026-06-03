# Spec: Device Registry

> **As-built (2026-06-03 · `Demo Ready`).** Worker "devices" are not pre-registered;
> a device joins simply by running the worker container, which dials the rendezvous
> relay and begins replicating the OrbitDB databases. Each worker publishes a
> **device capability + liveness record** every 5 s over the gossipsub presence
> topic (`edgecloud/heartbeat/v1`, evicted after 15 s): `peerId`, `hostname`,
> `cpu {model, cores, arch, platform, load1m}`, `ram {totalBytes, freeBytes}`,
> `storage {totalBytes, freeBytes}`, and live scheduling state
> `{ status, maxConcurrent, currentLoad, availableCapacity }`. `currentLoad` tracks
> **actual running executions** (incremented while a job runs), so
> `availableCapacity` is real. The server surfaces all of this at `GET /api/status`
> (`devices[]`, `fleetAvailableCapacity`) and the webform shows it.
>
> This presence view is **scheduling-advisory / UI only** — execution coordination
> uses the claims log, not the heartbeat, so the registry is not a correctness
> dependency. Worker identity (libp2p peerId) persists on the `/data` volume.
>
> **Attribution.** The device-record schema and the host-metadata collectors
> (`cpu`/`ram`/`storage`, `status`/`maxConcurrent`/`currentLoad`/`availableCapacity`,
> the reserved `pricePerJobUsd`) are adapted from **Chao Lam's (`chaodoze`)**
> standalone OrbitDB device registry (`device_registry/index.js` on `origin/main`,
> incl. his "assuming DNS availability" commit) and the device schema **D-A**
> ratified in eaferstl's "architectural consistency" pass. We carry his design onto
> our gossipsub presence channel (rather than his OrbitDB documents DB, because
> edgeCloud deliberately keeps high-churn presence off the CRDT oplog) and wire his
> live-capacity fields to real execution. Code: `worker/src/device-info.js`,
> `worker/src/coordination.js`, `server/src/heartbeats.js`. See `../CREDITS.md`.
>
> **Manual test / integration check:**
> ```bash
> cd worker && docker compose up --build -d        # start a device
> curl -s http://146.190.123.91/api/status | python3 -m json.tool   # devices[] shows cpu/ram/storage/capacity
> # submit a slow job and watch currentLoad rise then fall:
> #   currentLoad 0→1 during execution, availableCapacity 4→3, then back
> docker stop edgecloud-worker                      # within ~15s it drops off the status list
> ```

## 1. Status

Status: `Demo Ready`  
Owner: Chao  
Team: Device Registry  
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
