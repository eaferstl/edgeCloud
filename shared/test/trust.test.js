import { test } from 'node:test';
import assert from 'node:assert/strict';

import { generateKeypair, hmacSha256Hex } from '../src/crypto.js';
import {
  createAttestation,
  verifyAttestation,
  createEndorsement,
  computeTrustedServers,
} from '../src/trust.js';
import { claimWinner, buildClaim } from '../src/claims.js';

const genesis = generateKeypair();
const serverB = generateKeypair();
const serverC = generateKeypair();
const rogue = generateKeypair();

test('trust chain: genesis -> B -> C, rogue excluded', () => {
  const endorseB = createEndorsement({
    serverPubkey: serverB.publicKey,
    multiaddrs: ['/ip4/10.0.0.2/tcp/4002/ws'],
    label: 'server-b',
    endorserPublicKeyB64: genesis.publicKey,
    endorserSecretKeyB64: genesis.secretKey,
  });
  const endorseC = createEndorsement({
    serverPubkey: serverC.publicKey,
    label: 'server-c',
    endorserPublicKeyB64: serverB.publicKey,
    endorserSecretKeyB64: serverB.secretKey,
  });
  // rogue endorses itself — must not enter the set
  const endorseRogue = createEndorsement({
    serverPubkey: rogue.publicKey,
    label: 'rogue',
    endorserPublicKeyB64: rogue.publicKey,
    endorserSecretKeyB64: rogue.secretKey,
  });

  // order-independence: C's endorsement arrives before B's
  const trusted = computeTrustedServers(genesis.publicKey, [endorseC, endorseRogue, endorseB]);
  assert.ok(trusted.has(genesis.publicKey));
  assert.ok(trusted.has(serverB.publicKey));
  assert.ok(trusted.has(serverC.publicKey));
  assert.ok(!trusted.has(rogue.publicKey));
  assert.deepEqual(trusted.get(serverB.publicKey).multiaddrs, ['/ip4/10.0.0.2/tcp/4002/ws']);
});

test('forged endorsement signature is ignored', () => {
  const forged = createEndorsement({
    serverPubkey: rogue.publicKey,
    label: 'forged',
    endorserPublicKeyB64: genesis.publicKey, // claims genesis endorsed it...
    endorserSecretKeyB64: rogue.secretKey,   // ...but signed with the wrong key
  });
  const trusted = computeTrustedServers(genesis.publicKey, [forged]);
  assert.ok(!trusted.has(rogue.publicKey));
});

test('attestation verifies only from trusted servers', () => {
  const user = generateKeypair();
  const emailHmac = hmacSha256Hex('alice@example.com', 'test-salt');
  const att = createAttestation({
    pubkey: user.publicKey,
    emailHmac,
    serverPublicKeyB64: genesis.publicKey,
    serverSecretKeyB64: genesis.secretKey,
  });
  const trusted = computeTrustedServers(genesis.publicKey, []);
  assert.equal(verifyAttestation(att, trusted), null);

  const rogueAtt = createAttestation({
    pubkey: user.publicKey,
    emailHmac,
    serverPublicKeyB64: rogue.publicKey,
    serverSecretKeyB64: rogue.secretKey,
  });
  assert.match(verifyAttestation(rogueAtt, trusted), /not a trusted server/);

  // tampered field breaks the signature
  assert.match(verifyAttestation({ ...att, emailHmac: 'ff'.repeat(32) }, trusted), /bad attestation/);
});

test('claim winner is deterministic and order-independent', () => {
  const jobId = 'ab'.repeat(32);
  // worker identity = base64 public key; claims are signed with the matching key
  const a = generateKeypair();
  const b = generateKeypair();
  const c = generateKeypair();
  const keys = [a, b, c].map((k) => k.publicKey);
  const claims = [a, b, c].map((k) => buildClaim(jobId, k.publicKey, 0, k.secretKey));
  const w1 = claimWinner(jobId, 0, claims);
  const w2 = claimWinner(jobId, 0, [...claims].reverse());
  assert.equal(w1, w2);
  assert.ok(keys.includes(w1));
  // different round -> potentially different winner, but never claims from other rounds
  assert.equal(claimWinner(jobId, 1, claims), null);
});
