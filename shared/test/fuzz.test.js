// Property / fuzz tests for the pure logic that the distributed protocol leans
// on. Uses a tiny seeded PRNG (no new deps) so failures are reproducible:
// every test loops over fixed seeds, and a failing seed is printed.
//
// Strategy per Codex review: fuzz the load-bearing pure functions, assert the
// invariants the coordinator/server actually depend on. We do NOT fuzz crypto
// primitives, fflate internals, or base64 — that tests other people's code.

import { test } from 'node:test';
import assert from 'node:assert/strict';

import { claimWinner, validateClaim, buildClaim, claimRank } from '../src/claims.js';
import { canonicalJson } from '../src/canonical.js';
import { buildManifest } from '../src/manifest.js';
import { buildJobZipB64, parseJobZipB64 } from '../src/zip.js';
import { createEnvelope, verifyEnvelope, jobIdOf } from '../src/envelope.js';
import { generateKeypair, sha256Hex, hmacSha256Hex, fromB64, toB64 } from '../src/crypto.js';
import {
  createAttestation,
  verifyAttestation,
  createEndorsement,
  computeTrustedServers,
} from '../src/trust.js';

// --- tiny seeded PRNG (mulberry32) ---------------------------------------
function rng(seed) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
const SEEDS = [1, 2, 3, 7, 42, 99, 1234, 0xdead, 0xbeef, 2026];
const pick = (r, arr) => arr[Math.floor(r() * arr.length)];
const randHex = (r, n) => Array.from({ length: n }, () => '0123456789abcdef'[Math.floor(r() * 16)]).join('');
const randStr = (r, n) => Array.from({ length: n }, () => String.fromCharCode(32 + Math.floor(r() * 94))).join('');
function shuffle(r, arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

// ========================================================================
// claimWinner — the heart of the exactly-once protocol
// ========================================================================
test('fuzz: claimWinner is permutation-invariant and picks one valid worker', () => {
  for (const seed of SEEDS) {
    const r = rng(seed);
    for (let iter = 0; iter < 40; iter++) {
      const jobId = randHex(r, 64);
      const round = Math.floor(r() * 5);
      const nPeers = 1 + Math.floor(r() * 8);
      // worker identity = a real Ed25519 keypair; claims are SIGNED with it
      const peers = Array.from({ length: nPeers }, () => generateKeypair());
      const keys = peers.map((p) => p.publicKey);
      const claims = peers.map((p) => buildClaim(jobId, p.publicKey, round, p.secretKey));
      // noise that must NEVER be a candidate for (jobId, round): either a
      // different jobId, or a round guaranteed != round (round+5 .. round+14).
      const noise = Array.from({ length: Math.floor(r() * 6) }, () => {
        const k = generateKeypair();
        return buildClaim(pick(r, [jobId, randHex(r, 64)]), k.publicKey, round + 5 + Math.floor(r() * 10), k.secretKey);
      });
      const all = [...claims, ...noise];

      const w1 = claimWinner(jobId, round, all);
      // permutation invariance across several shuffles
      for (let s = 0; s < 5; s++) {
        const w = claimWinner(jobId, round, shuffle(r, all));
        assert.equal(w, w1, `seed ${seed}: winner changed under permutation`);
      }
      // winner is one of the real candidate keys (noise is wrong round/job)
      assert.ok(keys.includes(w1), `seed ${seed}: winner not a candidate`);
      // duplicate claims must not change the winner
      const w2 = claimWinner(jobId, round, [...all, ...claims, ...claims]);
      assert.equal(w2, w1, `seed ${seed}: duplicates changed winner`);
      // the winner has the globally-minimal rank among candidates
      const minRank = Math.min(...keys.map((p) => parseInt(claimRank(jobId, p, round).slice(0, 13), 16)));
      assert.equal(parseInt(claimRank(jobId, w1, round).slice(0, 13), 16), minRank);
    }
  }
});

test('fuzz: claimWinner ignores other rounds/jobs entirely', () => {
  for (const seed of SEEDS) {
    const r = rng(seed);
    const jobId = randHex(r, 64);
    const a = generateKeypair();
    const b = generateKeypair();
    const claims = [buildClaim(jobId, a.publicKey, 0, a.secretKey), buildClaim(jobId, b.publicKey, 0, b.secretKey)];
    assert.equal(claimWinner(jobId, 1, claims), null);
    assert.equal(claimWinner(randHex(r, 64), 0, claims), null);
  }
});

// ========================================================================
// validateClaim — gate before claimWinner (claims DB is open-write). Claims
// are SIGNED and key-bound (anti-grind, R-010), so any field mutation must be
// rejected either on shape OR on the signature.
// ========================================================================
test('fuzz: validateClaim accepts well-formed, rejects single-field mutations', () => {
  for (const seed of SEEDS) {
    const r = rng(seed);
    for (let i = 0; i < 30; i++) {
      const kp = generateKeypair();
      const jobId = randHex(r, 64);
      const round = Math.floor(r() * 64);
      const good = buildClaim(jobId, kp.publicKey, round, kp.secretKey);
      assert.equal(validateClaim(good), null);
      const otherKey = generateKeypair().publicKey;
      // mutate one field — invalid by shape OR by broken signature
      const mut = pick(r, [
        { ...good, v: 2 },
        { ...good, jobId: randHex(r, 63) }, // wrong length
        { ...good, jobId: randHex(r, 64) }, // valid shape, but sig no longer matches
        { ...good, workerKey: '' },
        { ...good, workerKey: 'not-a-key' },
        { ...good, workerKey: otherKey }, // real key, but not the signer
        { ...good, round: -1 },
        { ...good, round: 65 },
        { ...good, round: 1.5 },
        { ...good, round: round === 0 ? 2 : 0 }, // valid round, but sig is over the original
        { ...good, sig: undefined },
        { ...good, sig: toB64(new Uint8Array(64)) }, // well-formed but wrong signature
      ]);
      assert.notEqual(validateClaim(mut), null, `seed ${seed}: bad claim accepted: ${JSON.stringify(mut)}`);
    }
  }
});

// ========================================================================
// canonicalJson — key-order-independent, used before hashing/signing
// ========================================================================
test('fuzz: canonicalJson is object-key-order independent, array-order sensitive', () => {
  for (const seed of SEEDS) {
    const r = rng(seed);
    for (let i = 0; i < 40; i++) {
      const keys = ['a', 'b', 'c', 'd', 'e'].slice(0, 2 + Math.floor(r() * 3));
      const vals = keys.map(() => pick(r, [r() * 100 | 0, randStr(r, 4), r() < 0.5, null, [1, 2], { x: 1 }]));
      const o1 = {};
      for (const k of shuffle(r, keys)) o1[k] = vals[keys.indexOf(k)];
      const o2 = {};
      for (const k of shuffle(r, keys)) o2[k] = vals[keys.indexOf(k)];
      assert.equal(canonicalJson(o1), canonicalJson(o2), `seed ${seed}: key order changed bytes`);
      // round-trips to the same value
      assert.deepEqual(JSON.parse(canonicalJson(o1)), JSON.parse(JSON.stringify(sortDeep(o1))));
    }
    // array order DOES matter
    assert.notEqual(canonicalJson([1, 2, 3]), canonicalJson([3, 2, 1]));
    // undefined object fields omitted
    assert.equal(canonicalJson({ a: 1, b: undefined }), '{"a":1}');
  }
});
function sortDeep(v) {
  if (Array.isArray(v)) return v.map(sortDeep);
  if (v && typeof v === 'object') {
    return Object.keys(v).sort().reduce((acc, k) => ((acc[k] = sortDeep(v[k])), acc), {});
  }
  return v;
}

// ========================================================================
// zip / jobId determinism + envelope verification
// ========================================================================
test('fuzz: same job → identical zip bytes + jobId; parse round-trips', () => {
  for (const seed of SEEDS) {
    const r = rng(seed);
    for (let i = 0; i < 25; i++) {
      const src = randStr(r, 1 + Math.floor(r() * 200));
      const label = randStr(r, Math.floor(r() * 40));
      const args = Array.from({ length: Math.floor(r() * 4) }, () => randStr(r, 1 + Math.floor(r() * 8)));
      const type = pick(r, ['js', 'wasm']);
      const manifest = buildManifest({ type, label, args: type === 'wasm' ? args : [] });
      const entry = type === 'js' ? src : new Uint8Array(Array.from({ length: 8 + (i % 5) }, () => Math.floor(r() * 256)));

      const a = buildJobZipB64(manifest, entry);
      const b = buildJobZipB64(manifest, entry);
      assert.equal(a, b, `seed ${seed}: zip not deterministic`);
      assert.equal(jobIdOf(a), jobIdOf(b));
      assert.equal(jobIdOf(a), sha256Hex(a)); // jobId == sha256 of the base64 string

      const parsed = parseJobZipB64(a);
      assert.equal(parsed.manifest.type, type);
      if (type === 'js') assert.equal(Buffer.from(parsed.entryBytes).toString('utf8'), src);
      else assert.deepEqual([...parsed.entryBytes], [...entry]);
    }
  }
});

test('fuzz: verifyEnvelope accepts valid, rejects any identity-field mutation', () => {
  for (const seed of SEEDS) {
    const r = rng(seed);
    for (let i = 0; i < 20; i++) {
      const kp = generateKeypair();
      const manifest = buildManifest({ type: 'js', label: randStr(r, 8) });
      const zipB64 = buildJobZipB64(manifest, 'console.log(' + (r() * 100 | 0) + ')');
      const env = createEnvelope({ zipB64, publicKeyB64: kp.publicKey, secretKeyB64: kp.secretKey });
      assert.equal(verifyEnvelope(env), null, `seed ${seed}: valid envelope rejected`);

      // metadata mutations are still accepted (nonce/submittedAt are not identity)
      assert.equal(verifyEnvelope({ ...env, submittedAt: env.submittedAt + 1 }), null);
      assert.equal(verifyEnvelope({ ...env, nonce: 'AAAAAAAAAAAAAAAAAAAAAA==' }), null);

      // identity mutations MUST be rejected
      const otherZip = buildJobZipB64(manifest, 'console.log(' + (r() * 100 | 0) + 7 + ')');
      const otherKp = generateKeypair();
      assert.notEqual(verifyEnvelope({ ...env, zipB64: otherZip }), null, 'payload swap accepted');
      assert.notEqual(verifyEnvelope({ ...env, jobId: jobIdOf(otherZip) }), null, 'jobId swap accepted');
      assert.notEqual(verifyEnvelope({ ...env, pubkey: otherKp.publicKey }), null, 'pubkey swap accepted');
      assert.notEqual(verifyEnvelope({ ...env, sig: mutateSig(r, env.sig) }), null, 'sig mutation accepted');
    }
  }
});
// Mutate the DECODED signature bytes (flipping a base64 char can be a no-op
// because non-canonical base64 has ignored low bits in the final group).
function mutateSig(r, sigB64) {
  const bytes = fromB64(sigB64);
  const i = Math.floor(r() * bytes.length);
  bytes[i] ^= 1 + Math.floor(r() * 255); // guaranteed different byte value
  return toB64(bytes);
}

// ========================================================================
// trust chain — order independence, cycle safety, forgery rejection
// ========================================================================
test('fuzz: computeTrustedServers is endorsement-order independent + transitive', () => {
  for (const seed of SEEDS) {
    const r = rng(seed);
    const genesis = generateKeypair();
    // build a random DAG-ish chain rooted at genesis
    const servers = Array.from({ length: 4 + Math.floor(r() * 4) }, () => generateKeypair());
    const trustedSoFar = [genesis];
    const endorsements = [];
    for (const s of servers) {
      const endorser = pick(r, trustedSoFar); // endorsed by someone already trusted
      endorsements.push(
        createEndorsement({
          serverPubkey: s.publicKey,
          multiaddrs: [],
          label: 'srv',
          endorserPublicKeyB64: endorser.publicKey,
          endorserSecretKeyB64: endorser.secretKey,
        })
      );
      trustedSoFar.push(s);
    }
    // add rogue self-endorsements and forged endorsements (must NOT be trusted)
    const rogues = Array.from({ length: 1 + Math.floor(r() * 3) }, () => generateKeypair());
    for (const rogue of rogues) {
      endorsements.push(
        createEndorsement({
          serverPubkey: rogue.publicKey,
          multiaddrs: [],
          label: 'rogue',
          endorserPublicKeyB64: rogue.publicKey, // self-cycle
          endorserSecretKeyB64: rogue.secretKey,
        })
      );
      // forged: claims genesis endorsed it, but signed with the wrong key
      const forged = createEndorsement({
        serverPubkey: rogue.publicKey,
        multiaddrs: [],
        label: 'forged',
        endorserPublicKeyB64: genesis.publicKey,
        endorserSecretKeyB64: rogue.secretKey,
      });
      endorsements.push(forged);
    }

    const expected = new Set([genesis.publicKey, ...servers.map((s) => s.publicKey)]);
    // try many shuffles — trusted set must be identical and exclude rogues
    let canonical = null;
    for (let s = 0; s < 6; s++) {
      const trusted = computeTrustedServers(genesis.publicKey, shuffle(r, endorsements));
      const keys = [...trusted.keys()].sort().join(',');
      if (canonical === null) canonical = keys;
      assert.equal(keys, canonical, `seed ${seed}: trusted set changed with order`);
      for (const e of expected) assert.ok(trusted.has(e), `seed ${seed}: missing legit server`);
      for (const rogue of rogues) assert.ok(!trusted.has(rogue.publicKey), `seed ${seed}: rogue trusted`);
    }
    // no genesis → nothing trusted
    assert.equal(computeTrustedServers('', endorsements).size, 0);
  }
});

test('fuzz: verifyAttestation only trusts trusted-server attestations, rejects tampering', () => {
  for (const seed of SEEDS) {
    const r = rng(seed);
    const genesis = generateKeypair();
    const trusted = computeTrustedServers(genesis.publicKey, []);
    for (let i = 0; i < 20; i++) {
      const user = generateKeypair();
      const emailHmac = hmacSha256Hex(randStr(r, 10) + '@x.com', 'salt');
      const att = createAttestation({
        pubkey: user.publicKey,
        emailHmac,
        serverPublicKeyB64: genesis.publicKey,
        serverSecretKeyB64: genesis.secretKey,
      });
      assert.equal(verifyAttestation(att, trusted), null, `seed ${seed}: valid attestation rejected`);

      // untrusted attester
      const rogue = generateKeypair();
      const rogueAtt = createAttestation({
        pubkey: user.publicKey,
        emailHmac,
        serverPublicKeyB64: rogue.publicKey,
        serverSecretKeyB64: rogue.secretKey,
      });
      assert.notEqual(verifyAttestation(rogueAtt, trusted), null, 'untrusted attester accepted');

      // tamper a signed field
      const mut = pick(r, [
        { ...att, emailHmac: randHex(r, 64) },
        { ...att, pubkey: rogue.publicKey },
        { ...att, addedAt: att.addedAt + 1 },
      ]);
      assert.notEqual(verifyAttestation(mut, trusted), null, `seed ${seed}: tampered attestation accepted`);
    }
  }
});
