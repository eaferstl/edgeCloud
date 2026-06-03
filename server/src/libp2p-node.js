// libp2p node for the central server: TCP + WebSocket listeners, circuit
// relay v2 SERVER (so NAT'd workers become reachable through us), gossipsub
// for OrbitDB replication + heartbeats. The peerId persists via the level
// datastore so the public multiaddr is stable across restarts.

import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { webSockets } from '@libp2p/websockets';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify } from '@libp2p/identify';
import { circuitRelayServer } from '@libp2p/circuit-relay-v2';
import { gossipsub } from '@libp2p/gossipsub';
import { LevelDatastore } from 'datastore-level';
import path from 'node:path';
import { loadOrCreatePeerKey } from '@edgecloud/shared/peer-key.js';

export async function createServerLibp2p(dataDir, { tcpPort = 4001, wsPort = 4002 } = {}) {
  const datastore = new LevelDatastore(path.join(dataDir, 'libp2p'));
  await datastore.open();
  const privateKey = await loadOrCreatePeerKey(dataDir);

  const node = await createLibp2p({
    privateKey,
    datastore,
    addresses: {
      listen: [`/ip4/0.0.0.0/tcp/${tcpPort}`, `/ip4/0.0.0.0/tcp/${wsPort}/ws`],
    },
    transports: [tcp(), webSockets()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    services: {
      identify: identify(),
      relay: circuitRelayServer({
        reservations: {
          maxReservations: 256,
          // generous: every attendee worker NATs through us
          defaultDataLimit: BigInt(1 << 30),
        },
      }),
      pubsub: gossipsub({ allowPublishToZeroTopicPeers: true, emitSelf: false }),
    },
  });
  return node;
}
