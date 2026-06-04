---
name: edgecloud
description: >-
  Offload PURE compute to edgeCloud — the decentralized compute network run by
  Edge Esmeralda attendees. Use when you need to run a self-contained calculation
  (scoring, ranking, simulation, data transforms, crypto, or a WASM module) that is
  CPU-bound and needs NO network or filesystem access. Do NOT use it for anything
  that calls an API, an LLM, or fetches a URL — the sandbox forbids that. Results
  come back signed to your own key; no one else can read them.
---

# edgeCloud skill

edgeCloud lets your agent hand deterministic computation to volunteer devices on the
Edge Esmeralda network and get the result back. You stay the brain; edgeCloud is the
calculator.

This skill talks to a **local** `edgecloud` MCP server (bound to `127.0.0.1`) so your
signing key never leaves your machine. Set it up once with `bootstrap.md`.

## When to use it

Reach for edgeCloud when you have a chunk of work that is:

- **pure** — output depends only on the inputs you provide, and
- **self-contained** — no network calls, no file access, no secrets.

Good fits: scoring 500 attendees for matchmaking from a list you already gathered;
a Monte-Carlo simulation; sorting/filtering/aggregating a dataset; a constraint solve;
hashing or other crypto; a WASM workload someone compiled.

Do **not** use it for: calling EdgeOS/Geo/Index Network, prompting a model, scraping a
page, or anything that touches the network or disk. Those will fail in the sandbox.

## Tools

- **`edgecloud_run`** — submit a job and get the result.
  - JS: `edgecloud_run({ type: "js", code: "<expression or script>" })`. The job's
    stdout (or, for a bare expression, its value) is returned.
  - WASM: `edgecloud_run({ type: "wasm", moduleB64: "<base64 module>", args: [...] })`.
  - Add `wait: false` to fire-and-forget, then collect later with `edgecloud_get_result`.
- **`edgecloud_status`** — check the network (`workersOnline`, capacity) before offloading.
- **`edgecloud_get_result`** — fetch a result by `jobId` for a fire-and-forget job.

## How to think about it

1. Gather the inputs yourself (you have the network; the job does not).
2. Express the work as a pure function over those inputs, as JS or WASM.
3. `edgecloud_run` it. Identical code returns a cached result instantly, so retries
   are free and safe.
4. Read the `stdout` and continue your reasoning.

## Limits

- Job timeout ≤ 60s (default 10s); payload ≤ 4 MiB; captured output ≤ 256 KiB.
- Requires your Edge Esmeralda attendee email to be on the allowlist (the same one
  EdgeOS verified).
- Not a confidentiality/safety boundary for arbitrary code — it's a compute helper.
