# PRD: Authentication

## Status

Status: `Not Started`
Owner: Kevin
Team: Authentication
Last updated: TODO

---

## Module purpose

TODO: In one short paragraph, state what Authentication must make true for the shared demo.

This is a module PRD, not a standalone product PRD. Keep it focused on Authentication's contribution to the master demo promise in `../00_master_prd.md`.

---

## Owned responsibilities

- TODO: Define the demo user/session identity behavior.
- TODO: Define what proof of identity or session state other modules can rely on.
- TODO: Define the minimum auth-related output needed for the demo path.

---

## Not owned

- TODO: List auth-adjacent work this team is not doing for the 2-day demo.
- TODO: List any production auth, security, or account-management work intentionally out of scope.

---

## Inputs and dependencies

| Needed from | What Authentication needs | Required for demo | Notes |
|---|---|---|---|
| TODO | TODO | Yes / No |  |

---

## Outputs and handoffs

| Authentication provides | Consumed by | Defined in | Notes |
|---|---|---|---|
| TODO | TODO | `../02_integration_contracts.md` |  |

Shared IDs, payloads, commands, events, or statuses must also be reflected in `../02_integration_contracts.md`.

---

## Demo acceptance

Authentication is good enough for the demo when:

- [ ] TODO: A demo user/session can be created, selected, or assumed.
- [ ] TODO: Other modules know what auth/session value to consume.
- [ ] TODO: The demo can show or explain the auth/session step without unsupported claims.
- [ ] Relevant contracts are current in `../02_integration_contracts.md`.
- [ ] The implementation check in `spec.md` passes.

---

## Known limitations

- TODO: Document prototype-only auth limitations.
- TODO: Document any security, privacy, or compliance claims the demo must avoid.
