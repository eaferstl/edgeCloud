// Pluggable leader election for the claim protocol.
//
// Capability filtering happens BEFORE this (a worker that can't satisfy a job
// never claims it — see capability.js), so every claimant reaching the election
// is already capable; the election only RANKS the capable claimants.
//
// Each strategy is a pure, order-independent function of (jobId, round, claims,
// ctx) so every worker that sees the same claim set agrees on the winner. Swap
// the active method by changing ACTIVE_ELECTION; the indirection makes it
// pluggable without touching the coordinator.

import { sha256Hex } from './crypto.js';

function rank(jobId, workerKey, round) {
  return sha256Hex(`${jobId}|${workerKey}|${round}`);
}

/** v1 method: lowest sha256(jobId|workerKey|round) — deterministic tiebreak. */
export function minHashElection(jobId, round, claims) {
  let best = null;
  let bestRank = null;
  for (const c of claims) {
    if (c.jobId !== jobId || c.round !== round) continue;
    const r = rank(jobId, c.workerKey, round);
    if (bestRank === null || r < bestRank) {
      bestRank = r;
      best = c.workerKey;
    }
  }
  return best;
}

/**
 * Proximity + capability method (capability already filtered at claim time):
 * prefer the CLOSEST capable worker — the lowest latency to the rendezvous —
 * with the deterministic hash as the tiebreak. Latency comes from
 * `ctx.rttOf(workerKey)` (ms, or null when unknown). Until latency is measured
 * every claim is "unknown", so this reduces to the hash tiebreak and stays fully
 * deterministic — the proximity ordering simply lights up once rtt is reported.
 */
export function proximityCapabilityElection(jobId, round, claims, ctx) {
  const rttOf = ctx && typeof ctx.rttOf === 'function' ? ctx.rttOf : () => null;
  let best = null;
  let bestRtt = Infinity;
  let bestRank = null;
  for (const c of claims) {
    if (c.jobId !== jobId || c.round !== round) continue;
    const raw = rttOf(c.workerKey);
    const rtt = typeof raw === 'number' && raw >= 0 ? raw : Infinity;
    const r = rank(jobId, c.workerKey, round);
    if (best === null || rtt < bestRtt || (rtt === bestRtt && r < bestRank)) {
      best = c.workerKey;
      bestRtt = rtt;
      bestRank = r;
    }
  }
  return best;
}

export const ELECTION_STRATEGIES = {
  'min-hash': minHashElection,
  'proximity-capability': proximityCapabilityElection,
};

// The active election method (hardcoded; swap here to change network-wide).
export const ACTIVE_ELECTION = 'proximity-capability';

export function getElection(name) {
  return ELECTION_STRATEGIES[name] || minHashElection;
}

/** Elect the winning workerKey for (jobId, round) among the given claims. */
export function electWinner(jobId, round, claims, ctx) {
  return getElection(ACTIVE_ELECTION)(jobId, round, claims, ctx);
}
