// Persistent Ed25519 server keypair — the identity used to attest user
// registrations and endorse other central servers. Generated on first boot;
// the PUBLIC key of the original 146.190.123.91 deployment is the network's
// genesis trust root (shared/constants.js GENESIS_SERVER_KEY).

import fs from 'node:fs';
import path from 'node:path';
import { generateKeypair } from '@edgecloud/shared/crypto.js';

export function loadOrCreateServerKey(dataDir) {
  const file = path.join(dataDir, 'server-key.json');
  if (fs.existsSync(file)) {
    const kp = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (!kp.publicKey || !kp.secretKey) throw new Error(`corrupt server key file: ${file}`);
    return kp;
  }
  const kp = generateKeypair();
  fs.mkdirSync(dataDir, { recursive: true });
  fs.writeFileSync(file, JSON.stringify(kp, null, 2), { mode: 0o600 });
  console.log(`[server-key] generated new server keypair at ${file}`);
  console.log(`[server-key] PUBLIC KEY (share for endorsement / genesis): ${kp.publicKey}`);
  return kp;
}
