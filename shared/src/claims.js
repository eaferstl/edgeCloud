// Claim protocol helpers (claims log + deterministic tiebreak), now with
// SIGNED, key-bound worker identities.
//
// Every worker that sees a job appends a claim {jobId, workerKey, round, sig}
// to the open-write edgecloud-claims events DB, where `workerKey` is the
// base64 Ed25519 public key that IS the worker's identity (worker/src/
// worker-key.js) and `sig` signs (jobId|workerKey|round). Workers wait
// CLAIM_SETTLE_MS, then compute the winner deterministically: lowest
// sha256(jobId|workerKey|round). The tiebreak is order-independent, so any two
// workers seeing the same claim set agree on the winner.
//
// WHY SIGNED (THREAT_MODEL.md R-010): the claims DB is open-write. If claims
// were unsigned, an attacker could submit arbitrary `workerKey` STRINGS and
// grind them to minimise the hash and win jobs (work-stealing) — cheaply,
// without owning any key. Requiring a valid signature binds each claim to a key
// the claimant actually controls, so the tiebreak input can't be a forged
// string; grinding now costs real keypair generation (and is further bounded by
// future registration/reputation). Validate before trusting any claim.

import { sha256Hex, signDetachedB64, verifyDetachedB64, isValidPubkeyB64 } from './crypto.js';

function claimMessage(jobId, workerKey, round) {
  return `${jobId}|${workerKey}|${round}`;
}

export function claimRank(jobId, workerKey, round) {
  return sha256Hex(claimMessage(jobId, workerKey, round));
}

/** Build a SIGNED claim. workerKey = base64 Ed25519 pubkey; secretKeyB64 its key. */
export function buildClaim(jobId, workerKey, round, secretKeyB64) {
  const claim = { v: 1, jobId, workerKey, round, ts: Date.now() };
  claim.sig = signDetachedB64(claimMessage(jobId, workerKey, round), secretKeyB64);
  return claim;
}

/** Returns null if the claim is well-formed AND its signature verifies. */
export function validateClaim(c) {
  if (!c || typeof c !== 'object') return 'not an object';
  if (c.v !== 1) return 'unsupported claim version';
  if (typeof c.jobId !== 'string' || !/^[0-9a-f]{64}$/.test(c.jobId)) return 'malformed jobId';
  if (!isValidPubkeyB64(c.workerKey)) return 'malformed workerKey';
  if (!Number.isInteger(c.round) || c.round < 0 || c.round > 64) return 'malformed round';
  if (typeof c.sig !== 'string') return 'missing sig';
  // Signature binds the claim to a key the claimant controls (anti-grind).
  if (!verifyDetachedB64(claimMessage(c.jobId, c.workerKey, c.round), c.sig, c.workerKey)) {
    return 'bad claim signature';
  }
  return null;
}

/**
 * Deterministic winner among (already-validated) claims for one (jobId, round).
 * @returns {string|null} the winning workerKey
 */
export function claimWinner(jobId, round, claims) {
  let best = null;
  let bestRank = null;
  for (const c of claims) {
    if (c.jobId !== jobId || c.round !== round) continue;
    const rank = claimRank(jobId, c.workerKey, round);
    if (bestRank === null || rank < bestRank) {
      bestRank = rank;
      best = c.workerKey;
    }
  }
  return best;
}
