// Deterministic simulation of the claim protocol under races, partitions, dead
// winners, and takeover. It drives the REAL coordinator (worker/src/
// coordination.js) through its injected { store, clock, executeJob } seam — not
// a reimplementation — with:
//   - a VIRTUAL clock (no real time; we step it), so the test is fast + deterministic;
//   - a partition-aware in-memory store (workers in different partitions can't
//     see each other's claims/results until a configurable heal time);
//   - per-worker fake executors that record execution ATTEMPTS and can "die"
//     (never finish), to exercise winner death + takeover.
//
// Worker identity is now a real Ed25519 keypair (its base64 public key); claims
// and results are SIGNED with it and the coordinator only counts claims whose
// key is "registered" (here: a stub registry that approves everyone). So the
// sim threads keypairs through and ranks on the public key.
//
// Invariants asserted (see THREAT_MODEL.md §L6):
//   safety       — no partition  => exactly ONE execution; partition => bounded
//                  (<= #partitions), never an explosion.
//   liveness     — every scenario eventually produces >= 1 result (after heal).
//   determinism  — the winner is the deterministic tiebreak, run-to-run stable.
//   dedup        — once a result is visible, later/other workers don't execute.
//   takeover     — a dead round-0 winner is superseded by a later round.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createCoordinator } from '../src/coordination.js';
import { buildManifest } from '@edgecloud/shared/manifest.js';
import { buildJobZipB64 } from '@edgecloud/shared/zip.js';
import { createEnvelope } from '@edgecloud/shared/envelope.js';
import { generateKeypair } from '@edgecloud/shared/crypto.js';
import { claimRank } from '@edgecloud/shared/claims.js';
import { buildResult } from '@edgecloud/shared/result.js';

// ---- virtual clock -------------------------------------------------------
function makeVirtualClock() {
  let now = 0;
  let timers = [];
  return {
    now: () => now,
    sleep: (ms) => new Promise((resolve) => timers.push({ at: now + ms, resolve })),
    pending: () => timers.length,
    // advance to the next scheduled wakeup, firing everything due
    tick() {
      if (timers.length === 0) return false;
      const next = Math.min(...timers.map((x) => x.at));
      now = next;
      const due = timers.filter((x) => x.at <= now);
      timers = timers.filter((x) => x.at > now);
      due.forEach((x) => x.resolve());
      return true;
    },
  };
}

const microflush = () => new Promise((r) => setImmediate(r));

// Drive a set of started coordinator promises to quiescence: drain microtasks,
// advance virtual time, repeat until no timers remain (workers either finished
// or are parked on a never-resolving executor, which is not a timer).
async function drive(clock, { maxSteps = 5000 } = {}) {
  for (let i = 0; i < maxSteps; i++) {
    await microflush();
    if (clock.pending() === 0) {
      await microflush();
      if (clock.pending() === 0) break;
    }
    clock.tick();
  }
  await microflush();
}

// ---- identities ----------------------------------------------------------
// A worker's identity IS its base64 Ed25519 public key. We keep keypairs stable
// for a given test so the deterministic winner is reproducible.
function makeIdentities(n) {
  return Array.from({ length: n }, () => generateKeypair());
}
const idOf = (kp) => kp.publicKey;

// ---- partition-aware in-memory store -------------------------------------
function makeSimNetwork(clock, { partitionOf = () => 0, healAt = Infinity } = {}) {
  const claims = []; // { claim, group, t }
  const results = []; // { jobId, result, group, t }
  const visible = (entryGroup, observerGroup) =>
    entryGroup === observerGroup || clock.now() >= healAt;

  function storeFor(workerKey) {
    const group = partitionOf(workerKey);
    return {
      addClaim: (claim) => {
        claims.push({ claim, group, t: clock.now() });
        return Promise.resolve();
      },
      readClaims: () =>
        Promise.resolve(claims.filter((e) => visible(e.group, group)).map((e) => e.claim)),
      getResult: (jobId) => {
        // results is a documents DB keyed by jobId (last write wins), so return
        // the most-recent visible entry — not the first — for this jobId.
        const vis = results.filter((e) => e.jobId === jobId && visible(e.group, group));
        return Promise.resolve(vis.length ? vis[vis.length - 1].result : null);
      },
      putResult: (jobId, result) => {
        results.push({ jobId, result, group, t: clock.now() });
        return Promise.resolve();
      },
    };
  }
  return { storeFor, claims, results };
}

