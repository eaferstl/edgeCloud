// Proves the ACTUAL browser pipeline works: loads the real vendored UMD libs
// (nacl, sha256, fflate) the webform ships, runs the exact zip/hash/sign steps
// from public/app.js inside one consistent realm, and checks that the result
// is (a) deterministic and (b) accepted by the shared server/worker code.
//
// Why a vm realm instead of importing the libs: the page builds its byte
// arrays with the same TextEncoder/Uint8Array that fflate sees, so they must
// share a realm — exactly what a browser provides and what this test
// reproduces. (Mixing realms makes fflate's `instanceof Uint8Array` checks
// fail; that is a test artifact, not a browser behavior.)

import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { parseJobZipB64 } from '@edgecloud/shared/zip.js';
import { verifyEnvelope, jobIdOf } from '@edgecloud/shared/envelope.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VENDOR = path.join(__dirname, '..', 'src', 'public', 'vendor');

function makeRealm() {
  const ctx = { TextEncoder, TextDecoder, Uint8Array, Float64Array, Date, Math, console, Buffer, crypto };
  ctx.self = ctx;
  ctx.window = ctx;
  ctx.globalThis = ctx;
  vm.createContext(ctx);
  for (const f of ['nacl.min.js', 'sha256.min.js', 'fflate.min.js']) {
    vm.runInContext(fs.readFileSync(path.join(VENDOR, f), 'utf8'), ctx, { filename: f });
  }
  return ctx;
}

// the exact pipeline from public/app.js
const PIPELINE = `
  function canonicalJson(v){if(v===null||typeof v!=='object')return JSON.stringify(v);if(Array.isArray(v))return '['+v.map(canonicalJson).join(',')+']';return '{'+Object.keys(v).sort().filter(k=>v[k]!==undefined).map(k=>JSON.stringify(k)+':'+canonicalJson(v[k])).join(',')+'}';}
  function b64FromBytes(bytes){let bin='';for(let i=0;i<bytes.length;i+=0x8000){bin+=String.fromCharCode.apply(null,bytes.subarray(i,i+0x8000));}return btoa(bin);}
  function utf8Bytes(s){return new TextEncoder().encode(s);}
  const ZIP_MT = new Date(Date.UTC(2026,0,1));
  function buildZipB64(manifest, entryBytes){
    const opts={level:0,mtime:ZIP_MT};
    const tree={}; tree[manifest.entry]=[entryBytes,opts]; tree['manifest.json']=[utf8Bytes(canonicalJson(manifest)),opts];
    return b64FromBytes(fflate.zipSync(tree,{level:0,mtime:ZIP_MT}));
  }
  function buildEnvelope(zipB64, kp){
    const jobId = sha256(zipB64);
    const sig = nacl.sign.detached(utf8Bytes(jobId), kp.secretKey);
    return { v:1, jobId, zipB64, pubkey: b64FromBytes(kp.publicKey), sig: b64FromBytes(sig), submittedAt: Date.now(), nonce: b64FromBytes(nacl.randomBytes(16)) };
  }
`;

function btoaPolyfill(ctx) {
  ctx.btoa = (s) => Buffer.from(s, 'latin1').toString('base64');
  ctx.atob = (s) => Buffer.from(s, 'base64').toString('latin1');
}

test('browser builds a deterministic, worker-parseable, server-verifiable JS job', () => {
  const ctx = makeRealm();
  btoaPolyfill(ctx);
  const result = vm.runInContext(
    PIPELINE +
      `
    const manifest = { v:1, type:'js', entry:'main.js', args:[], timeoutMs:10000, label:'six times seven' };
    const src = 'console.log(6 * 7)';
    const kp = nacl.sign.keyPair();
    const zipA = buildZipB64(manifest, utf8Bytes(src));
    const zipB = buildZipB64(manifest, utf8Bytes(src));
    const env = buildEnvelope(zipA, kp);
    ({ deterministic: zipA === zipB, env });
  `,
    ctx
  );

  assert.equal(result.deterministic, true, 'same input must yield identical zip bytes');
  assert.equal(jobIdOf(result.env.zipB64), result.env.jobId, 'jobId must equal sha256(zipB64)');
  assert.equal(verifyEnvelope(result.env), null, 'shared verifyEnvelope must accept the browser envelope');
  const parsed = parseJobZipB64(result.env.zipB64);
  assert.equal(parsed.manifest.type, 'js');
  assert.equal(Buffer.from(parsed.entryBytes).toString('utf8'), 'console.log(6 * 7)');
});

test('browser challenge signing matches what the server verifies', () => {
  const ctx = makeRealm();
  btoaPolyfill(ctx);
  const { pubkey, nonce, sig } = vm.runInContext(
    PIPELINE +
      `
    const kp = nacl.sign.keyPair();
    const nonceBytes = nacl.randomBytes(32);
    const nonce = b64FromBytes(nonceBytes);
    const sig = b64FromBytes(nacl.sign.detached(utf8Bytes(nonce), kp.secretKey));
    ({ pubkey: b64FromBytes(kp.publicKey), nonce, sig });
  `,
    ctx
  );
  // server verifies the signed nonce with the shared helper
  return import('@edgecloud/shared/crypto.js').then(({ verifyDetachedB64 }) => {
    assert.equal(verifyDetachedB64(nonce, sig, pubkey), true);
  });
});
