// Worker presence via gossipsub heartbeats. Presence is UI-only — the claim
// protocol does not depend on it — so a lightweight in-memory map is enough.

import { TOPIC_HEARTBEAT, HEARTBEAT_EVICT_MS } from '@edgecloud/shared/constants.js';

export function watchHeartbeats(libp2p, log = console.log) {
  const workers = new Map(); // peerId -> lastSeen ms

  libp2p.services.pubsub.subscribe(TOPIC_HEARTBEAT);
  libp2p.services.pubsub.addEventListener('message', (evt) => {
    if (evt.detail.topic !== TOPIC_HEARTBEAT) return;
    try {
      const msg = JSON.parse(new TextDecoder().decode(evt.detail.data));
      if (typeof msg.peerId === 'string' && msg.peerId.length <= 128) {
        if (!workers.has(msg.peerId)) log(`[heartbeat] worker online: ${msg.peerId}`);
        workers.set(msg.peerId, Date.now());
      }
    } catch {
      /* ignore malformed heartbeats */
    }
  });

  setInterval(() => {
    const cutoff = Date.now() - HEARTBEAT_EVICT_MS;
    for (const [id, seen] of workers) {
      if (seen < cutoff) {
        workers.delete(id);
        log(`[heartbeat] worker offline: ${id}`);
      }
    }
  }, 5000).unref();

  return {
    online: () => [...workers.keys()],
    count: () => workers.size,
  };
}
