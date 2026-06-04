// The claim protocol (signed claims log + deterministic tiebreak; see
// shared/src/claims.js for why this converges and why claims are signed):
//
//   verify signature -> registry check (with re-sync grace) -> cached? ->
//   SIGNED claim(round) -> settle window -> deterministic winner among
//   REGISTERED, validly-signed claimants -> winner executes & SIGNS result |
//   losers wait, take over at round+1
//
// Worker identity is a registered Ed25519 key (its base64 public key); claims
// and results are signed with it. Two workers seeing the same valid claim set
// agree on the winner. Results are idempotent by jobId, so a rare double-
// execution under partition collapses to one logical result.
//
// Anti-grind (THREAT_MODEL.md R-010): the winner = min sha256(jobId|workerKey|
// round) over claims that (a) carry a valid SIGNATURE by `workerKey` and (b)
// whose `workerKey` is a REGISTERED, allowlisted worker. So an attacker can't
// claim with arbitrary/grindable strings — they must own a registered key, and
// registration is bounded by the attendee allowlist (≤4 keys/email).
//
// TESTABILITY: depends only on an injected { store, clock, executeJob } seam;
// production defaults to OrbitDB + wall clock + the real executor.

import { verifyEnvelope } from '@edgecloud/shared/envelope.js';
import { buildClaim, validateClaim } from '@edgecloud/shared/claims.js';
import { electWinner } from '@edgecloud/shared/election.js';
import { meetsRequirements } from '@edgecloud/shared/capability.js';
import { buildResult, verifyResult } from '@edgecloud/shared/result.js';
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
  workerKey, // base64 Ed25519 public key — this worker's registered identity
  workerSecretKey, // base64 secret key for signing claims + results
  capabilities = { cores: 1, ramBytes: 0, gpu: false }, // what this worker can run
  getRtt = () => null, // this worker's measured latency to the rendezvous (ms), or null
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
  // Jobs this process has already executed AND published a result for. `inFlight`
  // only guards a *concurrently* running job (it's cleared in finally), so the
  // periodic scanBacklog could otherwise re-execute a job if a transient OrbitDB
  // read (CBOR/sync latency) makes validResult momentarily return null and the
  // worker re-wins round 0 uncontested. This set makes "already done here" sticky.
  const published = new Set();

  const live = {
    status: 'available',
    maxConcurrent,
    currentLoad: 0,
    get availableCapacity() {
      return Math.max(0, this.maxConcurrent - this.currentLoad);
    },
  };

  // A result only "exists" if it's present AND validly signed by its executor —
  // so a forged (bad-sig) result can't make an honest worker skip execution.
  // Short-circuit on jobs we ourselves already published, so a transient read
  // failure can't trigger a duplicate execution.
  async function validResult(jobId) {
    if (published.has(jobId)) return true;
    const r = await store.getResult(jobId);
    if (!r) return null;
    if (verifyResult(r) === null) return r;
    return null; // present but unsigned/forged → ignore, keep executing
  }

  // Accept a claim only if it is well-formed + signed by workerKey AND that
  // workerKey is a registered, allowlisted worker.
  function acceptedClaims(rawClaims) {
    return rawClaims.filter((c) => validateClaim(c) === null && registry.isVerified(c.workerKey));
  }

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
      // 3. replay/cache: an existing, validly-signed result wins
      if (await validResult(jid)) {
        log(`[job ${short}] already has a result; nothing to do`);
        return;
      }
      let manifest;
      try {
        ({ manifest } = parseJobZipB64(env.zipB64));
      } catch (e) {
        log(`[job ${short}] rejected: ${e.message}`);
        return;
      }
      // 4. capability gate — only claim jobs this worker can actually run, so
      // incapable workers self-exclude from the election (e.g. inference jobs go
      // only to GPU workers; minCores/minRAM are respected). Decentralized: no
      // scheduler decides, each worker just doesn't claim what it can't do.
      if (!meetsRequirements(manifest, capabilities)) {
        log(`[job ${short}] not claiming — lacks capability for ${manifest.type}${manifest.minCores ? ` (needs ${manifest.minCores} cores)` : ''}`);
        return;
      }
      const jobTimeout = Math.min(manifest.timeoutMs, MAX_JOB_TIMEOUT_MS);

      // 5. claim rounds
      for (let round = 0; round < t.maxClaimRounds; round++) {
        const claim = buildClaim(jid, workerKey, round, workerSecretKey);
        const myRtt = getRtt();
        if (typeof myRtt === 'number') claim.rtt = myRtt; // advisory (unsigned): our proximity to the rendezvous
        await store.addClaim(claim);
        await clock.sleep(t.claimSettleMs);
        if (await validResult(jid)) return;

        const claims = acceptedClaims(await store.readClaims());
        // Pluggable election (proximity + capability; capability already filtered
        // at claim time). Each claimant's rtt comes from its own claim, so all
        // workers see the same data and agree on the winner.
        const rttByKey = new Map();
        for (const c of claims) {
          if (c.jobId === jid && c.round === round && typeof c.rtt === 'number') rttByKey.set(c.workerKey, c.rtt);
        }
        const winner = electWinner(jid, round, claims, { rttOf: (k) => (rttByKey.has(k) ? rttByKey.get(k) : null) });
        if (winner === workerKey) {
          log(`[job ${short}] won claim round ${round} — executing (${manifest.type}: ${manifest.label || 'unlabeled'})`);
          await executeAndPublish(env, jid, short);
          return;
        }
        log(`[job ${short}] round ${round} winner is ${winner?.slice(0, 8)}… — standing by`);
        const deadline = clock.now() + jobTimeout + t.resultMarginMs;
        while (clock.now() < deadline) {
          await clock.sleep(t.pollMs);
          if (await validResult(jid)) return;
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
    live.currentLoad++;
    try {
      const r = await executeJob(env);
      if (await validResult(jid)) {
        log(`[job ${short}] executed but a result already replicated; discarding duplicate`);
        return;
      }
      // result is SIGNED by this worker's identity key (executedBy = workerKey)
      const result = buildResult({ ...r, jobId: jid, executedBy: workerKey, secretKeyB64: workerSecretKey });
      await store.putResult(jid, result);
      published.add(jid); // sticky: never re-execute this job in this process
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
