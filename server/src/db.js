// SQLite layer. IMPORTANT INVARIANT: every table here is a rebuildable local
// cache/index — deleting the .db file loses nothing that (attendee CSV +
// SHARED_SALT + OrbitDB replication) cannot reconstruct. This is what keeps
// central servers interchangeable. Raw emails live ONLY in `allowlist` and
// never leave this process.

import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { hmacSha256Hex } from '@edgecloud/shared/crypto.js';

export function openDb(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const db = new Database(path.join(dataDir, 'edgecloud.db'));
  db.pragma('journal_mode = WAL');
  db.exec(`
    CREATE TABLE IF NOT EXISTS allowlist (
      email      TEXT PRIMARY KEY,           -- normalized lowercase
      email_hmac TEXT UNIQUE NOT NULL
    );
    CREATE TABLE IF NOT EXISTS registered_keys (   -- index over edgecloud-registry
      pubkey     TEXT PRIMARY KEY,
      email_hmac TEXT NOT NULL,
      added_at   INTEGER NOT NULL,
      role       TEXT NOT NULL DEFAULT 'user'  -- 'user' (browser) | 'worker' (node)
    );
    CREATE INDEX IF NOT EXISTS idx_regkeys_hmac ON registered_keys(email_hmac);
    CREATE TABLE IF NOT EXISTS job_submitters (    -- index over edgecloud-jobs
      job_id       TEXT NOT NULL,
      pubkey       TEXT NOT NULL,
      submitted_at INTEGER NOT NULL,
      PRIMARY KEY (job_id, pubkey)
    );
    CREATE TABLE IF NOT EXISTS result_cache (      -- index over edgecloud-results
      job_id      TEXT PRIMARY KEY,
      result_json TEXT NOT NULL,
      cached_at   INTEGER NOT NULL
    );
    -- Local tallies. NOT rebuildable from OrbitDB (every submission, including
    -- duplicate/cached resubmissions, is counted — and the CRDT dedupes those),
    -- so this is intentionally per-server, best-effort display state.
    CREATE TABLE IF NOT EXISTS counters (
      name  TEXT PRIMARY KEY,
      value INTEGER NOT NULL DEFAULT 0
    );
  `);
  // Migration for DBs created before the role column existed (it's a rebuildable
  // cache, but ALTER avoids a forced wipe). Defaults existing rows to 'user'.
  try {
    db.exec("ALTER TABLE registered_keys ADD COLUMN role TEXT NOT NULL DEFAULT 'user'");
  } catch {
    /* column already exists */
  }
  return db;
}

