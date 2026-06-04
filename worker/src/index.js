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
import { buildDeviceRecord } from './device-info.js';
import { loadOrCreateWorkerKey } from './worker-key.js';
import { registerWorker } from './register-worker.js';

async function main() {
  // A worker MUST identify itself with an allowlisted Edge Esmeralda email so it
  // can register its identity key (≤4 keys/email). This is what makes worker
  // identity accountable rather than anonymous — fail fast if it's missing.
  if (!config.email || !config.email.includes('@')) {
    console.error(
      '[boot] EDGECLOUD_EMAIL is required — set it to your Edge Esmeralda attendee email\n' +
        '       so this worker can register its identity key (≤4 keys/email).'
    );
    process.exit(1);
  }

  console.log(`[boot] edgeCloud worker starting (data: ${config.dataDir})`);
  console.log(`[boot] rendezvous: ${config.rendezvous.join(', ')}`);

  // App-layer identity: the worker's stable, non-rotatable Ed25519 key. Its
  // base64 public key IS the worker's network identity; claims and results are
  // signed with it. (The libp2p peerId below is just the transport address.)
  const workerKey = loadOrCreateWorkerKey(config.dataDir);
  console.log(`[boot] worker identity (pubkey): ${workerKey.publicKey}`);

  const libp2p = await createWorkerLibp2p(config.dataDir, config.rendezvous);
  const peerId = libp2p.peerId.toString();
  console.log(`[boot] peerId (transport): ${peerId}`);

  const blockstore = new LevelBlockstore(path.join(config.dataDir, 'blocks'));
  // NOTE: default Helia block-brokers/routers. Overriding to drop the public-gateway
  // fallbacks broke replication in testing (deferred — see server/src/orbit-node.js).
  const ipfs = await createHelia({ libp2p, blockstore });
  const orbitdb = await createOrbitDB({ ipfs, directory: path.join(config.dataDir, 'orbitdb') });

  await dialRendezvous(libp2p);

  const databases = await openNetworkDatabases(orbitdb);
  console.log(`[boot] databases open; waiting for replication…`);

  const registry = createRegistryVerifier({ databases, httpFallback: config.httpFallback });
  await registry.rebuild();
  registry.follow();

  // Register this worker's identity key against the operator's allowlisted email
  // (idempotent). A definitive rejection (not allowlisted / quota) is fatal.
  await registerWorker({ httpFallback: config.httpFallback, email: config.email, pubkey: workerKey.publicKey });
  await registry.rebuild(); // pick up our own attestation if it has replicated

  const coordinator = createCoordinator({
    databases,
    registry,
    workerKey: workerKey.publicKey,
    workerSecretKey: workerKey.secretKey,
    maxConcurrent: config.maxConcurrent,
  });
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

  // presence heartbeat: a device capability + liveness record (schema adapted
  // from chaodoze's device registry). Carries CPU/RAM/storage and live
  // scheduling capacity so the server can show real device info and, later,
  // route to the least-loaded node. Still UI/scheduling-advisory only — the
  // claim protocol does not depend on it.
  //
  // SUBSCRIBE (not just publish) to the heartbeat topic so the worker is a real
  // gossipsub MESH member, not an ephemeral fan-out publisher. A mesh self-heals
  // (gossipsub re-GRAFTs on its own heartbeat after a peer reconnects), so the
  // worker keeps showing up in "workers online" after the rendezvous/server
  // restarts — fan-out state went stale there and the worker silently vanished
  // from the UI while still working (ROADMAP.md §F / R-011). We don't need the
  // inbound messages; subscribing is purely for reliable mesh membership.
  libp2p.services.pubsub.subscribe(TOPIC_HEARTBEAT);
  const publishHeartbeat = async () => {
    try {
      const record = await buildDeviceRecord(workerKey.publicKey, coordinator.live);
      record.libp2pPeerId = peerId; // transport peerId → lets the server resolve our IP for the live map
      await libp2p.services.pubsub.publish(TOPIC_HEARTBEAT, new TextEncoder().encode(JSON.stringify(record)));
    } catch {
      /* transient pubsub/metadata error; next tick retries */
    }
  };
  publishHeartbeat();
  setInterval(publishHeartbeat, HEARTBEAT_INTERVAL_MS);

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