// per-worker executor: records the attempt (by public key), then either returns
// a result or (for a "dead" key) never resolves — modeling a worker that started
// the job then crashed mid-execution.
function executorFor(workerKey, attempts, deadKeys, clock) {
  return () => {
    attempts.push(workerKey);
    if (deadKeys.has(workerKey)) return new Promise(() => {}); // never resolves
    return Promise.resolve({ stdout: 'ok', stderr: '', exitCode: 0, error: null, startedAt: clock.now() });
  };
}

// Stub registry: signatures are still checked by the coordinator; here every
// (validly-signed) key counts as registered.
const ALWAYS_REGISTERED = { checkWithGrace: async () => true, isVerified: () => true };
const SIM_TIMINGS = { claimSettleMs: 100, resultMarginMs: 200, maxClaimRounds: 6, pollMs: 50 };

// Build one real, valid, signed envelope (so verifyEnvelope + parseJobZipB64
// pass) with a small manifest timeout to keep the virtual poll loop short.
function makeEnvelope() {
  const kp = generateKeypair();
  const manifest = buildManifest({ type: 'js', label: 'sim', timeoutMs: 200 });
  const zipB64 = buildJobZipB64(manifest, 'console.log(1)');
  return createEnvelope({ zipB64, publicKeyB64: kp.publicKey, secretKeyB64: kp.secretKey });
}

function makeWorkers(keypairs, { net, clock, attempts, deadKeys = new Set(), registry = ALWAYS_REGISTERED }) {
  return keypairs.map((kp) =>
    createCoordinator({
      workerKey: kp.publicKey,
      workerSecretKey: kp.secretKey,
      registry,
      log: () => {},
      store: net.storeFor(kp.publicKey),
      clock,
      executeJob: executorFor(kp.publicKey, attempts, deadKeys, clock),
      timings: SIM_TIMINGS,
    })
  );
}

// expected deterministic winner (a public key) among a key set for (jobId, round)
function expectedWinner(jobId, keys, round = 0) {
  return [...keys].sort((a, b) => (claimRank(jobId, a, round) < claimRank(jobId, b, round) ? -1 : 1))[0];
}

// ==========================================================================

test('sim: no partition → exactly one execution, deterministic winner', async () => {
  const clock = makeVirtualClock();
  const net = makeSimNetwork(clock);
  const attempts = [];
  const peers = makeIdentities(4);
  const keys = peers.map(idOf);
  const env = makeEnvelope();
  const workers = makeWorkers(peers, { net, clock, attempts });

  workers.forEach((w) => w.handleJob(env));
  await drive(clock);

  assert.equal(attempts.length, 1, `exactly one execution, got ${attempts.length}`);
  assert.equal(attempts[0], expectedWinner(env.jobId, keys), 'the deterministic tiebreak winner executed');
  assert.equal(net.results.filter((r) => r.jobId === env.jobId).length, 1, 'exactly one result');
});

test('sim: winner is run-to-run deterministic', async () => {
  const peers = makeIdentities(5); // stable identities across all runs
  const keys = peers.map(idOf);
  const env = makeEnvelope();
  const winners = new Set();
  for (let i = 0; i < 5; i++) {
    const clock = makeVirtualClock();
    const net = makeSimNetwork(clock);
    const attempts = [];
    // rotate worker start order each run — must not change the winner
    const order = peers.map((_, j) => peers[(j + i) % peers.length]);
    makeWorkers(order, { net, clock, attempts }).forEach((w) => w.handleJob(env));
    await drive(clock);
    assert.equal(attempts.length, 1);
    winners.add(attempts[0]);
  }
  assert.equal(winners.size, 1, 'same winner every run');
  assert.equal([...winners][0], expectedWinner(env.jobId, keys));
});

