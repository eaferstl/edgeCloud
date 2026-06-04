// Express app: webform + HTTP↔OrbitDB bridge + key registry.
//
// The browser never joins libp2p; it signs things locally (tweetnacl) and
// talks HTTP to any central server, which injects jobs into / reads results
// out of the OrbitDB network on its behalf.

import express from 'express';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyEnvelope } from '@edgecloud/shared/envelope.js';
import { parseJobZipB64 } from '@edgecloud/shared/zip.js';
import { createAttestation, createEndorsement } from '@edgecloud/shared/trust.js';
import { isValidPubkeyB64 } from '@edgecloud/shared/crypto.js';
import { MAX_KEYS_PER_EMAIL, MAX_WORKERS_PER_EMAIL, GENESIS_SERVER_KEY } from '@edgecloud/shared/constants.js';
import { requireSession } from '../auth.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const MODULES_DIR = path.join(__dirname, '..', 'modules');

export function createApp({ q, auth, databases, indexers, heartbeats, serverKey, libp2p, config, log = console.log }) {
  const app = express();
  app.use(express.json({ limit: '6mb' }));

  // ---------- registration ----------

  // Shared registration path for both user (browser) keys and worker (node)
  // keys. They share the allowlist + attestation machinery but have SEPARATE
  // per-email Sybil caps: ≤4 user keys, ≤25 worker keys (THREAT_MODEL.md R-010).
  async function doRegister(req, res, { role, cap }) {
    const { email, pubkey } = req.body || {};
    // Workers get an email-specific hint: they must set EDGECLOUD_EMAIL. This is
    // what an old/anonymous worker hits the moment it tries to register.
    const emailHint =
      role === 'worker'
        ? 'this worker is out of date: pull the latest Dockerfile and set EDGECLOUD_EMAIL to your Edge Esmeralda attendee email'
        : 'invalid email';
    if (typeof email !== 'string' || !email.includes('@')) {
      return res.status(400).json({ error: emailHint });
    }
    if (!isValidPubkeyB64(pubkey)) {
      return res.status(400).json({ error: 'invalid public key' });
    }
    if (!q.emailAllowed(email)) {
      return res.status(403).json({
        error:
          role === 'worker'
            ? 'EDGECLOUD_EMAIL is not on the Edge Esmeralda attendee list'
            : 'email is not on the Edge Esmeralda attendee list',
      });
    }
    const emailHmac = q.emailHmacOf(email);
    if (q.isRegisteredKey(pubkey)) {
      // idempotent re-register of the same key
      return res.json({ ok: true, alreadyRegistered: true });
    }
    if (q.keyCountForHmac(emailHmac, role) >= cap) {
      return res.status(409).json({ error: `this email already has the maximum of ${cap} ${role} keys` });
    }
    // Attest + publish to OrbitDB (pubkey + emailHmac only — never the email).
    // `role` rides along as advisory metadata (not part of the signed message,
    // so legacy verifiers/attestations are unaffected).
    const entry = createAttestation({
      pubkey,
      emailHmac,
      serverPublicKeyB64: serverKey.publicKey,
      serverSecretKeyB64: serverKey.secretKey,
    });
    entry.role = role;
    await databases.registry.add(entry);
    q.upsertRegisteredKey(pubkey, emailHmac, entry.addedAt, role);
    log(`[register] new ${role} key ${pubkey.slice(0, 12)}… (${q.keyCountForHmac(emailHmac, role)}/${cap} for this email)`);
    res.json({ ok: true });
  }

  app.post('/api/register', (req, res) => doRegister(req, res, { role: 'user', cap: MAX_KEYS_PER_EMAIL }));

  // Worker-node registration: a worker proves it belongs to an allowlisted
  // attendee before it can win claims (≤25 worker nodes per email).
  app.post('/api/register-worker', (req, res) =>
    doRegister(req, res, { role: 'worker', cap: MAX_WORKERS_PER_EMAIL })
  );

  // Worker fallback for the registry-grace path.
  app.get('/api/registry/:pubkey', (req, res) => {
    res.json({ registered: q.isRegisteredKey(req.params.pubkey) });
  });

  // ---------- challenge/response auth ----------

  app.get('/api/challenge', (req, res) => {
    const nonce = auth.issueChallenge(req.query.pubkey);
    if (!nonce) return res.status(400).json({ error: 'invalid pubkey' });
    res.json({ nonce });
  });

  app.post('/api/auth/verify', (req, res) => {
    const { pubkey, nonce, sig } = req.body || {};
    const token = auth.verifyChallenge(pubkey, nonce, sig);
    if (!token) return res.status(401).json({ error: 'challenge verification failed' });
    res.json({ token });
  });

  // ---------- jobs ----------

  app.post('/api/jobs', async (req, res) => {
    const env = req.body;
    const envErr = verifyEnvelope(env);
    if (envErr) return res.status(400).json({ error: `invalid envelope: ${envErr}` });
    try {
      parseJobZipB64(env.zipB64); // structural + manifest validation
    } catch (e) {
      return res.status(400).json({ error: `invalid job payload: ${e.message}` });
    }
    if (!q.isRegisteredKey(env.pubkey)) {
      return res.status(403).json({ error: 'public key is not registered' });
    }
    // Count every accepted submission (incl. duplicate/cached resubmissions) toward
    // the public "jobs submitted" score, before any cache/dedup short-circuit. The
    // new total rides back on every response so the pill can update instantly.
    q.bumpSubmissions();
    q.addJobSubmitter(env.jobId, env.pubkey, env.submittedAt ?? Date.now());
    const jobsSubmitted = q.submissionCount();

    // Duplicate submission == cache hit: answer immediately, execute nothing.
    const cached = q.getCachedResult(env.jobId);
    if (cached) {
      return res.json({ jobId: env.jobId, status: 'done', cached: true, result: cached, jobsSubmitted });
    }
    if (q.jobSeen(env.jobId) && (await alreadyQueued(databases, env.jobId))) {
      return res.json({ jobId: env.jobId, status: 'queued', cached: false, jobsSubmitted });
    }
    await databases.jobs.add(env);
    log(`[jobs] queued ${env.jobId.slice(0, 12)}… from ${env.pubkey.slice(0, 12)}…`);
    res.json({ jobId: env.jobId, status: 'queued', cached: false, jobsSubmitted });
  });

  app.get('/api/jobs/:jobId/status', (req, res) => {
    const { jobId } = req.params;
    if (q.getCachedResult(jobId)) return res.json({ jobId, status: 'done' });
    if (q.jobSeen(jobId)) return res.json({ jobId, status: 'queued' });
    res.json({ jobId, status: 'unknown' });
  });

  app.get('/api/jobs/:jobId/result', requireSession(auth), (req, res) => {
    const { jobId } = req.params;
    if (!q.isJobSubmitter(jobId, req.pubkey)) {
      return res.status(403).json({ error: 'this key did not submit that job' });
    }
    const result = q.getCachedResult(jobId);
    if (!result) return res.status(202).json({ jobId, status: q.jobSeen(jobId) ? 'queued' : 'unknown' });
    res.json({ jobId, status: 'done', result });
  });

  // ---------- example WASM modules ----------

  app.get('/api/modules', (req, res) => {
    const manifestPath = path.join(MODULES_DIR, 'modules.json');
    if (!fs.existsSync(manifestPath)) return res.json({ modules: [] });
    res.json({ modules: JSON.parse(fs.readFileSync(manifestPath, 'utf8')) });
  });

  app.get('/api/modules/:name', (req, res) => {
    const name = path.basename(req.params.name); // no traversal
    if (!name.endsWith('.wasm')) return res.status(404).end();
    const file = path.join(MODULES_DIR, name);
    if (!fs.existsSync(file)) return res.status(404).end();
    res.type('application/wasm').send(fs.readFileSync(file));
  });

  // ---------- network info / status ----------

  app.get('/api/dbinfo', (req, res) => {
    res.json({
      peerId: libp2p.peerId.toString(),
      multiaddrs: libp2p.getMultiaddrs().map((m) => m.toString()),
      publicMultiaddrs: config.publicMultiaddrs,
      serverPubkey: serverKey.publicKey,
      genesisKey: GENESIS_SERVER_KEY,
      databases: Object.fromEntries(
        Object.entries(databases).map(([k, db]) => [k, db.address.toString()])
      ),
    });
  });

  app.get('/api/status', (req, res) => {
    res.json({
      workersOnline: heartbeats.count(),
      workers: heartbeats.online(),
      devices: heartbeats.devices(), // capability records (cpu/ram/storage/capacity)
      fleetAvailableCapacity: heartbeats.totalAvailableCapacity(),
      registeredKeys: q.registeredKeyCount(),
      jobsSubmitted: q.submissionCount(),
      allowlistedEmails: q.allowlistCount(),
      cachedResults: q.cachedResultCount(),
      trustedServers: indexers.state.trustedServers.size,
      // live execution map: recent "who ran what", newest first
      recentExecutions: q.recentResults(24),
    });
  });

  // ---------- admin (localhost only): endorse another central server ----------

  app.post('/api/admin/endorse', async (req, res) => {
    const remote = req.socket.remoteAddress || '';
    if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(remote)) {
      return res.status(403).json({ error: 'admin endpoints are localhost-only' });
    }
    const { serverPubkey, multiaddrs = [], label = '' } = req.body || {};
    if (!isValidPubkeyB64(serverPubkey)) return res.status(400).json({ error: 'invalid serverPubkey' });
    const entry = createEndorsement({
      serverPubkey,
      multiaddrs,
      label,
      endorserPublicKeyB64: serverKey.publicKey,
      endorserSecretKeyB64: serverKey.secretKey,
    });
    await databases.servers.add(entry);
    await indexers.fullRescan();
    log(`[admin] endorsed server ${serverPubkey.slice(0, 12)}… (${label})`);
    res.json({ ok: true, entry });
  });

  // ---------- static frontend ----------
  app.use(express.static(PUBLIC_DIR));

  return app;
}

async function alreadyQueued(databases, jobId) {
  for await (const entry of databases.jobs.iterator()) {
    if (entry?.value?.jobId === jobId) return true;
  }
  return false;
}
