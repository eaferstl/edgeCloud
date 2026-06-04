// The claim protocol (claims log + deterministic tiebreak; see shared/claims.js
// for why this converges):
//
//   verify signature -> registry check (with re-sync grace) -> cached? ->
//   claim(round) -> settle window -> deterministic winner ->
//   winner executes & writes result | losers wait, take over at round+1
//
// Results are idempotent by jobId (documents DB keyed by _id = jobId), so the
// rare double-execution under partition collapses to one logical result.
//
// TESTABILITY: the claim logic depends only on an injected { store, clock,
// executeJob } seam. In production those default to the OrbitDB databases, the
// real wall clock, and the real executor — so callers pass nothing extra. A
// deterministic simulation (worker/test/coordination-sim.test.js) injects an
// in-memory partition-aware store + virtual clock to exercise races, partitions,
// dead winners, and takeover against THIS exact code (not a reimplementation).

import { verifyEnvelope } from '@edgecloud/shared/envelope.js';
import { buildClaim, validateClaim, claimWinner } from '@edgecloud/shared/claims.js';
import { buildResult } from '@edgecloud/shared/result.js';
import { allEventValues, getResultDoc } from '@edgecloud/shared/orbit.js';
import { parseJobZipB64 } from '@edgecloud/shared/zip.js';
import {
  CLAIM_SETTLE_MS,
  RESULT_MARGIN_MS,
  MAX_CLAIM_ROUNDS,
  MAX_JOB_TIMEOUT_MS,
} from '@edgecloud/shared/constants.js';
import { executeJob as realExecuteJob } from './executor/run.js';

const realSleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Production store adapter over the OrbitDB databases. */
export function makeOrbitStore(databases) {
  return {
    addClaim: (claim) => databases.claims.add(claim),
    readClaims: () => allEventValues(databases.claims),
    getResult: (jobId) => getResultDoc(databases.results, jobId),
    putResult: (jobId, result) => databases.results.put({ _id: jobId, ...result }),
  };
}

export function createCoordinator({
  databases,
  registry,
  peerId,
  maxConcurrent = 4,
  log = console.log,
  // --- injectable seam (defaults = production) ---
  store = databases ? makeOrbitStore(databases) : null,
  clock = { now: () => Date.now(), sleep: realSleep },
  executeJob = realExecuteJob,
  timings = {},
} = {}) {
  const t = {
    claimSettleMs: timings.claimSettleMs ?? CLAIM_SETTLE_MS,
    resultMarginMs: timings.resultMarginMs ?? RESULT_MARGIN_MS,
    maxClaimRounds: timings.maxClaimRounds ?? MAX_CLAIM_ROUNDS,
    pollMs: timings.pollMs ?? 1000,
  };
  const inFlight = new Set();

  // Live scheduling state, published in each heartbeat (device schema D-A,
  // from chaodoze's registry). currentLoad tracks ACTUAL running executions.
  const live = {
    status: 'available',
    maxConcurrent,
    currentLoad: 0,
    get availableCapacity() {
      return Math.max(0, this.maxConcurrent - this.currentLoad);
    },
  };

  async function handleJob(env) {
    if (!env || typeof env.jobId !== 'string') return;
    const jid = env.jobId;
    const short = jid.slice(0, 12);
    if (inFlight.has(jid)) return;
    inFlight.add(jid);
    try {
      // 1. signature FIRST (cheap, before any payload work)
      const envErr = verifyEnvelope(env);
      if (envErr) {
        log(`[job ${short}] rejected: ${envErr}`);
        return;
      }
      // 2. registered submitter? (never reject on stale data)
      if (!(await registry.checkWithGrace(env.pubkey))) {
        log(`[job ${short}] rejected: submitter not in registry (after grace)`);
        return;
      }
      // 3. replay/cache: existing result wins
      if (await store.getResult(jid)) {
        log(`[job ${short}] already has a result; nothing to do`);
        return;
      }
      // parse now so we know the timeout for round pacing
      let manifest;
      try {
        ({ manifest } = parseJobZipB64(env.zipB64));
      } catch (e) {
        log(`[job ${short}] rejected: ${e.message}`);
        return;
      }
      const jobTimeout = Math.min(manifest.timeoutMs, MAX_JOB_TIMEOUT_MS);

      // 4. claim rounds
      for (let round = 0; round < t.maxClaimRounds; round++) {
        await store.addClaim(buildClaim(jid, peerId, round));
        await clock.sleep(t.claimSettleMs);
        if (await store.getResult(jid)) return;

        const claims = (await store.readClaims()).filter((c) => validateClaim(c) === null);
        const winner = claimWinner(jid, round, claims);
        if (winner === peerId) {
          log(`[job ${short}] won claim round ${round} — executing (${manifest.type}: ${manifest.label || 'unlabeled'})`);
          await executeAndPublish(env, jid, short);
          return;
        }
        log(`[job ${short}] round ${round} winner is ${winner?.slice(-8)} — standing by`);
        const deadline = clock.now() + jobTimeout + t.resultMarginMs;
        while (clock.now() < deadline) {
          await clock.sleep(t.pollMs);
          if (await store.getResult(jid)) return;
        }
        log(`[job ${short}] no result from round-${round} winner; taking over (round ${round + 1})`);
      }
      log(`[job ${short}] giving up after ${t.maxClaimRounds} rounds`);
    } catch (e) {
      log(`[job ${short}] error: ${e.message}`);
    } finally {
      inFlight.delete(jid);
    }
  }

  async function executeAndPublish(env, jid, short) {
    live.currentLoad++; // reflected in the next heartbeat's availableCapacity
    try {
      const r = await executeJob(env);
      // last-moment dedup: someone may have raced us
      if (await store.getResult(jid)) {
        log(`[job ${short}] executed but a result already replicated; discarding duplicate`);
        return;
      }
      const result = buildResult({ ...r, jobId: jid, executedBy: peerId });
      await store.putResult(jid, result);
      log(`[job ${short}] result published (exit ${result.exitCode}, ${result.stdout.length}B stdout)`);
    } finally {
      live.currentLoad = Math.max(0, live.currentLoad - 1);
    }
  }

  async function scanBacklog() {
    const envs = await allEventValues(databases.jobs);
    log(`[backlog] ${envs.length} job(s) in queue history`);
    for (const env of envs) handleJob(env); // intentionally unawaited: concurrent
  }

  function follow() {
    databases.jobs.events.on('update', (entry) => {
      const v = entry?.payload?.value;
      if (v) handleJob(v);
    });
  }

  return { handleJob, scanBacklog, follow, live };
}