test('sim: cached result already present → nobody executes (dedup)', async () => {
  const clock = makeVirtualClock();
  const net = makeSimNetwork(clock);
  const attempts = [];
  const env = makeEnvelope();
  // seed a VALID, SIGNED result before any worker starts (an unsigned one would
  // be ignored as a forgery and the workers would execute)
  const seedKp = generateKeypair();
  const seeded = buildResult({
    jobId: env.jobId, stdout: 'cached', stderr: '', exitCode: 0,
    executedBy: seedKp.publicKey, startedAt: 0, secretKeyB64: seedKp.secretKey,
  });
  net.results.push({ jobId: env.jobId, result: seeded, group: 0, t: 0 });

  makeWorkers(makeIdentities(3), { net, clock, attempts }).forEach((w) => w.handleJob(env));
  await drive(clock);

  assert.equal(attempts.length, 0, 'no execution when a result already exists');
});

test('sim: forged (unsigned) result is ignored → workers still execute', async () => {
  const clock = makeVirtualClock();
  const net = makeSimNetwork(clock);
  const attempts = [];
  const env = makeEnvelope();
  // a third party drops a shape-valid but UNSIGNED result for the job
  net.results.push({
    jobId: env.jobId,
    result: { v: 1, jobId: env.jobId, stdout: 'forged', stderr: '', executedBy: 'attacker' },
    group: 0,
    t: 0,
  });

  makeWorkers(makeIdentities(3), { net, clock, attempts }).forEach((w) => w.handleJob(env));
  await drive(clock);

  assert.equal(attempts.length, 1, 'a forged result does not suppress honest execution');
  // and the published result IS validly signed
  const real = net.results.filter((r) => r.jobId === env.jobId && r.result.sig);
  assert.ok(real.length >= 1, 'an honest, signed result was produced');
});

test('sim: dead round-0 winner → a later round takes over (liveness)', async () => {
  const clock = makeVirtualClock();
  const net = makeSimNetwork(clock);
  const attempts = [];
  const peers = makeIdentities(4);
  const keys = peers.map(idOf);
  const env = makeEnvelope();
  const winner0 = expectedWinner(env.jobId, keys, 0);
  const deadKeys = new Set([winner0]); // the round-0 winner crashes mid-execution

  makeWorkers(peers, { net, clock, attempts, deadKeys }).forEach((w) => w.handleJob(env));
  await drive(clock);

  // the dead winner attempted (then hung); a DIFFERENT, live peer published a result
  assert.ok(attempts.includes(winner0), 'round-0 winner attempted before dying');
  const published = net.results.filter((r) => r.jobId === env.jobId);
  assert.ok(published.length >= 1, 'liveness: a result was produced despite the dead winner');
  const publisher = attempts.find((p) => !deadKeys.has(p));
  assert.ok(publisher, 'a live peer took over and executed');
  // bounded: the dead attempt + the takeover, not an explosion
  assert.ok(attempts.length <= peers.length, `bounded executions (${attempts.length} <= ${peers.length})`);
});

test('sim: network partition → bounded duplicate execution, converges after heal', async () => {
  const clock = makeVirtualClock();
  const peers = makeIdentities(4);
  const [a1, a2, b1, b2] = peers.map(idOf);
  // two partitions that can't see each other until t=10_000; each has 2 workers
  const group = new Map([[a1, 0], [a2, 0], [b1, 1], [b2, 1]]);
  const net = makeSimNetwork(clock, { partitionOf: (k) => group.get(k), healAt: 10000 });
  const attempts = [];
  const env = makeEnvelope();

  makeWorkers(peers, { net, clock, attempts }).forEach((w) => w.handleJob(env));
  await drive(clock);

  // SAFETY: each partition elects ONE winner → at most #partitions executions,
  // never unbounded. (This is the CAP trade-off, made harmless by jobId dedupe.)
  assert.ok(attempts.length >= 1 && attempts.length <= 2, `bounded by partitions, got ${attempts.length}`);
  const groupAcand = [a1, a2];
  const groupBcand = [b1, b2];
  const inA = attempts.filter((p) => groupAcand.includes(p));
  const inB = attempts.filter((p) => groupBcand.includes(p));
  assert.ok(inA.length <= 1 && inB.length <= 1, 'at most one execution per partition');
  if (inA.length) assert.equal(inA[0], expectedWinner(env.jobId, groupAcand));
  if (inB.length) assert.equal(inB[0], expectedWinner(env.jobId, groupBcand));
  // LIVENESS: a result exists, and it is for the right job
  const published = net.results.filter((r) => r.jobId === env.jobId);
  assert.ok(published.length >= 1, 'a result was produced');
});

