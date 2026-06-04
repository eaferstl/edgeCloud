# Agent Integration — Research

Supporting context only. Not authority. If this conflicts with top-level contracts
or team docs, follow the repo authority order and update the authoritative doc.

## Source

Edge Esmeralda 2026 agent experiment: https://agent-ee26.edgecity.live/
(fetched 2026-06-04)

## What the attendee agents are

- Monthlong (May 30–Jun 27, 2026) residential village, 500+ participants. Each
  attendee gets an AI agent as a personal assistant (sessions, matchmaking,
  collaboration).
- Setup paths: **provision a new agent via Hermes** ("a leading agent harness",
  recommended for non-technical users), or **bring an existing agent** running
  Hermes, OpenClaw (via InstaClaw), or Claude Desktop. Model inference routes
  through OpenRouter.
- Onboarding requires **email verification of accepted-application status**, then
  installing skill modules: `hermes skills install <package> --force`.
- Agents live primarily in **Telegram** but can run elsewhere.

## Integration points (why edgeCloud fits)

- Agents already integrate external systems by configuring **MCP server URLs +
  bearer tokens** — EdgeOS (calendar/RSVP/directory), Geo (knowledge graph),
  Index Network (agent-to-agent matchmaking).
- => edgeCloud should be **one more MCP server** in that same config block, not a
  new bespoke API. This is the native extension point across Hermes, OpenClaw,
  and Claude Desktop.
- The agent experiment and edgeCloud gate on the **same attendee email** — the
  allowlist edgeCloud checks (`server/src/http/app.js` → `q.emailAllowed`) is the
  same identity EdgeOS verifies. Authorization is shared by construction.

## The constraint that shaped the design

edgeCloud workers are a **hermetic sandbox**: no network egress, no filesystem
access (decisions D-008 / D-010, `../../04_decisions_risks_cuts.md`; details in
`../../THREAT_MODEL.md`). So agents can offload only **pure, self-contained
compute** (scoring, simulation, transforms, crypto, WASM) — never their network-
bound agentic loop. This is the single most important fact for anyone building
the integration.
