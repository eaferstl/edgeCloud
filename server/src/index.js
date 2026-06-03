// edgeCloud central/rendezvous server.
//
// One process: libp2p (TCP+WS, circuit relay v2 server, gossipsub) + Helia +
// OrbitDB peer + Express HTTP bridge + SQLite cache. Replicates every network
// DB and pins it (the always-on data holder), but NEVER executes jobs — it
// answers duplicate submissions from its result cache.

import { config } from './config.js';
import { openDb, makeQueries } from './db.js';
import { loadOrCreateServerKey } from './server-key.js';
import { createServerLibp2p } from './libp2p-node.js';
import { createOrbitNode } from './orbit-node.js';
import { createIndexers } from './indexers.js';
import { createAuth } from './auth.js';
import { watchHeartbeats } from './heartbeats.js';
import { createApp } from './http/app.js';
import { createEndorsement } from '@edgecloud/shared/trust.js';
import { allEventValues } from '@edgecloud/shared/orbit.js';
import { GENESIS_SERVER_KEY, GENESIS_MULTIADDRS } from '@edgecloud/shared/constants.js';
import { multiaddr } from '@multiformats/multiaddr';

async function main() {
  console.log(`[boot] edgeCloud server starting (data: ${config.dataDir})`);

  const serverKey = loadOrCreateServerKey(config.dataDir);
  const db = openDb(config.dataDir);
  const q = makeQueries(db, config.sharedSalt);

  const libp2p = await createServerLibp2p(config.dataDir, {
    tcpPort: config.tcpPort,
    wsPort: config.wsPort,
  });
  console.log(`[boot] libp2p peerId: ${libp2p.peerId.toString()}`);
  for (const ma of libp2p.getMultiaddrs()) console.log(`[boot]   listening: ${ma.toString()}`);

  // Peer with the rest of the network. The genesis server has nobody to dial;
  // every other server dials genesis (and learns more peers via the
  // edgecloud-servers DB) so their OrbitDB stores replicate together.
  const ownPeerId = libp2p.peerId.toString();
  const peerAddrs = GENESIS_MULTIADDRS.filter((a) => !a.includes(ownPeerId));
  if (peerAddrs.length > 0) {
    dialServers(libp2p, peerAddrs);
    setInterval(() => dialServers(libp2p, peerAddrs, true), 30000).unref();
  }

  const { orbitdb, databases } = await createOrbitNode(libp2p, config.dataDir);
  for (const [name, d] of Object.entries(databases)) {
    console.log(`[boot] db ${name}: ${d.address.toString()}`);
  }

  const indexers = createIndexers({ databases, q });
  await indexers.fullRescan();
  indexers.follow();

  // Advertise our public multiaddrs to the network via a self-endorsement
  // (valid only if we are already trusted: genesis, or endorsed by a peer).
  await maybeSelfAdvertise({ databases, indexers, serverKey });

  const auth = createAuth();
  const heartbeats = watchHeartbeats(libp2p);
  const app = createApp({ q, auth, databases, indexers, heartbeats, serverKey, libp2p, config });

  const httpServer = app.listen(config.httpPort, () => {
    console.log(`[boot] HTTP listening on :${config.httpPort}`);
    console.log(`[boot] server pubkey: ${serverKey.publicKey}`);
    console.log(
      GENESIS_SERVER_KEY
        ? `[boot] genesis key: ${GENESIS_SERVER_KEY}${GENESIS_SERVER_KEY === serverKey.publicKey ? ' (this server IS genesis)' : ''}`
        : '[boot] WARNING: no genesis key configured — workers will trust nothing. Set EDGECLOUD_GENESIS_KEY or bake into shared/constants.js'
    );
  });

  const shutdown = async (sig) => {
    console.log(`[shutdown] ${sig}`);
    httpServer.close();
    try {
      await orbitdb.stop();
      await libp2p.stop();
      db.close();
    } catch (e) {
      console.error('[shutdown] error:', e.message);
    }
    process.exit(0);
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

async function dialServers(libp2p, addrs, quiet = false) {
  for (const addr of addrs) {
    try {
      const ma = multiaddr(addr);
      const pid = (/\/p2p\/([^/]+)\/?$/.exec(addr) || [])[1];
      if (pid && libp2p.getConnections().some((c) => c.remotePeer.toString() === pid)) continue;
      await libp2p.dial(ma);
      if (!quiet) console.log(`[net] peered with server ${addr}`);
    } catch (e) {
      if (!quiet) console.log(`[net] could not peer with ${addr}: ${e.message}`);
    }
  }
}

async function maybeSelfAdvertise({ databases, indexers, serverKey }) {
  const trusted = indexers.state.trustedServers;
  if (!trusted.has(serverKey.publicKey)) {
    if (GENESIS_SERVER_KEY && GENESIS_SERVER_KEY !== serverKey.publicKey) {
      console.log('[boot] this server is not yet trusted; ask an existing operator to endorse:');
      console.log(`[boot]   npm run endorse-server -- ${serverKey.publicKey} "<multiaddrs>" "<label>"`);
    }
    return;
  }
  if (config.publicMultiaddrs.length === 0) return;
  const entries = await allEventValues(databases.servers);
  const advertised = entries.some(
    (e) =>
      e?.serverPubkey === serverKey.publicKey &&
      JSON.stringify(e.multiaddrs) === JSON.stringify(config.publicMultiaddrs)
  );
  if (advertised) return;
  const entry = createEndorsement({
    serverPubkey: serverKey.publicKey,
    multiaddrs: config.publicMultiaddrs,
    label: config.label,
    endorserPublicKeyB64: serverKey.publicKey,
    endorserSecretKeyB64: serverKey.secretKey,
  });
  await databases.servers.add(entry);
  console.log(`[boot] self-advertised multiaddrs: ${config.publicMultiaddrs.join(', ')}`);
}

main().catch((e) => {
  console.error('[fatal]', e);
  process.exit(1);
});
