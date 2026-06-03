// Server configuration from environment. Every server in the network runs the
// same code with the same SHARED_SALT and attendee CSV; nothing here is
// instance-unique except dataDir contents (keys), which only affect identity,
// not state.

import path from 'node:path';

function required(name, fallback) {
  const v = process.env[name] ?? fallback;
  if (v === undefined) {
    console.error(`[config] missing required env var ${name}`);
    process.exit(1);
  }
  return v;
}

export const config = {
  dataDir: path.resolve(process.env.EDGECLOUD_DATA || './server-data'),
  httpPort: parseInt(process.env.HTTP_PORT || '8080', 10),
  tcpPort: parseInt(process.env.LIBP2P_TCP_PORT || '4001', 10),
  wsPort: parseInt(process.env.LIBP2P_WS_PORT || '4002', 10),
  // HMAC salt for pseudonymizing emails in OrbitDB. Distributed to server
  // operators together with the attendee CSV. NOT baked into the repo.
  sharedSalt: required('EDGECLOUD_SHARED_SALT'),
  // Public multiaddrs to advertise to workers (the VPS's public IP).
  publicMultiaddrs: (process.env.EDGECLOUD_PUBLIC_MULTIADDRS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  label: process.env.EDGECLOUD_SERVER_LABEL || 'edgecloud-server',
};
