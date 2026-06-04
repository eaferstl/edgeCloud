// Local end-to-end harness: boots a real central server + two real workers as
// child processes (own temp data dirs, unique ports, the server's own key as
// genesis), then runs the scenario matrix against the live HTTP + libp2p +
// OrbitDB path — no mocks. Exits 0 on success, non-zero on any failure.
//
//   EDGECLOUD_SHARED_SALT=testsalt node scripts/e2e-local.mjs
//
// Non-flaky by construction: every wait is a polled condition with a timeout,
// not a fixed sleep (except minimal process-spawn settling).

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeypair, signDetachedB64 } from '@edgecloud/shared/crypto.js';
import { buildManifest } from '@edgecloud/shared/manifest.js';
import { buildJobZipB64 } from '@edgecloud/shared/zip.js';
import { createEnvelope } from '@edgecloud/shared/envelope.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NODE = process.execPath;
const SALT = process.env.EDGECLOUD_SHARED_SALT || 'e2e-local-salt';
const HTTP = 18190, TCP = 14190, WS = 14191;
const BASE = `http://127.0.0.1:${HTTP}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ec-e2e-'));
const procs = [];
let failures = 0;

const log = (...a) => console.log(...a);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
async function waitFor(fn, { timeout = 120000, interval = 500, label = 'condition' } = {}) {
  const end = Date.now() + timeout;
  while (Date.now() < end) {
    try { if (await fn()) return true; } catch { /* keep polling */ }
    await sleep(interval);
  }
  throw new Error(`timed out waiting for ${label}`);
}
function check(name, ok, detail = '') {
  if (ok) log(`  ✅ ${name}`);
  else { log(`  ❌ ${name} ${detail}`); failures++; }
  return ok;
}

// --- HTTP helpers (mirror the browser/worker flow) ---
async function api(method, p, body, headers = {}) {
  const res = await fetch(BASE + p, {
    method, headers: { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})) };
}
async function register(email) {
  const kp = generateKeypair();
  const r = await api('POST', '/api/register', { email, pubkey: kp.publicKey });
  if (r.status !== 200) throw new Error(`register ${email}: ${r.status} ${JSON.stringify(r.body)}`);
  return kp;
}
function jobEnvelope(kp, code) {
  const src = /console\.(log|error)/.test(code) ? code : `console.log(${code})`;
  const zipB64 = buildJobZipB64(buildManifest({ type: 'js', label: code.slice(0, 40) }), src);
  return createEnvelope({ zipB64, publicKeyB64: kp.publicKey, secretKeyB64: kp.secretKey });
}
async function fetchResult(kp, jobId) {
  const ch = await api('GET', `/api/challenge?pubkey=${encodeURIComponent(kp.publicKey)}`);
  const ver = await api('POST', '/api/auth/verify', {
    pubkey: kp.publicKey, nonce: ch.body.nonce, sig: signDetachedB64(ch.body.nonce, kp.secretKey),
  });
  const r = await api('GET', `/api/jobs/${jobId}/result`, undefined, { authorization: `Bearer ${ver.body.token}` });
  return r;
}
async function submitAndWait(kp, code, { timeout = 120000 } = {}) {
  const env = jobEnvelope(kp, code);
  const sub = await api('POST', '/api/jobs', env);
  await waitFor(async () => (await api('GET', `/api/jobs/${env.jobId}/status`)).body.status === 'done',
    { timeout, label: `result for ${env.jobId.slice(0, 8)}` });
  const r = await fetchResult(kp, env.jobId);
  return { env, sub: sub.body, result: r.body.result };
}

// --- process management ---
function startProc(name, args, env, onLine) {
  const p = spawn(NODE, args, { cwd: REPO, env: { ...process.env, ...env } });
  let buf = '';
  const handle = (d) => {
    buf += d.toString();
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { const line = buf.slice(0, i); buf = buf.slice(i + 1); onLine && onLine(line); }
  };
  p.stdout.on('data', handle);
  p.stderr.on('data', handle);
  procs.push({ name, p });
  return p;
}
function cleanup() {
  for (const { p } of procs) { try { p.kill('SIGKILL'); } catch {} }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

// ==========================================================================
async function main() {
  // genesis = the server's own key (pre-generate so workers can trust it)
  const serverKey = generateKeypair();
  const serverData = path.join(tmp, 'server');
  fs.mkdirSync(serverData, { recursive: true });
  fs.writeFileSync(path.join(serverData, 'server-key.json'), JSON.stringify(serverKey), { mode: 0o600 });
  const GENESIS = serverKey.publicKey;

  // seed an allowlist CSV and import it
  const csv = path.join(tmp, 'attendees.csv');
  fs.writeFileSync(csv, 'First,Last,Email\n' + ['a', 'b', 'c', 'd', 'e', 'limit'].map((x) => `T,U,${x}@e2e.test`).join('\n') + '\n');
  await new Promise((res, rej) => {
    const imp = spawn(NODE, ['server/src/allowlist-import.js', csv],
      { cwd: REPO, env: { ...process.env, EDGECLOUD_DATA: serverData, EDGECLOUD_SHARED_SALT: SALT } });
    imp.on('exit', (c) => (c === 0 ? res() : rej(new Error('allowlist import failed'))));
  });

  log('▶ booting server…');
  startProc('server', ['server/src/index.js'], {
    EDGECLOUD_DATA: serverData, EDGECLOUD_SHARED_SALT: SALT, EDGECLOUD_GENESIS_KEY: GENESIS,
    HTTP_PORT: String(HTTP), LIBP2P_TCP_PORT: String(TCP), LIBP2P_WS_PORT: String(WS),
  });
  await waitFor(async () => (await api('GET', '/api/status')).status === 200, { label: 'server HTTP' });

  // rendezvous WS multiaddr from the server itself
  const info = (await api('GET', '/api/dbinfo')).body;
  const wsAddr = info.multiaddrs.find((m) => m.includes('/ws') && m.includes('127.0.0.1'));
  if (!wsAddr) throw new Error('no loopback ws multiaddr from /api/dbinfo');
  log(`▶ rendezvous: ${wsAddr}`);

  // two workers (plain node — no Docker; jobs run in-process, fine for the path test)
  const workerPeer = {};
  for (const id of ['w1', 'w2']) {
    const wd = path.join(tmp, id);
    fs.mkdirSync(wd, { recursive: true });
    startProc(id, ['worker/src/index.js'], {
      EDGECLOUD_DATA: wd, EDGECLOUD_GENESIS_KEY: GENESIS, RENDEZVOUS_MULTIADDR: wsAddr,
      EDGECLOUD_HTTP_FALLBACK: BASE, EDGECLOUD_SKIP_FIREWALL: '1',
    }, (line) => {
      const m = /\[boot\] peerId: (\S+)/.exec(line);
      if (m) workerPeer[id] = m.group?.[1] || m[1];
      if (/won claim round 0 — executing/.test(line)) workerPeer[`${id}_won`] = true;
    });
  }
  log('▶ waiting for 2 workers online…');
  await waitFor(async () => (await api('GET', '/api/status')).body.workersOnline >= 2,
    { timeout: 90000, label: '2 workers online' });

  // ---- scenarios ----
  log('\n▶ Scenario 1: baseline happy path (6*7)');
  {
    const kp = await register('a@e2e.test');
    const { result } = await submitAndWait(kp, '6 * 7');
    check('result is 42', result?.stdout?.trim() === '42', `got ${JSON.stringify(result?.stdout)}`);
    check('exactly one executor recorded', typeof result?.executedBy === 'string');
  }

  log('\n▶ Scenario 2: duplicate submission → instant cache hit');
  {
    const kp = await register('b@e2e.test');
    const code = 'Math.sqrt(2).toFixed(6)';
    const first = await submitAndWait(kp, code);
    const env2 = jobEnvelope(kp, code); // same code → same jobId
    const dup = await api('POST', '/api/jobs', env2);
    check('same jobId', env2.jobId === first.env.jobId);
    check('duplicate returns cached:true + done', dup.body.cached === true && dup.body.status === 'done',
      JSON.stringify(dup.body).slice(0, 80));
  }

  log('\n▶ Scenario 3: two identical concurrent submissions → one result');
  {
    const kp = await register('c@e2e.test');
    const env = jobEnvelope(kp, '21 + 21');
    const [r1, r2] = await Promise.all([api('POST', '/api/jobs', env), api('POST', '/api/jobs', env)]);
    check('both submissions accepted', r1.status === 200 && r2.status === 200);
    await waitFor(async () => (await api('GET', `/api/jobs/${env.jobId}/status`)).body.status === 'done',
      { label: 'concurrent result' });
    const res = await fetchResult(kp, env.jobId);
    check('result is 42', res.body.result?.stdout?.trim() === '42');
  }

  log('\n▶ Scenario 4: stranger cannot read another key’s result (403)');
  {
    const kp = await register('d@e2e.test');
    const { env } = await submitAndWait(kp, '1 + 1');
    const stranger = await register('e@e2e.test');
    const res = await fetchResult(stranger, env.jobId);
    check('stranger gets 403', res.status === 403, `got ${res.status}`);
  }

  log('\n▶ Scenario 5: kill the claim winner mid-job → backup takes over');
  {
    const kp = await register('a@e2e.test');
    const env = jobEnvelope(kp, 'const t=Date.now(); while(Date.now()-t<6000){} console.log("slow-done")');
    await api('POST', '/api/jobs', env);
    // wait until one worker logs that it won and is executing
    await waitFor(async () => procs.some(({ name }) => workerPeer[`${name}_won`]),
      { timeout: 20000, label: 'a worker to win the claim' });
    const winnerName = ['w1', 'w2'].find((id) => workerPeer[`${id}_won`]);
    const survivorName = winnerName === 'w1' ? 'w2' : 'w1';
    log(`  killing winner ${winnerName}…`);
    procs.find((x) => x.name === winnerName).p.kill('SIGKILL');
    // the survivor should take over and produce the result
    await waitFor(async () => (await api('GET', `/api/jobs/${env.jobId}/status`)).body.status === 'done',
      { timeout: 90000, label: 'takeover result' });
    const res = await fetchResult(kp, env.jobId);
    check('takeover produced the result', res.body.result?.stdout?.trim() === 'slow-done');
    check('executed by the survivor', res.body.result?.executedBy === workerPeer[survivorName],
      `executedBy ${res.body.result?.executedBy?.slice(-8)} vs survivor ${String(workerPeer[survivorName]).slice(-8)}`);
  }

  log('\n▶ Scenario 6: max 4 keys per email (5th registration → 409)');
  {
    const email = 'limit@e2e.test';
    const codes = [];
    for (let i = 0; i < 4; i++) {
      const kp = generateKeypair();
      codes.push((await api('POST', '/api/register', { email, pubkey: kp.publicKey })).status);
    }
    check('first 4 keys accepted', codes.every((c) => c === 200), `statuses ${codes}`);
    const fifth = await api('POST', '/api/register', { email, pubkey: generateKeypair().publicKey });
    check('5th key rejected with 409', fifth.status === 409, `got ${fifth.status}`);
    check('rejection mentions the limit', /4 registered keys/.test(fifth.body.error || ''), fifth.body.error);
  }

  log(`\n${failures === 0 ? '✅ ALL SCENARIOS PASSED' : `❌ ${failures} CHECK(S) FAILED`}`);
}

main()
  .then(() => { cleanup(); process.exit(failures === 0 ? 0 : 1); })
  .catch((e) => { console.error('HARNESS ERROR:', e.message); cleanup(); process.exit(2); });
