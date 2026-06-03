// Claim protocol helpers (claims log + deterministic tiebreak).
//
// Every worker that sees a job appends a claim {jobId, peerId, round} to the
// open-write edgecloud-claims events DB, waits CLAIM_SETTLE_MS for replication,
// then computes the winner deterministically over the claims it can see.
// The tiebreak is order-independent: lowest sha256(jobId|peerId|round) wins,
// so any two workers seeing the same claim set agree on the winner without
// any further coordination. If the winner dies, survivors re-claim at
// round + 1 after a timeout. Rare double-execution (e.g. under partition) is
// tolerated: the results DB is keyed by jobId, so duplicates collapse.

import { sha256Hex } from './crypto.js';

export function claimRank(jobId, peerId, round) {
  return sha256Hex(`${jobId}|${peerId}|${round}`);
}

export function buildClaim(jobId, peerId, round) {
  return { v: 1, jobId, peerId, round, ts: Date.now() };
}

export function validateClaim(c) {
  if (!c || typeof c !== 'object') return 'not an object';
  if (c.v !== 1) return 'unsupported claim version';
  if (typeof c.jobId !== 'string' || !/^[0-9a-f]{64}$/.test(c.jobId)) return 'malformed jobId';
  if (typeof c.peerId !== 'string' || c.peerId.length === 0 || c.peerId.length > 128) return 'malformed peerId';
  if (!Number.isInteger(c.round) || c.round < 0 || c.round > 64) return 'malformed round';
  return null;
}

/**
 * Deterministic winner among claims for one (jobId, round).
 * @param {Array<{jobId:string,peerId:string,round:number}>} claims
 * @returns {string|null} winning peerId
 */
export function claimWinner(jobId, round, claims) {
  let best = null;
  let bestRank = null;
  for (const c of claims) {
    if (c.jobId !== jobId || c.round !== round) continue;
    const rank = claimRank(jobId, c.peerId, round);
    if (bestRank === null || rank < bestRank) {
      bestRank = rank;
      best = c.peerId;
    }
  }
  return best;
}
