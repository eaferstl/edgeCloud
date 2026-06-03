// The claim protocol (claims log + deterministic tiebreak; see shared/claims.js
// for why this converges):
//
//   verify signature -> registry check (with re-sync grace) -> cached? ->
//   claim(round) -> settle window -> deterministic winner ->
//   winner executes & writes result | losers wait, take over at round+1
//
// Results are idempotent by jobId (documents DB keyed by _id = jobId), so the
// rare double-execution under partition collapses to one logical result.

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
import { executeJob } from './executor/run.js';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function createCoordinator({ databases, registry, peerId, maxConcurrent = 4, log = console.log }) {
  const inFlight = new Set();

  // Live scheduling state, published in each heartbeat (device schema D-A,
  // from chaodoze's registry). Unlike his placeholder, currentLoad here tracks
  // ACTUAL running executions: bumped in executeAndPublish, restored on finish.
  const live = {
    status: 'available', // "available" | "draining" | "offline"
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
      if (await getResultDoc(databases.results, jid)) {
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
      for (let round = 0; round < MAX_CLAIM_ROUNDS; round++) {
        await databases.claims.add(buildClaim(jid, peerId, round));
        await sleep(CLAIM_SETTLE_MS);
        if (await getResultDoc(databases.results, jid)) return;

        const claims = (await allEventValues(databases.claims)).filter(
          (c) => validateClaim(c) === null
        );
        const winner = claimWinner(jid, round, claims);
        if (winner === peerId) {
          log(`[job ${short}] won claim round ${round} — executing (${manifest.type}: ${manifest.label || 'unlabeled'})`);
          await executeAndPublish(env, jid, short);
          return;
        }
        log(`[job ${short}] round ${round} winner is ${winner?.slice(-8)} — standing by`);
        const deadline = Date.now() + jobTimeout + RESULT_MARGIN_MS;
        while (Date.now() < deadline) {
          await sleep(1000);
          if (await getResultDoc(databases.results, jid)) return;
        }
        log(`[job ${short}] no result from round-${round} winner; taking over (round ${round + 1})`);
      }
      log(`[job ${short}] giving up after ${MAX_CLAIM_ROUNDS} rounds`);
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
      if (await getResultDoc(databases.results, jid)) {
        log(`[job ${short}] executed but a result already replicated; discarding duplicate`);
        return;
      }
      const result = buildResult({ ...r, jobId: jid, executedBy: peerId });
      await databases.results.put({ _id: jid, ...result });
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
