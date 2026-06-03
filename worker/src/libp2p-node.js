// libp2p node for workers. Most workers sit behind NAT, so they listen on
// /p2p-circuit (reachable through the rendezvous server's relay) and dial the
// rendezvous over TCP or WebSockets. Gossipsub rides those connections; the
// relay-backed mesh is how OrbitDB replication reaches everyone.

import { createLibp2p } from 'libp2p';
import { tcp } from '@libp2p/tcp';
import { webSockets } from '@libp2p/websockets';
import { noise } from '@chainsafe/libp2p-noise';
import { yamux } from '@chainsafe/libp2p-yamux';
import { identify } from '@libp2p/identify';
import { circuitRelayTransport } from '@libp2p/circuit-relay-v2';
import { gossipsub } from '@libp2p/gossipsub';
import { bootstrap } from '@libp2p/bootstrap';
import { LevelDatastore } from 'datastore-level';
import path from 'node:path';
import { loadOrCreatePeerKey } from '@edgecloud/shared/peer-key.js';

export async function createWorkerLibp2p(dataDir, rendezvousAddrs) {
  const datastore = new LevelDatastore(path.join(dataDir, 'libp2p'));
  await datastore.open();
  const privateKey = await loadOrCreatePeerKey(dataDir);

  return createLibp2p({
    privateKey,
    datastore,
    addresses: {
      listen: ['/p2p-circuit'], // reachable via the relay, no port-forwarding needed
    },
    transports: [tcp(), webSockets(), circuitRelayTransport()],
    connectionEncrypters: [noise()],
    streamMuxers: [yamux()],
    peerDiscovery: [bootstrap({ list: rendezvousAddrs })],
    services: {
      identify: identify(),
      pubsub: gossipsub({ allowPublishToZeroTopicPeers: true, emitSelf: false }),
    },
  });
}
