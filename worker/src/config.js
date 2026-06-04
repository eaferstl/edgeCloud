// Worker configuration from environment.

import path from 'node:path';
import { GENESIS_MULTIADDRS } from '@edgecloud/shared/constants.js';

export const config = {
  dataDir: path.resolve(process.env.EDGECLOUD_DATA || './worker-data'),
  // Rendezvous server multiaddrs (comma-separated). Defaults to the genesis
  // server baked into shared/constants.js; RENDEZVOUS_MULTIADDR overrides.
  rendezvous: (process.env.RENDEZVOUS_MULTIADDR
    ? process.env.RENDEZVOUS_MULTIADDR.split(',').map((s) => s.trim()).filter(Boolean)
    : GENESIS_MULTIADDRS),
  // HTTP fallback for the registry-grace check (any central server).
  httpFallback: (process.env.EDGECLOUD_HTTP_FALLBACK || 'http://146.190.123.91').replace(/\/$/, ''),
  // Max simultaneous jobs this node advertises (seeds availableCapacity; from
  // chaodoze's EDGECLOUD_MAX_CONCURRENT). The claim protocol does not yet gate
  // on this — it's advertised for display and future least-loaded routing.
  maxConcurrent: Number(process.env.EDGECLOUD_MAX_CONCURRENT) || 4,
  // The unprivileged uid/gid that UNTRUSTED submitted code is dropped to. Set
  // in the Docker image; unset in local dev/tests (jobs then run in-process as
  // the current user — fine for trusted local runs, NOT for production).
  sandboxUid: process.env.EDGECLOUD_SANDBOX_UID ? Number(process.env.EDGECLOUD_SANDBOX_UID) : null,
  sandboxGid: process.env.EDGECLOUD_SANDBOX_GID ? Number(process.env.EDGECLOUD_SANDBOX_GID) : null,
};

if (config.rendezvous.length === 0) {
  console.error(
    '[config] no rendezvous multiaddrs: set RENDEZVOUS_MULTIADDR=/ip4/<host>/tcp/4002/ws/p2p/<peerId>'
  );
  process.exit(1);
}
