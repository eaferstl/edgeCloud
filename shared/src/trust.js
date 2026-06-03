// Server trust chain + attestations.
//
// Central servers are interchangeable: each has a persistent Ed25519 "server
// key". Trust is rooted at GENESIS_SERVER_KEY (the original rendezvous server)
// and extends transitively through endorsement entries in the open-write
// edgecloud-servers DB: an entry is honored iff its endorseSig verifies AND
// its endorser is already trusted. Workers recompute the trusted set from the
// replicated DB — onboarding a new server requires no config change anywhere.
//
// Registry entries (user public keys) are attestations signed by a trusted
// server key. Raw emails never appear — only HMAC-SHA256(email, SHARED_SALT),
// which every server can recompute from its own copy of the attendee CSV +
// the shared salt, keeping servers stateless/equivalent.

import { canonicalJson } from './canonical.js';
import { signDetachedB64, verifyDetachedB64, isValidPubkeyB64 } from './crypto.js';

// ---------- registry attestations (user keys) ----------

function attestationMessage({ pubkey, emailHmac, addedAt }) {
  return canonicalJson({ kind: 'edgecloud-attest-v1', pubkey, emailHmac, addedAt });
}

export function createAttestation({ pubkey, emailHmac, serverPublicKeyB64, serverSecretKeyB64 }) {
  const addedAt = Date.now();
  const entry = { v: 1, pubkey, emailHmac, addedAt, attestedBy: serverPublicKeyB64 };
  entry.attestSig = signDetachedB64(attestationMessage(entry), serverSecretKeyB64);
  return entry;
}

/**
 * Verify an attestation against a trusted-server set.
 * @param {object} entry
 * @param {Set<string>|Map<string,any>} trustedServers - keys are base64 server pubkeys
 * @returns {string|null} null if valid
 */
export function verifyAttestation(entry, trustedServers) {
  if (!entry || typeof entry !== 'object') return 'not an object';
  if (entry.v !== 1) return 'unsupported attestation version';
  if (!isValidPubkeyB64(entry.pubkey)) return 'malformed pubkey';
  if (typeof entry.emailHmac !== 'string' || !/^[0-9a-f]{64}$/.test(entry.emailHmac)) {
    return 'malformed emailHmac';
  }
  if (!Number.isInteger(entry.addedAt)) return 'malformed addedAt';
  if (!isValidPubkeyB64(entry.attestedBy)) return 'malformed attestedBy';
  if (!trustedServers.has(entry.attestedBy)) return 'attester is not a trusted server';
  if (!verifyDetachedB64(attestationMessage(entry), entry.attestSig, entry.attestedBy)) {
    return 'bad attestation signature';
  }
  return null;
}

// ---------- server endorsements (onboarding) ----------

function endorsementMessage({ serverPubkey, multiaddrs, label, addedAt }) {
  return canonicalJson({ kind: 'edgecloud-endorse-v1', serverPubkey, multiaddrs, label, addedAt });
}

export function createEndorsement({
  serverPubkey,
  multiaddrs = [],
  label = '',
  endorserPublicKeyB64,
  endorserSecretKeyB64,
}) {
  const addedAt = Date.now();
  const entry = { v: 1, serverPubkey, multiaddrs, label, addedAt, endorsedBy: endorserPublicKeyB64 };
  entry.endorseSig = signDetachedB64(endorsementMessage(entry), endorserSecretKeyB64);
  return entry;
}

export function validateEndorsementShape(e) {
  if (!e || typeof e !== 'object') return 'not an object';
  if (e.v !== 1) return 'unsupported endorsement version';
  if (!isValidPubkeyB64(e.serverPubkey)) return 'malformed serverPubkey';
  if (!Array.isArray(e.multiaddrs) || !e.multiaddrs.every((m) => typeof m === 'string' && m.length <= 256)) {
    return 'malformed multiaddrs';
  }
  if (e.multiaddrs.length > 16) return 'too many multiaddrs';
  if (typeof e.label !== 'string' || e.label.length > 128) return 'malformed label';
  if (!Number.isInteger(e.addedAt)) return 'malformed addedAt';
  if (!isValidPubkeyB64(e.endorsedBy)) return 'malformed endorsedBy';
  if (typeof e.endorseSig !== 'string') return 'missing endorseSig';
  return null;
}

/**
 * Compute the trusted-server set from the genesis key plus endorsement
 * entries (cycle-safe fixpoint; order-independent).
 * @param {string} genesisKeyB64
 * @param {Array<object>} entries - raw entries from the edgecloud-servers DB
 * @returns {Map<string, {multiaddrs: string[], label: string}>}
 */
export function computeTrustedServers(genesisKeyB64, entries) {
  const trusted = new Map();
  if (!isValidPubkeyB64(genesisKeyB64)) return trusted; // no genesis -> nothing is trusted
  trusted.set(genesisKeyB64, { multiaddrs: [], label: 'genesis' });

  const valid = entries.filter((e) => validateEndorsementShape(e) === null);
  let changed = true;
  while (changed) {
    changed = false;
    for (const e of valid) {
      if (!trusted.has(e.endorsedBy)) continue;
      if (!verifyDetachedB64(endorsementMessage(e), e.endorseSig, e.endorsedBy)) continue;
      const existing = trusted.get(e.serverPubkey);
      if (!existing) {
        trusted.set(e.serverPubkey, { multiaddrs: e.multiaddrs, label: e.label });
        changed = true;
      } else if (existing.multiaddrs.length === 0 && e.multiaddrs.length > 0) {
        // A trusted server (incl. genesis) may advertise its multiaddrs via a
        // self- or peer-endorsement; keep the richer record.
        trusted.set(e.serverPubkey, { multiaddrs: e.multiaddrs, label: e.label || existing.label });
      }
    }
  }
  return trusted;
}