test('sim: partition where one side is dead → other side still serves it post-heal', async () => {
  const clock = makeVirtualClock();
  const [live1, live2, deadOnly] = makeIdentities(3);
  const group = new Map([[idOf(live1), 0], [idOf(live2), 0], [idOf(deadOnly), 1]]);
  const net = makeSimNetwork(clock, { partitionOf: (k) => group.get(k), healAt: 8000 });
  const attempts = [];
  const env = makeEnvelope();
  // partition B has a single worker that dies; partition A is healthy
  const deadKeys = new Set([idOf(deadOnly)]);

  makeWorkers([live1, live2, deadOnly], { net, clock, attempts, deadKeys }).forEach((w) => w.handleJob(env));
  await drive(clock);

  const published = net.results.filter((r) => r.jobId === env.jobId);
  assert.ok(published.length >= 1, 'the healthy partition produced a result');
  assert.ok(
    published.every((r) => r.group === 0),
    'the result came from the live partition (the dead partition produced none)'
  );
});

test('sim: backlog rescans are cheap — grace paid once, settled jobs skipped', async () => {
  const clock = makeVirtualClock();
  const net = makeSimNetwork(clock);
  const attempts = [];
  const [kp] = makeIdentities(1);
  const env = makeEnvelope();

  // Registry stub: the submitter starts unregistered; count the grace checks
  // (each one is a multi-second wait in production).
  let graceCalls = 0;
  let registered = false;
  const registry = {
    checkWithGrace: async () => {
      graceCalls++;
      return registered;
    },
    isVerified: () => registered,
  };

  // Store wrapper counting results-DB reads.
  const inner = net.storeFor(kp.publicKey);
  let resultReads = 0;
  const store = {
    ...inner,
    getResult: (jid) => {
      resultReads++;
      return inner.getResult(jid);
    },
  };

  const w = createCoordinator({
    workerKey: kp.publicKey,
    workerSecretKey: kp.secretKey,
    registry,
    log: () => {},
    store,
    clock,
    executeJob: executorFor(kp.publicKey, attempts, new Set(), clock),
    timings: SIM_TIMINGS,
  });

  // 1. Unregistered submitter: the grace wait is paid exactly once; rescans of
  //    the same envelope are skipped via the rejectedSubmitters cache.
  w.handleJob(env);
  await drive(clock);
  w.handleJob(env);
  await drive(clock);
  w.handleJob(env);
  await drive(clock);
  assert.equal(graceCalls, 1, 'grace wait paid once, not per rescan');
  assert.equal(attempts.length, 0, 'job from unregistered submitter never executes');

  // 2. The submitter registers later: the next rescan notices (cheap isVerified
  //    re-check), clears the cache, and the job executes normally.
  registered = true;
  w.handleJob(env);
  await drive(clock);
  assert.equal(attempts.length, 1, 'late registration is picked up by a rescan');

  // 3. The job is now settled: further rescans return before even reading the
  //    results DB.
  const readsAfterExec = resultReads;
  w.handleJob(env);
  await drive(clock);
  w.handleJob(env);
  await drive(clock);
  assert.equal(resultReads, readsAfterExec, 'settled job: no further results reads');
  assert.equal(attempts.length, 1, 'settled job: never re-executed');
});
