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
      added_at   INTEGER NOT NULL
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
  `);
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
        'INSERT OR IGNORE INTO registered_keys (pubkey, email_hmac, added_at) VALUES (?, ?, ?)'
      );
      return (pubkey, emailHmac, addedAt) => stmt.run(pubkey, emailHmac, addedAt).changes > 0;
    })(),
    keyCountForHmac: (emailHmac) =>
      db.prepare('SELECT COUNT(*) c FROM registered_keys WHERE email_hmac = ?').get(emailHmac).c,
    isRegisteredKey: (pubkey) =>
      !!db.prepare('SELECT 1 FROM registered_keys WHERE pubkey = ?').get(pubkey),
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
  };
}
