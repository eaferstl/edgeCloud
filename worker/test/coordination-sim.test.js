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

// ---- partition-aware in-memory store -------------------------------------
function makeSimNetwork(clock, { partitionOf = () => 0, healAt = Infinity } = {}) {
  const claims = []; // { claim, group, t }
  const results = []; // { jobId, result, group, t }
  const visible = (entryGroup, observerGroup) =>
    entryGroup === observerGroup || clock.now() >= healAt;

  function storeFor(peerId) {
    const group = partitionOf(peerId);
    return {
      addClaim: (claim) => {
        claims.push({ claim, group, t: clock.now() });
        return Promise.resolve();
      },
      readClaims: () =>
        Promise.resolve(claims.filter((e) => visible(e.group, group)).map((e) => e.claim)),
      getResult: (jobId) => {
        const vis = results.filter((e) => e.jobId === jobId && visible(e.group, group));
        return Promise.resolve(vis.length ? vis[0].result : null);
      },
      putResult: (jobId, result) => {
        results.push({ jobId, result, group, t: clock.now() });
        return Promise.resolve();
      },
    };
  }
  return { storeFor, claims, results };
}

// per-worker executor: records the attempt, then either returns a result or
// (for a "dead" peer) never resolves — modeling a worker that started the job
// then crashed mid-execution.
function executorFor(peerId, attempts, deadPeers, clock) {
  return () => {
    attempts.push(peerId);
    if (deadPeers.has(peerId)) return new Promise(() => {}); // never resolves
    return Promise.resolve({ stdout: 'ok', stderr: '', exitCode: 0, error: null, startedAt: clock.now() });
  };
}

const ALWAYS_REGISTERED = { checkWithGrace: async () => true };
const SIM_TIMINGS = { claimSettleMs: 100, resultMarginMs: 200, maxClaimRounds: 6, pollMs: 50 };

// Build one real, valid, signed envelope (so verifyEnvelope + parseJobZipB64
// pass) with a small manifest timeout to keep the virtual poll loop short.
function makeEnvelope() {
  const kp = generateKeypair();
  const manifest = buildManifest({ type: 'js', label: 'sim', timeoutMs: 200 });
  const zipB64 = buildJobZipB64(manifest, 'console.log(1)');
  return createEnvelope({ zipB64, publicKeyB64: kp.publicKey, secretKeyB64: kp.secretKey });
}

function makeWorkers(peerIds, { net, clock, attempts, deadPeers = new Set(), registry = ALWAYS_REGISTERED }) {
  return peerIds.map((peerId) =>
    createCoordinator({
      peerId,
      registry,
      log: () => {},
      store: net.storeFor(peerId),
      clock,
      executeJob: executorFor(peerId, attempts, deadPeers, clock),
      timings: SIM_TIMINGS,
    })
  );
}

// expected deterministic winner among a peer set for a (jobId, round)
function expectedWinner(jobId, peerIds, round = 0) {
  return [...peerIds].sort((a, b) => (claimRank(jobId, a, round) < claimRank(jobId, b, round) ? -1 : 1))[0];
}

// ==========================================================================

test('sim: no partition → exactly one execution, deterministic winner', async () => {
  const clock = makeVirtualClock();
  const net = makeSimNetwork(clock);
  const attempts = [];
  const peers = ['peerA', 'peerB', 'peerC', 'peerD'];
  const env = makeEnvelope();
  const workers = makeWorkers(peers, { net, clock, attempts });

  workers.forEach((w) => w.handleJob(env));
  await drive(clock);

  assert.equal(attempts.length, 1, `exactly one execution, got ${attempts.length}`);
  assert.equal(attempts[0], expectedWinner(env.jobId, peers), 'the deterministic tiebreak winner executed');
  assert.equal(net.results.filter((r) => r.jobId === env.jobId).length, 1, 'exactly one result');
});