export function makeQueries(db, sharedSalt) {
  return {
    // --- allowlist ---
    importAllowlistEmail: (() => {
      const stmt = db.prepare('INSERT OR IGNORE INTO allowlist (email, email_hmac) VALUES (?, ?)');
      return (email) => {
        const norm = email.trim().toLowerCase();
        if (!norm) return false;
        return stmt.run(norm, hmacSha256Hex(norm, sharedSalt)).changes > 0;
      };
    })(),
    allowlistCount: () => db.prepare('SELECT COUNT(*) c FROM allowlist').get().c,
    emailAllowed: (email) =>
      !!db.prepare('SELECT 1 FROM allowlist WHERE email = ?').get(email.trim().toLowerCase()),
    emailHmacKnown: (emailHmac) =>
      !!db.prepare('SELECT 1 FROM allowlist WHERE email_hmac = ?').get(emailHmac),
    emailHmacOf: (email) => hmacSha256Hex(email.trim().toLowerCase(), sharedSalt),

    // --- registered keys index ---
    upsertRegisteredKey: (() => {
      const stmt = db.prepare(
        'INSERT OR IGNORE INTO registered_keys (pubkey, email_hmac, added_at, role) VALUES (?, ?, ?, ?)'
      );
      return (pubkey, emailHmac, addedAt, role = 'user') =>
        stmt.run(pubkey, emailHmac, addedAt, role === 'worker' ? 'worker' : 'user').changes > 0;
    })(),
    // Per-email key count, scoped by role: 'user' keys (browser, ≤4) and
    // 'worker' keys (nodes, ≤25) have separate Sybil caps.
    keyCountForHmac: (emailHmac, role = 'user') =>
      db
        .prepare('SELECT COUNT(*) c FROM registered_keys WHERE email_hmac = ? AND role = ?')
        .get(emailHmac, role === 'worker' ? 'worker' : 'user').c,
    isRegisteredKey: (pubkey) =>
      !!db.prepare('SELECT 1 FROM registered_keys WHERE pubkey = ?').get(pubkey),
    // Is this key a registered WORKER (role='worker')? Used to refuse results
    // from unregistered/old workers — a worker must register with its email.
    isRegisteredWorkerKey: (pubkey) =>
      !!db.prepare("SELECT 1 FROM registered_keys WHERE pubkey = ? AND role = 'worker'").get(pubkey),
    registeredKeyCount: () => db.prepare('SELECT COUNT(*) c FROM registered_keys').get().c,

    // --- job submitters index ---
    addJobSubmitter: (() => {
      const stmt = db.prepare(
        'INSERT OR IGNORE INTO job_submitters (job_id, pubkey, submitted_at) VALUES (?, ?, ?)'
      );
      return (jobId, pubkey, ts) => stmt.run(jobId, pubkey, ts).changes > 0;
    })(),
    isJobSubmitter: (jobId, pubkey) =>
      !!db.prepare('SELECT 1 FROM job_submitters WHERE job_id = ? AND pubkey = ?').get(jobId, pubkey),
    jobSeen: (jobId) =>
      !!db.prepare('SELECT 1 FROM job_submitters WHERE job_id = ? LIMIT 1').get(jobId),
    // Distinct jobs ever submitted (rebuilt from edgecloud-jobs) — used only to
    // seed the submissions tally with a sensible baseline on first boot.
    jobCount: () => db.prepare('SELECT COUNT(DISTINCT job_id) c FROM job_submitters').get().c,
    // Total job SUBMISSIONS, counting every accepted POST including duplicate /
    // cached resubmissions (the user-facing "score"). See the counters table note.
    bumpSubmissions: () =>
      db
        .prepare(
          "INSERT INTO counters(name, value) VALUES('submissions', 1) " +
            'ON CONFLICT(name) DO UPDATE SET value = value + 1'
        )
        .run(),
    submissionCount: () => {
      const r = db.prepare("SELECT value v FROM counters WHERE name = 'submissions'").get();
      return r ? r.v : 0;
    },
    // One-time baseline so the score doesn't start at 0 (no-op once it exists).
    seedSubmissions: (n) =>
      db.prepare("INSERT OR IGNORE INTO counters(name, value) VALUES('submissions', ?)").run(n),

    // --- result cache ---
    cacheResult: (() => {
      const stmt = db.prepare(
        'INSERT OR REPLACE INTO result_cache (job_id, result_json, cached_at) VALUES (?, ?, ?)'
      );
      return (jobId, resultJson) => stmt.run(jobId, resultJson, Date.now());
    })(),
    getCachedResult: (jobId) => {
      const row = db.prepare('SELECT result_json FROM result_cache WHERE job_id = ?').get(jobId);
      return row ? JSON.parse(row.result_json) : null;
    },
    cachedResultCount: () => db.prepare('SELECT COUNT(*) c FROM result_cache').get().c,
    // Most-recent completed executions, for the live execution map: who ran what,
    // newest first. cached_at ≈ when the result reached this server.
    recentResults: (limit = 24) =>
      db
        .prepare('SELECT job_id, result_json, cached_at FROM result_cache ORDER BY cached_at DESC LIMIT ?')
        .all(limit)
        .map((row) => {
          let r = {};
          try {
            r = JSON.parse(row.result_json);
          } catch {
            /* leave blank */
          }
          return { jobId: row.job_id, executedBy: r.executedBy ?? null, ok: r.ok ?? null, ts: row.cached_at };
        }),
  };
}
