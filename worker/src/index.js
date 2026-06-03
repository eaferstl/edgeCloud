// edgeCloud worker node. Runs inside the Docker container: dials the
// rendezvous server, replicates the OrbitDB databases, verifies and executes
// jobs per the claim protocol, publishes results, and emits presence
// heartbeats. All communication is over libp2p — there is no privileged
// channel to any central server.

import { multiaddr } from '@multiformats/multiaddr';
import { createHelia } from 'helia';
import { createOrbitDB } from '@orbitdb/core';
import { LevelBlockstore } from 'blockstore-level';
import path from 'node:path';
import { openNetworkDatabases } from '@edgecloud/shared/orbit.js';
import { TOPIC_HEARTBEAT, HEARTBEAT_INTERVAL_MS } from '@edgecloud/shared/constants.js';
import { config } from './config.js';
import { createWorkerLibp2p } from './libp2p-node.js';
import { createRegistryVerifier } from './registry-verify.js';
import { createCoordinator } from './coordination.js';

async function main() {
  console.log(`[boot] edgeCloud worker starting (data: ${config.dataDir})`);
  console.log(`[boot] rendezvous: ${config.rendezvous.join(', ')}`);

  const libp2p = await createWorkerLibp2p(config.dataDir, config.rendezvous);
  const peerId = libp2p.peerId.toString();
  console.log(`[boot] peerId: ${peerId}`);

  const blockstore = new LevelBlockstore(path.join(config.dataDir, 'blocks'));
  const ipfs = await createHelia({ libp2p, blockstore });
  const orbitdb = await createOrbitDB({ ipfs, directory: path.join(config.dataDir, 'orbitdb') });

  await dialRendezvous(libp2p);

  const databases = await openNetworkDatabases(orbitdb);
  console.log(`[boot] databases open; waiting for replication…`);

  const registry = createRegistryVerifier({ databases, httpFallback: config.httpFallback });
  await registry.rebuild();
  registry.follow();

  const coordinator = createCoordinator({ databases, registry, peerId });
  coordinator.follow();
  // give initial head-sync a moment, then work through any backlog
  setTimeout(() => coordinator.scanBacklog().catch(() => {}), 8000);
  // Periodically refresh the registry/trust set and re-scan the backlog. This
  // is what lets a job that was rejected as "unknown submitter" get executed
  // later, once the submitter's server is endorsed (trust replicates) — without
  // it, a rejection would be permanent. handleJob dedupes, so this is cheap.
  setInterval(() => {
    registry
      .rebuild()
      .then(() => coordinator.scanBacklog())
      .catch(() => {});
  }, 30000).unref();

  // presence heartbeat (UI only)
  setInterval(() => {
    libp2p.services.pubsub
      .publish(TOPIC_HEARTBEAT, new TextEncoder().encode(JSON.stringify({ peerId, ts: Date.now() })))
      .catch(() => {});
  }, HEARTBEAT_INTERVAL_MS);

  // keep the rendezvous connection alive
  setInterval(() => dialRendezvous(libp2p, true).catch(() => {}), 30000);

  const shutdown = async (sig) => {
    console.log(`[shutdown] ${sig}`);
    try {
      await orbitdb.stop();
      await libp2p.stop();
    } catch {}
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

async function dialRendezvous(libp2p, quiet = false) {
  for (const addr of config.rendezvous) {
    try {
      const ma = multiaddr(addr);
      const peerIdStr = (/\/p2p\/([^/]+)\/?$/.exec(addr) || [])[1];
      if (peerIdStr && libp2p.getConnections().some((c) => c.remotePeer.toString() === peerIdStr)) {
        return; // already connected
      }
      await libp2p.dial(ma);
      if (!quiet) console.log(`[net] connected to rendezvous ${addr}`);
      return;
    } catch (e) {
      if (!quiet) console.log(`[net] dial failed for ${addr}: ${e.message}`);
    }
  }
  if (!quiet) {
    console.log('[net] could not reach any rendezvous yet — will keep retrying');
    setTimeout(() => dialRendezvous(libp2p, true).catch(() => {}), 5000);
  }
}

main().catch((e) => {
  console.error('[fatal]', e);
  process.exit(1);
});
