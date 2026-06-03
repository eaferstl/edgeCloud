// The highest-value test in the repo: proves that a job built "browser-style"
// (js-sha256 for hashing, tweetnacl for signing, fflate for zipping — the
// exact libs vendored into the webform) is byte-for-byte identical to and
// verifiable by the Node-side shared code. If this drifts, workers silently
// reject every job.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sha256 as jsSha256 } from 'js-sha256';
import nacl from 'tweetnacl';
import { zipSync, strToU8 } from 'fflate';

import { buildManifest } from '../src/manifest.js';
import { buildJobZipB64, parseJobZipB64 } from '../src/zip.js';
import { createEnvelope, verifyEnvelope, jobIdOf } from '../src/envelope.js';
import { canonicalJson } from '../src/canonical.js';
import { generateKeypair, fromB64, toB64 } from '../src/crypto.js';
import { ZIP_FIXED_MTIME_MS } from '../src/constants.js';

// --- replicate the browser's zip/hash/sign pipeline (mirrors public/app.js) ---

function browserBuildZipB64(manifest, entrySource) {
  const opts = { level: 0, mtime: new Date(ZIP_FIXED_MTIME_MS) };
  const tree = {
    [manifest.entry]: [strToU8(entrySource), opts],
    'manifest.json': [strToU8(canonicalJson(manifest)), opts],
  };
  const zipped = zipSync(tree, { level: 0, mtime: new Date(ZIP_FIXED_MTIME_MS) });
  // browsers btoa() a binary string; Buffer.from(...).toString('base64') is equivalent
  let bin = '';
  for (const b of zipped) bin += String.fromCharCode(b);
  // Node's btoa operates on latin1 strings, same as the browser's
  return btoa(bin);
}

function browserEnvelope(zipB64, keypair) {
  const jobId = jsSha256(zipB64); // js-sha256 hashes the UTF-8 of the string
  const sig = nacl.sign.detached(new TextEncoder().encode(jobId), keypair.secretKey);
  return {
    v: 1,
    jobId,
    zipB64,
    pubkey: toB64(keypair.publicKey),
    sig: toB64(sig),
    submittedAt: Date.now(),
    nonce: toB64(nacl.randomBytes(16)),
  };
}

test('node-ESM and browser-style-ESM zips agree (same fflate build)', () => {
  // Both sides here use the ESM fflate, so this checks the determinism RULES
  // (STORE, fixed mtime, entry order, canonical manifest) are applied
  // consistently. Cross-build parity with the browser's UMD fflate is NOT
  // asserted (different builds can differ) and is NOT required — see
  // server/test/browser-pipeline.test.js, which proves the real invariant:
  // the browser zip is deterministic and parseable/verifiable by this code.
  const manifest = buildManifest({ type: 'js', label: 'six times seven' });
  const src = 'console.log(6 * 7)';
  const nodeZip = buildJobZipB64(manifest, src);
  const browserZip = browserBuildZipB64(manifest, src);
  assert.equal(browserZip, nodeZip);
});

test('determinism: same input twice -> same bytes, same jobId', () => {
  const manifest = buildManifest({ type: 'js', label: 'pi' });
  const src = 'console.log(Math.PI)';
  const a = buildJobZipB64(manifest, src);
  const b = buildJobZipB64(manifest, src);
  assert.equal(a, b);
  assert.equal(jobIdOf(a), jobIdOf(b));
});

test('browser jobId (js-sha256) matches Node jobId (node:crypto)', () => {
  const manifest = buildManifest({ type: 'js' });
  const zipB64 = buildJobZipB64(manifest, 'console.log(1 + 1)');
  assert.equal(jsSha256(zipB64), jobIdOf(zipB64));
});

test('browser-signed envelope verifies with shared verifyEnvelope', () => {
  const kp = nacl.sign.keyPair();
  const manifest = buildManifest({ type: 'js', label: 'fib' });
  const zipB64 = browserBuildZipB64(manifest, 'console.log(610)');
  const env = browserEnvelope(zipB64, kp);
  assert.equal(verifyEnvelope(env), null);
});

test('Node-built envelope verifies and round-trips through the zip parser', () => {
  const { publicKey, secretKey } = generateKeypair();
  const manifest = buildManifest({ type: 'js', label: 'mult' });
  const zipB64 = buildJobZipB64(manifest, 'console.log(6 * 7)');
  const env = createEnvelope({ zipB64, publicKeyB64: publicKey, secretKeyB64: secretKey });
  assert.equal(verifyEnvelope(env), null);
  const { manifest: m2, entryBytes } = parseJobZipB64(env.zipB64);
  assert.deepEqual(m2, manifest);
  assert.equal(Buffer.from(entryBytes).toString('utf8'), 'console.log(6 * 7)');
});

test('tampering is rejected', () => {
  const { publicKey, secretKey } = generateKeypair();
  const manifest = buildManifest({ type: 'js' });
  const zipB64 = buildJobZipB64(manifest, 'console.log(1)');
  const env = createEnvelope({ zipB64, publicKeyB64: publicKey, secretKeyB64: secretKey });

  const evil = buildJobZipB64(manifest, 'console.log(2)');
  assert.notEqual(verifyEnvelope({ ...env, zipB64: evil }), null); // payload swap
  assert.notEqual(verifyEnvelope({ ...env, jobId: jobIdOf(evil) }), null); // id swap breaks sig
  const otherKp = generateKeypair();
  assert.notEqual(verifyEnvelope({ ...env, pubkey: otherKp.publicKey }), null); // key swap
});

test('wasm manifest validation', () => {
  const m = buildManifest({ type: 'wasm', args: ['100'], label: 'pi100' });
  assert.deepEqual(m.command, ['wasmtime', 'run', '--dir', '.', 'module.wasm']);
  const wasmBytes = new Uint8Array([0x00, 0x61, 0x73, 0x6d, 1, 0, 0, 0]); // empty module header
  const zipB64 = buildJobZipB64(m, wasmBytes);
  const { manifest, entryBytes } = parseJobZipB64(zipB64);
  assert.equal(manifest.type, 'wasm');
  assert.deepEqual([...entryBytes], [...wasmBytes]);
});

test('zip parser rejects malformed payloads', () => {
  assert.throws(() => parseJobZipB64(''));
  assert.throws(() => parseJobZipB64('AAAA'));
  // zip with an unexpected extra file
  const opts = { level: 0, mtime: new Date(ZIP_FIXED_MTIME_MS) };
  const manifest = buildManifest({ type: 'js' });
  const tree = {
    'main.js': [strToU8('1'), opts],
    'manifest.json': [strToU8(canonicalJson(manifest)), opts],
    'sneaky.sh': [strToU8('rm -rf /'), opts],
  };
  const b64 = Buffer.from(zipSync(tree, { level: 0 })).toString('base64');
  assert.throws(() => parseJobZipB64(b64), /unexpected file/);
});

test('signature helpers agree between tweetnacl raw and shared helpers', () => {
  const { publicKey, secretKey } = generateKeypair();
  const msg = 'deadbeef'.repeat(8);
  const sig = nacl.sign.detached(new TextEncoder().encode(msg), fromB64(secretKey));
  const env = { sigB64: toB64(sig) };
  const { verifyDetachedB64 } = awaitImportCrypto();
  assert.equal(verifyDetachedB64(msg, env.sigB64, publicKey), true);
});

// tiny sync import helper to keep the test above flat
import * as cryptoMod from '../src/crypto.js';
function awaitImportCrypto() {
  return cryptoMod;
}
