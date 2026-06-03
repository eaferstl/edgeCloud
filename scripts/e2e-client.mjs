// E2E test client: exercises the full browser flow against a running server
// (register -> sign -> submit -> poll -> challenge/response -> fetch result).
//
//   node scripts/e2e-client.mjs http://127.0.0.1:18080 test@example.com "6 * 7" [--expect <stdout>]
//
// Uses the same shared code the workers use, so it also re-validates the
// envelope/zip round trip against a live server.

import { buildManifest } from '@edgecloud/shared/manifest.js';
import { buildJobZipB64 } from '@edgecloud/shared/zip.js';
import { createEnvelope } from '@edgecloud/shared/envelope.js';
import { generateKeypair, signDetachedB64 } from '@edgecloud/shared/crypto.js';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Persist keypairs per (server, email) so repeated runs don't burn key slots
// (max 4 keys per email).
const cacheFile = path.join(os.tmpdir(), 'edgecloud-e2e-keys.json');
function cachedKeypair(tag) {
  let cache = {};
  try { cache = JSON.parse(fs.readFileSync(cacheFile, 'utf8')); } catch {}
  if (!cache[tag]) {
    cache[tag] = generateKeypair();
    fs.writeFileSync(cacheFile, JSON.stringify(cache, null, 2));
  }
  return cache[tag];
}

const [base, email, code] = process.argv.slice(2);
const expectIdx = process.argv.indexOf('--expect');
const expected = expectIdx === -1 ? null : process.argv[expectIdx + 1];
if (!base || !email || !code) {
  console.error('usage: node scripts/e2e-client.mjs <baseUrl> <email> <jsCode> [--expect <stdout>]');
  process.exit(1);
}

async function api(method, pathname, body, headers = {}) {
  const res = await fetch(base + pathname, {
    method,
    headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({}));
  return { status: res.status, body: json };
}

// 1. register (persisted key — re-registering the same key is idempotent)
const kp = cachedKeypair(`${base}|${email}|main`);
const reg = await api('POST', '/api/register', { email, pubkey: kp.publicKey });
console.log(`[1] register: ${reg.status} ${JSON.stringify(reg.body)}`);
if (reg.status !== 200) process.exit(1);

// 2. build + submit job (same wrapping rule as the webform)
const src = /console\.(log|error|info|warn)/.test(code)
  ? code
  : `const __r = eval(${JSON.stringify(code)});\nif (__r !== undefined) console.log(__r);`;
const manifest = buildManifest({ type: 'js', label: code.slice(0, 60) });
const zipB64 = buildJobZipB64(manifest, src);
const env = createEnvelope({ zipB64, publicKeyB64: kp.publicKey, secretKeyB64: kp.secretKey });
const sub = await api('POST', '/api/jobs', env);
console.log(`[2] submit: ${sub.status} status=${sub.body.status} cached=${sub.body.cached} jobId=${env.jobId.slice(0, 16)}…`);
if (sub.status !== 200) process.exit(1);

// 3. wait for completion
let result = sub.body.result ?? null;
if (!result) {
  process.stdout.write('[3] waiting for a worker');
  const deadline = Date.now() + 120000;
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, 1500));
    const st = await api('GET', `/api/jobs/${env.jobId}/status`);
    process.stdout.write('.');
    if (st.body.status === 'done') break;
  }
  process.stdout.write('\n');
}

// 4. challenge/response auth + gated result fetch
const ch = await api('GET', `/api/challenge?pubkey=${encodeURIComponent(kp.publicKey)}`);
const sig = signDetachedB64(ch.body.nonce, kp.secretKey);
const ver = await api('POST', '/api/auth/verify', { pubkey: kp.publicKey, nonce: ch.body.nonce, sig });
console.log(`[4] auth: challenge=${ch.status} verify=${ver.status}`);
if (ver.status !== 200) process.exit(1);

const res = await api('GET', `/api/jobs/${env.jobId}/result`, undefined, {
  authorization: `Bearer ${ver.body.token}`,
});
console.log(`[5] result: ${res.status} ${JSON.stringify(res.body)}`);
result = res.body.result;

// 5. negative check: a stranger's session must NOT read this result
const stranger = cachedKeypair(`${base}|${email}|stranger`);
await api('POST', '/api/register', { email, pubkey: stranger.publicKey }); // same email, different key
const ch2 = await api('GET', `/api/challenge?pubkey=${encodeURIComponent(stranger.publicKey)}`);
const ver2 = await api('POST', '/api/auth/verify', {
  pubkey: stranger.publicKey,
  nonce: ch2.body.nonce,
  sig: signDetachedB64(ch2.body.nonce, stranger.secretKey),
});
const stolen = await api('GET', `/api/jobs/${env.jobId}/result`, undefined, {
  authorization: `Bearer ${ver2.body.token}`,
});
console.log(`[6] stranger result fetch (expect 403): ${stolen.status}`);
if (stolen.status !== 403) {
  console.error('FAIL: result was readable by a non-submitter');
  process.exit(1);
}

if (result) {
  console.log(`[✓] stdout: ${JSON.stringify(result.stdout)}`);
  if (expected !== null && result.stdout.trim() !== expected) {
    console.error(`FAIL: expected ${JSON.stringify(expected)}, got ${JSON.stringify(result.stdout.trim())}`);
    process.exit(1);
  }
  console.log('PASS');
} else if (res.status === 202) {
  console.log('NO WORKER ONLINE — job stayed queued (submission path itself PASSED)');
} else {
  process.exit(1);
}
