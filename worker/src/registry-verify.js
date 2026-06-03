// Verifies job submitters against the replicated registry, honoring the
// trust chain. CRITICAL RULE: never reject a job on possibly-stale data —
// when a pubkey is unknown, wait for the registry to re-sync (and ask a
// central server over HTTP as a fallback) before giving up.

import { allEventValues } from '@edgecloud/shared/orbit.js';
import {
  verifyAttestation,
  computeTrustedServers,
  validateEndorsementShape,
} from '@edgecloud/shared/trust.js';
import {
  GENESIS_SERVER_KEY,
  REGISTRY_GRACE_MS,
  REGISTRY_GRACE_POLL_MS,
} from '@edgecloud/shared/constants.js';

export function createRegistryVerifier({ databases, httpFallback, log = console.log }) {
  let trustedServers = computeTrustedServers(GENESIS_SERVER_KEY, []);
  const verifiedKeys = new Set(); // pubkeys with a valid attestation

  async function rebuild() {
    const serverEntries = (await allEventValues(databases.servers)).filter(
      (e) => validateEndorsementShape(e) === null
    );
    trustedServers = computeTrustedServers(GENESIS_SERVER_KEY, serverEntries);
    verifiedKeys.clear();
    const regEntries = await allEventValues(databases.registry);
    for (const e of regEntries) {
      if (verifyAttestation(e, trustedServers) === null) verifiedKeys.add(e.pubkey);
    }
    log(`[registry] ${verifiedKeys.size} verified keys, ${trustedServers.size} trusted servers`);
  }

  function follow() {
    databases.registry.events.on('update', (entry) => {
      const v = entry?.payload?.value;
      if (v && verifyAttestation(v, trustedServers) === null) {
        verifiedKeys.add(v.pubkey);
      }
    });
    // trust expansion can validate previously-rejected attestations
    databases.servers.events.on('update', () => rebuild().catch(() => {}));
  }

  /**
   * Is this pubkey registered? Waits for replication before answering "no".
   */
  async function checkWithGrace(pubkey) {
    if (verifiedKeys.has(pubkey)) return true;
    log(`[registry] unknown key ${pubkey.slice(0, 12)}… — waiting for registry sync`);
    const deadline = Date.now() + REGISTRY_GRACE_MS;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, REGISTRY_GRACE_POLL_MS));
      if (verifiedKeys.has(pubkey)) return true;
      await rebuild().catch(() => {});
      if (verifiedKeys.has(pubkey)) return true;
    }
    // Last resort: ask a central server directly (HTTP). Its answer is only
    // accepted as a hint to keep waiting; the authoritative check is still a
    // verified attestation, which one more rebuild may now see.
    try {
      const res = await fetch(`${httpFallback}/api/registry/${encodeURIComponent(pubkey)}`, {
        signal: AbortSignal.timeout(5000),
      });
      const body = await res.json();
      if (body.registered) {
        await rebuild().catch(() => {});
        if (verifiedKeys.has(pubkey)) return true;
        log(`[registry] server says ${pubkey.slice(0, 12)}… is registered but no attestation replicated yet`);
      }
    } catch {
      /* fallback unreachable; fall through to reject */
    }
    return verifiedKeys.has(pubkey);
  }

  return { rebuild, follow, checkWithGrace, trustedServers: () => trustedServers };
}
