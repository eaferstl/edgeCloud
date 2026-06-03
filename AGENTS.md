Make sure to read and adhere to AGENTS.md.

## Team research folders

Each team folder may contain a `research/` folder for team-specific background, references, design notes, and investigation artifacts.

When working on a team-owned area, read the relevant research folder before changing that team's PRD, spec, implementation, or integration assumptions:

- Authentication: `auth/research/`
- Device Registry: `device_registry/research/`
- Job Queue: `job_queue/research/`
- Job Execution: `job_execution/research/`
- Coordination: `coordination/research/`
- Legal: `legal/research/`

Research notes are supporting context, not authority. If research conflicts with top-level contracts or team docs, follow the repository authority order in `README.md` and update the authoritative docs or record the conflict.

## Lightweight PRD > Spec > Code workflow

Team folders are module handoffs for a 2-day demo, not standalone product lanes.

Before changing code in a team-owned area, read:

1. `README.md`
2. `00_master_prd.md`
3. `02_integration_contracts.md`
4. The relevant `research/` folder
5. The team's `prd.md`
6. The team's `spec.md`

Use the team PRD to understand what that module contributes to the shared demo. Use the team spec to understand how to build or verify that contribution.

If the relevant spec does not explain what to build and how to verify it, improve the spec first instead of guessing in code. Keep PRDs short and module-oriented; put implementation details in specs. Shared APIs, payloads, statuses, events, IDs, and cross-team assumptions belong in `02_integration_contracts.md`.
