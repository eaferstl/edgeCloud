// Worker presence + device capabilities via gossipsub heartbeats. Presence is
// scheduling-advisory/UI only — the claim protocol does not depend on it — so a
// lightweight in-memory map of the latest device record per peer is enough.
//
// The device record schema (cpu/ram/storage + status/maxConcurrent/currentLoad/
// availableCapacity) is adapted from chaodoze's device registry; see
// worker/src/device-info.js.

import { TOPIC_HEARTBEAT, HEARTBEAT_EVICT_MS } from '@edgecloud/shared/constants.js';

export function watchHeartbeats(libp2p, log = console.log, onChange = () => {}) {
  const devices = new Map(); // peerId -> { record, lastSeen }

  libp2p.services.pubsub.subscribe(TOPIC_HEARTBEAT);
  libp2p.services.pubsub.addEventListener('message', (evt) => {
    if (evt.detail.topic !== TOPIC_HEARTBEAT) return;
    try {
      const rec = JSON.parse(new TextDecoder().decode(evt.detail.data));
      // Backward/forward compatible: accept a bare {peerId,ts} or a full record.
      const peerId = rec.peerId;
      if (typeof peerId !== 'string' || peerId.length === 0 || peerId.length > 128) return;
      // The gossipsub message's source IS the worker's transport peerId — so we
      // can resolve its IP even for workers that don't self-report libp2pPeerId.
      const fromPeer = evt.detail.from && evt.detail.from.toString ? evt.detail.from.toString() : null;
      if (!devices.has(peerId)) log(`[heartbeat] worker online: ${peerId}`);
      devices.set(peerId, { record: rec, lastSeen: Date.now(), transportPeerId: rec.libp2pPeerId || fromPeer });
      onChange(); // each heartbeat may change load/capacity → push a fresh snapshot
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
        onChange();
      }
    }
  }, 5000).unref();

  // Resolve a worker's source IP from the server's live libp2p connection to its
  // transport peerId. Direct connections give the worker's real (NAT) IP; we skip
  // relayed addrs (their visible /ip4 is the relay's, not the worker's).
  function ipFromMultiaddr(s) {
    const m4 = /\/ip4\/([0-9.]+)/.exec(s);
    if (m4) return m4[1];
    const m6 = /\/ip6\/([0-9a-fA-F:]+)/.exec(s);
    return m6 ? m6[1] : null;
  }
  function ipFor(libp2pPeerId) {
    if (!libp2pPeerId) return null;
    try {
      const conns = libp2p.getConnections().filter((c) => c.remotePeer.toString() === libp2pPeerId);
      for (const c of conns) {
        const s = c.remoteAddr.toString();
        if (s.includes('p2p-circuit')) continue; // relayed: ip is the relay's
        const ip = ipFromMultiaddr(s);
        if (ip) return ip;
      }
    } catch {
      /* libp2p not ready / peer gone */
    }
    return null;
  }

  // Topology proximity the rendezvous can see right now: a direct (1-hop)
  // connection vs only a relayed (2-hop, through us) one. Real "ms" replaces
  // this once the latency module reports rttMs in the heartbeat.
  function connKind(libp2pPeerId) {
    if (!libp2pPeerId) return null;
    try {
      const conns = libp2p.getConnections().filter((c) => c.remotePeer.toString() === libp2pPeerId);
      if (!conns.length) return null;
      return conns.some((c) => !c.remoteAddr.toString().includes('p2p-circuit')) ? 'direct' : 'relay';
    } catch {
      return null;
    }
  }

  // Project a device record into the public status shape (omit nothing
  // sensitive — these are host capability facts, no PII).
  function summary(peerId, d) {
    const r = d.record || {};
    const transportPeerId = d.transportPeerId || r.libp2pPeerId || null;
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
      // --- live-map fields ---
      ip: ipFor(transportPeerId), // server-observed source IP (null if relayed/unknown)
      libp2pPeerId: transportPeerId,
      link: connKind(transportPeerId), // 'direct' (1 hop) | 'relay' (2 hops) | null
      // proximity to the rendezvous: filled in once the latency work lands (the
      // worker can carry rttMs in its heartbeat); the UI lays out by this.
      rttMs: typeof r.rttMs === 'number' ? r.rttMs : null,
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
