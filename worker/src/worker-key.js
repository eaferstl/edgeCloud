// Persistent Ed25519 WORKER IDENTITY key. The worker's network identity is the
// base64 of this public key — stable across restarts, NOT a free-to-rotate
// string. Every claim the worker makes is SIGNED with this key (see
// shared/src/claims.js), so a claim cannot be forged for an identity the
// claimant doesn't control. This is the baseline defense against the
// claim-grinding / Sybil work-stealing attack (THREAT_MODEL.md R-010): it
// raises "grind arbitrary peerId strings (free)" to "must own the signing key."
//
// (Separate from the libp2p peer key, which is the transport address; this is
// the app-layer identity, consistent with how users and servers are keyed.)

import fs from 'node:fs';
import path from 'node:path';
import { generateKeypair } from '@edgecloud/shared/crypto.js';

export function loadOrCreateWorkerKey(dataDir) {
  const file = path.join(dataDir, 'worker-key.json');
  if (fs.existsSync(file)) {
    const kp = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!kp.publicKey || !kp.secretKey) throw new Error(`corrupt worker key file: ${file}`);
    return kp;
  }
  const kp = generateKeypair();
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(kp, null, 2), { mode: 0o600 });
  return kp;
}