test('sim: winner is run-to-run deterministic', async () => {
  const peers = ['n1', 'n2', 'n3', 'n4', 'n5'];
  const env = makeEnvelope();
  const winners = new Set();
  for (let i = 0; i < 5; i++) {
    const clock = makeVirtualClock();
    const net = makeSimNetwork(clock);
    const attempts = [];
    // shuffle worker start order each run — must not change the winner
    const order = [...peers].sort(() => (claimRank(env.jobId, 'x' + i, i) < claimRank(env.jobId, 'y', 0) ? 1 : -1));
    makeWorkers(order, { net, clock, attempts }).forEach((w) => w.handleJob(env));
    await drive(clock);
    assert.equal(attempts.length, 1);
    winners.add(attempts[0]);
  }
  assert.equal(winners.size, 1, 'same winner every run');
  assert.equal([...winners][0], expectedWinner(env.jobId, peers));
});

test('sim: cached result already present → nobody executes (dedup)', async () => {
  const clock = makeVirtualClock();
  const net = makeSimNetwork(clock);
  const attempts = [];
  const env = makeEnvelope();
  // seed a result before any worker starts
  net.results.push({ jobId: env.jobId, result: { v: 1, jobId: env.jobId, ok: true }, group: 0, t: 0 });

  makeWorkers(['a', 'b', 'c'], { net, clock, attempts }).forEach((w) => w.handleJob(env));
  await drive(clock);

  assert.equal(attempts.length, 0, 'no execution when a result already exists');
});

test('sim: dead round-0 winner → a later round takes over (liveness)', async () => {
  const clock = makeVirtualClock();
  const net = makeSimNetwork(clock);
  const attempts = [];
  const peers = ['p1', 'p2', 'p3', 'p4'];
  const env = makeEnvelope();
  const winner0 = expectedWinner(env.jobId, peers, 0);
  const deadPeers = new Set([winner0]); // the round-0 winner crashes mid-execution

  makeWorkers(peers, { net, clock, attempts, deadPeers }).forEach((w) => w.handleJob(env));
  await drive(clock);

  // the dead winner attempted (then hung); a DIFFERENT, live peer published a result
  assert.ok(attempts.includes(winner0), 'round-0 winner attempted before dying');
  const published = net.results.filter((r) => r.jobId === env.jobId);
  assert.ok(published.length >= 1, 'liveness: a result was produced despite the dead winner');
  const publisher = attempts.find((p) => !deadPeers.has(p));
  assert.ok(publisher, 'a live peer took over and executed');
  // bounded: the dead attempt + the takeover, not an explosion
  assert.ok(attempts.length <= peers.length, `bounded executions (${attempts.length} <= ${peers.length})`);
});

test('sim: network partition → bounded duplicate execution, converges after heal', async () => {
  const clock = makeVirtualClock();
  // two partitions that can't see each other until t=10_000; each has 2 workers
  const groups = { gA1: 0, gA2: 0, gB1: 1, gB2: 1 };
  const net = makeSimNetwork(clock, { partitionOf: (p) => groups[p], healAt: 10000 });
  const attempts = [];
  const peers = Object.keys(groups);
  const env = makeEnvelope();

  makeWorkers(peers, { net, clock, attempts }).forEach((w) => w.handleJob(env));
  await drive(clock);

  // SAFETY: each partition elects ONE winner → at most #partitions executions,
  // never unbounded. (This is the CAP trade-off, made harmless by jobId dedupe.)
  assert.ok(attempts.length >= 1 && attempts.length <= 2, `bounded by partitions, got ${attempts.length}`);
  // each partition that executed used its own deterministic winner
  const groupAcand = ['gA1', 'gA2'];
  const groupBcand = ['gB1', 'gB2'];
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
  const groups = { live1: 0, live2: 0, deadOnly: 1 };
  const net = makeSimNetwork(clock, { partitionOf: (p) => groups[p], healAt: 8000 });
  const attempts = [];
  const env = makeEnvelope();
  // partition B has a single worker that dies; partition A is healthy
  const deadPeers = new Set(['deadOnly']);

  makeWorkers(Object.keys(groups), { net, clock, attempts, deadPeers }).forEach((w) => w.handleJob(env));
  await drive(clock);

  const published = net.results.filter((r) => r.jobId === env.jobId);
  assert.ok(published.length >= 1, 'the healthy partition produced a result');
  assert.ok(
    published.every((r) => r.group === 0),
    'the result came from the live partition (the dead partition produced none)'
  );
});
