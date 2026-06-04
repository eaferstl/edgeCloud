// Pluggable election + capability matching + inference manifest.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { minHashElection, proximityCapabilityElection, electWinner, ACTIVE_ELECTION } from '../src/election.js';
import { meetsRequirements } from '../src/capability.js';
import { buildManifest, validateManifest } from '../src/manifest.js';
import { buildJobZipB64, parseJobZipB64 } from '../src/zip.js';
import { sha256Hex } from '../src/crypto.js';

const JID = 'ab'.repeat(32);
const claimsFor = (keys, round = 0, jobId = JID) => keys.map((k) => ({ jobId, workerKey: k, round }));
const hashWinner = (keys, round = 0, jobId = JID) =>
  [...keys].sort((a, b) => (sha256Hex(`${jobId}|${a}|${round}`) < sha256Hex(`${jobId}|${b}|${round}`) ? -1 : 1))[0];

test('minHashElection: deterministic, order-independent, round-scoped', () => {
  const keys = ['kA', 'kB', 'kC', 'kD'];
  const w = minHashElection(JID, 0, claimsFor(keys));
  assert.equal(w, minHashElection(JID, 0, claimsFor([...keys].reverse())));
  assert.equal(w, hashWinner(keys));
  assert.equal(minHashElection(JID, 1, claimsFor(keys)), null); // claims are all round 0
});

test('proximityCapability: no rtt → reduces to the hash tiebreak (deterministic)', () => {
  const keys = ['kA', 'kB', 'kC'];
  assert.equal(proximityCapabilityElection(JID, 0, claimsFor(keys)), hashWinner(keys));
  // unknown rtts also fall back to hash
  assert.equal(proximityCapabilityElection(JID, 0, claimsFor(keys), { rttOf: () => null }), hashWinner(keys));
});

test('proximityCapability: prefers the lowest-latency claimant, hash breaks ties', () => {
  const keys = ['kA', 'kB', 'kC'];
  const rtt = { kA: 50, kB: 12, kC: 80 };
  assert.equal(proximityCapabilityElection(JID, 0, claimsFor(keys), { rttOf: (k) => rtt[k] }), 'kB');
  // a tie on rtt → deterministic hash decides
  assert.equal(
    proximityCapabilityElection(JID, 0, claimsFor(keys), { rttOf: () => 10 }),
    hashWinner(keys)
  );
});

test('electWinner uses the active (proximity-capability) strategy', () => {
  assert.equal(ACTIVE_ELECTION, 'proximity-capability');
  const keys = ['kA', 'kB', 'kC'];
  assert.equal(electWinner(JID, 0, claimsFor(keys)), proximityCapabilityElection(JID, 0, claimsFor(keys)));
});

test('meetsRequirements: inference needs a GPU; minCores/minRamBytes enforced', () => {
  const gpu = { cores: 4, ramBytes: 8e9, gpu: true };
  const cpu = { cores: 4, ramBytes: 8e9, gpu: false };
  assert.equal(meetsRequirements({ type: 'inference' }, gpu), true);
  assert.equal(meetsRequirements({ type: 'inference' }, cpu), false); // no GPU
  assert.equal(meetsRequirements({ type: 'js' }, cpu), true);
  assert.equal(meetsRequirements({ type: 'js', minCores: 8 }, cpu), false);
  assert.equal(meetsRequirements({ type: 'js', minCores: 4 }, cpu), true);
  assert.equal(meetsRequirements({ type: 'wasm', minRamBytes: 16e9 }, cpu), false);
  assert.equal(meetsRequirements({ type: 'wasm', minRamBytes: 4e9 }, cpu), true);
});

test('inference manifest builds, validates, and round-trips through the zip', () => {
  const m = buildManifest({ type: 'inference', label: 'ask', model: 'lfm2.5-8b-a1b', minCores: 2 });
  assert.equal(validateManifest(m), null);
  assert.equal(m.type, 'inference');
  assert.equal(m.entry, 'prompt.txt');
  assert.equal(m.model, 'lfm2.5-8b-a1b');
  assert.equal(m.minCores, 2);
  const zip = buildJobZipB64(m, 'What is the capital of France?');
  const { manifest, entryName, entryBytes } = parseJobZipB64(zip);
  assert.equal(entryName, 'prompt.txt');
  assert.equal(Buffer.from(entryBytes).toString('utf8'), 'What is the capital of France?');
  assert.equal(manifest.type, 'inference');
});

test('manifest validation: model only on inference, sane capability fields', () => {
  assert.equal(validateManifest({ v: 1, type: 'inference', entry: 'prompt.txt', args: [], timeoutMs: 1000, label: '' }), null);
  assert.ok(validateManifest({ v: 1, type: 'js', entry: 'main.js', args: [], timeoutMs: 1000, label: '', model: 'x' })); // model on js → error
  assert.ok(validateManifest({ v: 1, type: 'inference', entry: 'prompt.txt', args: [], timeoutMs: 1000, label: '', minCores: -1 })); // bad minCores
});
