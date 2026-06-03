// Persistent libp2p identity. js-libp2p generates a fresh peerId on every
// boot unless an explicit privateKey is supplied, so we keep an Ed25519 key
// in the data directory (protobuf-encoded, like the IPFS key format).

import fs from 'node:fs';
import path from 'node:path';
import { generateKeyPair, privateKeyToProtobuf, privateKeyFromProtobuf } from '@libp2p/crypto/keys';

export async function loadOrCreatePeerKey(dataDir) {
  const file = path.join(dataDir, 'peer-key.bin');
  if (fs.existsSync(file)) {
    return privateKeyFromProtobuf(new Uint8Array(fs.readFileSync(file)));
  }
  const key = await generateKeyPair('Ed25519');
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, privateKeyToProtobuf(key), { mode: 0o600 });
  return key;
}
