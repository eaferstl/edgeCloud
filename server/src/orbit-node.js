// Helia + OrbitDB on top of the server libp2p node. Blockstore/datastore are
// persistent so replicated job/result history survives restarts (the server
// is the always-on pinner of the network's data).

import { createHelia } from 'helia';
import { createOrbitDB } from '@orbitdb/core';
import { LevelBlockstore } from 'blockstore-level';
import { openNetworkDatabases } from '@edgecloud/shared/orbit.js';
import path from 'node:path';

export async function createOrbitNode(libp2p, dataDir) {
  const blockstore = new LevelBlockstore(path.join(dataDir, 'blocks'));
  const ipfs = await createHelia({ libp2p, blockstore });
  const orbitdb = await createOrbitDB({ ipfs, directory: path.join(dataDir, 'orbitdb') });
  const databases = await openNetworkDatabases(orbitdb);
  return { ipfs, orbitdb, databases };
}
