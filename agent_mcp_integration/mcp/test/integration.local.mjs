// Local integration test for the agent MCP client.
//
// Boots a real central server + two real workers (same pattern as
// scripts/e2e-local.mjs: temp data dirs, test allowlist *@e2e.test, the server's
// own key as genesis), then drives the full flow through EdgeCloudClient — the
// exact code the MCP tools call. No mocks.
//
//   node agent_mcp_integration/mcp/test/integration.local.mjs
//
// Exits 0 on success, non-zero on any failed check.

import { spawn } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { generateKeypair } from '@edgecloud/shared/crypto.js';
import { EdgeCloudClient } from '../src/client.js';
import { Keystore } from '../src/keystore.js';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
const NODE = process.execPath;
const SALT = 'agent-mcp-itest-salt';
const HTTP = 18191, TCP = 14192, WS = 14193;
const BASE = `http://127.0.0.1:${HTTP}`;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ec-mcp-itest-'));
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
function startProc(name, args, env) {
  const p = spawn(NODE, args, { cwd: REPO, env: { ...process.env, ...env } });
  if (process.env.ITEST_VERBOSE) {
    let buf = '';
    const handle = (d) => {
      buf += d.toString();
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i); buf = buf.slice(i + 1);
        if (/claim|execut|job|result|error|register|registry/i.test(line)) console.log(`    [${name}] ${line}`);
      }
    };
    p.stdout.on('data', handle);
    p.stderr.on('data', handle);
  }
  procs.push({ name, p });
  return p;
}
function cleanup() {
  for (const { p } of procs) { try { p.kill('SIGKILL'); } catch {} }
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
}
process.on('exit', cleanup);
process.on('SIGINT', () => { cleanup(); process.exit(130); });

async function getJson(p) {
  const res = await fetch(BASE + p);
  return res.json().catch(() => ({}));
}

async function main() {
  // genesis = the server's own key, pre-generated so workers trust it.
  const serverKey = generateKeypair();
  const serverData = path.join(tmp, 'server');
  fs.mkdirSync(serverData, { recursive: true });
  fs.writeFileSync(path.join(serverData, 'server-key.json'), JSON.stringify(serverKey), { mode: 0o600 });
  const GENESIS = serverKey.publicKey;

  // Seed + import an allowlist (the same emails workers/clients use).
  const csv = path.join(tmp, 'attendees.csv');
  fs.writeFileSync(csv, 'First,Last,Email\n' + ['agent', 'other', 'w1', 'w2'].map((x) => `T,U,${x}@e2e.test`).join('\n') + '\n');
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
  await waitFor(async () => (await fetch(BASE + '/api/status')).status === 200, { label: 'server HTTP' });

  const info = await getJson('/api/dbinfo');
  const wsAddr = info.multiaddrs.find((m) => m.includes('/ws') && m.includes('127.0.0.1'));
  if (!wsAddr) throw new Error('no loopback ws multiaddr from /api/dbinfo');

  log('▶ booting 2 workers…');
  for (const id of ['w1', 'w2']) {
    const wd = path.join(tmp, id);
    fs.mkdirSync(wd, { recursive: true });
    startProc(id, ['worker/src/index.js'], {
      EDGECLOUD_DATA: wd, EDGECLOUD_GENESIS_KEY: GENESIS, RENDEZVOUS_MULTIADDR: wsAddr,
      EDGECLOUD_HTTP_FALLBACK: BASE, EDGECLOUD_SKIP_FIREWALL: '1', EDGECLOUD_EMAIL: `${id}@e2e.test`,
    });
  }
  await waitFor(async () => (await getJson('/api/status')).workersOnline >= 2,
    { timeout: 90000, label: '2 workers online' });

  // ---- drive the MCP client (the exact code path the tools use) ----
  const keysFile = path.join(tmp, 'agent-keys.json');
  const agent = new EdgeCloudClient({ baseUrl: BASE, email: 'agent@e2e.test', keystore: new Keystore({ file: keysFile }) });

  log('\n▶ edgecloud_status');
  const status = await agent.networkStatus();
  check('status reports >= 2 workers online', status.workersOnline >= 2, `got ${status.workersOnline}`);

  // On a freshly-booted local network the jobs-DB gossipsub mesh may not be grafted
  // when an append lands, so a fresh job can be missed until OrbitDB re-syncs (a
  // pre-existing network property — R-011 class; a non-issue on the long-running
  // live server). We make each execution-dependent check resilient by retrying with
  // a DISTINCT jobId: appending a `/* nonce */` comment changes the zip bytes (→ new
  // head → another graft chance) WITHOUT changing the program's stdout.
  async function robustRun(label, baseCode, { attempts = 10, waitMs = 30_000 } = {}) {
    for (let i = 0; i < attempts; i++) {
      const code = `${baseCode} /* ${label} ${i} */`;
      const r = await agent.run({ type: 'js', code }, { waitMs });
      if (r.status === 'done') return { ...r, code };
      log(`    ${label} attempt ${i}: ${r.status}`);
    }
    return null;
  }

  log('\n▶ edgecloud_run (js, await) — 6 * 7');
  const run1 = await robustRun('mul', '6 * 7');
  check('status done', run1?.status === 'done');
  check('stdout is 42', run1?.result?.stdout?.trim() === '42', `got ${JSON.stringify(run1?.result?.stdout)}`);
  check('executed by a worker', typeof run1?.result?.executedBy === 'string');

  log('\n▶ keystore reuse — resubmitting the SAME code is a cache hit, no new key');
  const before = JSON.parse(fs.readFileSync(keysFile, 'utf8'));
  const run2 = await agent.run({ type: 'js', code: run1.code }); // identical code → same jobId → cache
  const after = JSON.parse(fs.readFileSync(keysFile, 'utf8'));
  check('duplicate is a cache hit', run2.cached === true && run2.status === 'done', JSON.stringify(run2).slice(0, 120));
  check('no new key minted', Object.keys(before).length === Object.keys(after).length);

  log('\n▶ console.log passthrough');
  const run3 = await robustRun('log', 'console.log("hello from agent " + (1+1))');
  check('stdout passthrough', run3?.result?.stdout?.trim() === 'hello from agent 2', `got ${JSON.stringify(run3?.result?.stdout)}`);

  log('\n▶ result privacy — another attendee cannot read this job');
  const stranger = new EdgeCloudClient({ baseUrl: BASE, email: 'other@e2e.test', keystore: new Keystore({ file: path.join(tmp, 'stranger-keys.json') }) });
  await stranger.ensureRegistered();
  let denied = false;
  try {
    await stranger.fetchResult(run1.jobId);
  } catch (e) {
    denied = /403|did not submit/.test(e.message);
  }
  check('stranger is denied (403)', denied);

  log(`\n${failures === 0 ? '✅ ALL CHECKS PASSED' : `❌ ${failures} CHECK(S) FAILED`}`);
}

main()
  .then(() => { cleanup(); process.exit(failures === 0 ? 0 : 1); })
  .catch((e) => { console.error('HARNESS ERROR:', e.stack || e.message); cleanup(); process.exit(2); });
