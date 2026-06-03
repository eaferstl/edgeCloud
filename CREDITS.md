# Credits

edgeCloud is a team build for Edge Esmeralda 2026. This file records where work
by other collaborators was used in this implementation branch
(`elimisteve/edgecloud-fullimplementation`), including ideas adapted rather than
copied verbatim.

## Chao Lam (`chaodoze`) — device registry

Chao designed and wrote a standalone OrbitDB-based **device registry**
(`device_registry/index.js` on `origin/main`), including the commit "assuming DNS
availability" (`4c27162`) that added DNS-addressed bootstrap discovery.

**What we used.** His **device-capability record schema** and **host-metadata
collectors** are the basis for edgeCloud's worker heartbeat:

- the nested host record — `cpu {model, cores, arch, platform, load1m}`,
  `ram {totalBytes, freeBytes}`, `storage {totalBytes, freeBytes}` (via
  `fs.statfs`);
- the live scheduling state — `status`, `maxConcurrent`, `currentLoad`,
  `availableCapacity`, and the reserved `pricePerJobUsd` for future
  cheapest-/least-loaded-node routing;
- the `EDGECLOUD_MAX_CONCURRENT` configuration knob.

**How our version differs (and why).** We carry his schema on edgeCloud's
**gossipsub presence channel** instead of his OrbitDB *documents* registry, because
edgeCloud deliberately keeps high-churn presence **off** the CRDT oplog (see
`ARCHITECTURE.md`). And whereas his `currentLoad`/`availableCapacity` were a
placeholder for a separate execution module to own, we wire them to **actual job
execution** in `worker/src/coordination.js`, so the advertised capacity is real and
moves as jobs run. Implementation: `worker/src/device-info.js`,
`worker/src/coordination.js`, `server/src/heartbeats.js`.

## eaferstl — architectural consistency

The "architectural consistency" pass (`3a6f454`) ratified the device-registry work
into a shared architecture, including the **D-A device schema** (nested host record
+ `status`/`maxConcurrent`/`currentLoad`/`availableCapacity`) and the
`EDGECLOUD_`-prefixed configuration convention (**D-G**), both of which our device
record and config follow.

## Keith — coordination & team docs

Keith's coordination commits (team-doc handoffs, agent workflow rules, research
folder guidance) shaped the documentation structure this branch updates as-built
(`00_master_prd.md`, `01_top_level_tasks.md`, `02_integration_contracts.md`, the
team `spec.md` files). We kept the established read order and authority order.

---

*Adapted, not copied: the code in this branch is our own implementation; the
designs and schemas above are credited to their authors so their contribution to
edgeCloud is recorded honestly.*
