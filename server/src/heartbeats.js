// Worker presence + device capabilities via gossipsub heartbeats. Presence is
// scheduling-advisory/UI only — the claim protocol does not depend on it — so a
// lightweight in-memory map of the latest device record per peer is enough.
//
// The device record schema (cpu/ram/storage + status/maxConcurrent/currentLoad/
// availableCapacity) is adapted from chaodoze's device registry; see
// worker/src/device-info.js.

import { TOPIC_HEARTBEAT, HEARTBEAT_EVICT_MS } from '@edgecloud/shared/constants.js';

export function watchHeartbeats(libp2p, log = console.log) {
  const devices = new Map(); // peerId -> { record, lastSeen }

  libp2p.services.pubsub.subscribe(TOPIC_HEARTBEAT);
  libp2p.services.pubsub.addEventListener('message', (evt) => {
    if (evt.detail.topic !== TOPIC_HEARTBEAT) return;
    try {
      const rec = JSON.parse(new TextDecoder().decode(evt.detail.data));
      // Backward/forward compatible: accept a bare {peerId,ts} or a full record.
      const peerId = rec.peerId;
      if (typeof peerId !== 'string' || peerId.length === 0 || peerId.length > 128) return;
      if (!devices.has(peerId)) log(`[heartbeat] worker online: ${peerId}`);
      devices.set(peerId, { record: rec, lastSeen: Date.now() });
    } catch {
      /* ignore malformed heartbeats */
    }
  });

  setInterval(() => {
    const cutoff = Date.now() - HEARTBEAT_EVICT_MS;
    for (const [id, d] of devices) {
      if (d.lastSeen < cutoff) {
        devices.delete(id);
        log(`[heartbeat] worker offline: ${id}`);
      }
    }
  }, 5000).unref();

  // Project a device record into the public status shape (omit nothing
  // sensitive — these are host capability facts, no PII).
  function summary(peerId, d) {
    const r = d.record || {};
    return {
      peerId,
      hostname: r.hostname ?? null,
      cpu: r.cpu ?? null, // { model, cores, arch, platform, load1m }
      ram: r.ram ?? null, // { totalBytes, freeBytes }
      storage: r.storage ?? null, // { totalBytes, freeBytes }
      status: r.status ?? 'available',
      maxConcurrent: r.maxConcurrent ?? null,
      currentLoad: r.currentLoad ?? null,
      availableCapacity: r.availableCapacity ?? null,
    };
  }

  return {
    online: () => [...devices.keys()],
    count: () => devices.size,
    devices: () => [...devices.entries()].map(([id, d]) => summary(id, d)),
    // Total free job slots across the fleet (for a future scheduler / display).
    totalAvailableCapacity: () =>
      [...devices.values()].reduce((n, d) => n + (d.record?.availableCapacity ?? 0), 0),
  };
}
