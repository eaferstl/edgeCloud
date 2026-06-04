// Keeps the SQLite indexes in sync with the replicated OrbitDB databases.
// On boot it does a full rescan (SQLite is just a cache — see db.js), then
// follows 'update' events. All verification happens here so the HTTP layer
// can trust the indexes.

import { allEventValues } from '@edgecloud/shared/orbit.js';
import {
  verifyAttestation,
  computeTrustedServers,
  validateEndorsementShape,
} from '@edgecloud/shared/trust.js';
import { verifyEnvelope } from '@edgecloud/shared/envelope.js';
import { verifyResult } from '@edgecloud/shared/result.js';
import { GENESIS_SERVER_KEY } from '@edgecloud/shared/constants.js';

export function createIndexers({ databases, q, genesisKey = GENESIS_SERVER_KEY, log = console.log }) {
  const state = {
    trustedServers: new Map(), // serverPubkey -> {multiaddrs, label}
  };

  function recomputeTrust(serverEntries) {
    state.trustedServers = computeTrustedServers(genesisKey, serverEntries);
  }

  function indexRegistryEntry(entry) {
    if (verifyAttestation(entry, state.trustedServers) !== null) return false;
    // `role` is advisory metadata on the entry (not part of the signed
    // attestation message); default to 'user' for legacy entries without it.
    return q.upsertRegisteredKey(entry.pubkey, entry.emailHmac, entry.addedAt, entry.role === 'worker' ? 'worker' : 'user');
  }

  function indexJobEntry(env) {
    if (verifyEnvelope(env) !== null) return false;
    return q.addJobSubmitter(env.jobId, env.pubkey, env.submittedAt ?? Date.now());
  }

  function indexResultDoc(doc) {
    // Verify the worker's SIGNATURE before caching/serving — the results DB is
    // open-write, so an unsigned/forged result must never reach a user. This
    // closes third-party result forgery (THREAT_MODEL.md R-003); a registered
    // worker signing a wrong answer is a separate, documented future problem.
    if (!doc || verifyResult(doc) !== null) return false;
    if (q.getCachedResult(doc.jobId)) return false; // first VALID result wins
    q.cacheResult(doc.jobId, JSON.stringify(doc));
    return true;
  }

  async function fullRescan() {
    const [serverEntries, registryEntries, jobEntries] = await Promise.all([
      allEventValues(databases.servers),
      allEventValues(databases.registry),
      allEventValues(databases.jobs),
    ]);
    recomputeTrust(serverEntries.filter((e) => validateEndorsementShape(e) === null));
    let keys = 0;
    for (const e of registryEntries) if (indexRegistryEntry(e)) keys++;
    let jobs = 0;
    for (const e of jobEntries) if (indexJobEntry(e)) jobs++;
    let results = 0;
    for await (const doc of databases.results.iterator()) {
      if (indexResultDoc(doc.value)) results++;
    }
    log(
      `[indexers] rescan: ${state.trustedServers.size} trusted servers, ` +
        `+${keys} keys, +${jobs} job submitters, +${results} results ` +
        `(totals: ${q.registeredKeyCount()} keys, ${q.cachedResultCount()} results)`
    );
  }

  function follow() {
    databases.servers.events.on('update', async () => {
      // trust changes can validate previously-rejected registry entries
      await fullRescan();
    });
    databases.registry.events.on('update', (entry) => {
      const v = entry?.payload?.value;
      if (v) indexRegistryEntry(v);
    });
    databases.jobs.events.on('update', (entry) => {
      const v = entry?.payload?.value;
      if (v) indexJobEntry(v);
    });
    databases.results.events.on('update', (entry) => {
      const v = entry?.payload?.value;
      if (v && indexResultDoc(v)) log(`[results] cached result for ${v.jobId?.slice(0, 12)}… from ${v.executedBy}`);
    });
  }

  return { state, fullRescan, follow, indexResultDoc };
}
