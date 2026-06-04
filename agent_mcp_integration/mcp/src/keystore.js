// Key custody for the agent.
//
// The agent's identity is an Ed25519 keypair (tweetnacl format, base64). Whoever
// holds the SECRET key can read that agent's results, so this file must live
// inside the attendee's own trust boundary (see R-012 in
// ../../04_decisions_risks_cuts.md). We persist one keypair per (server, email)
// tag so repeated runs reuse the same registered key instead of burning the
// 4-keys-per-email quota (mirrors scripts/e2e-client.mjs:19-28).
//
// Session tokens are NEVER persisted — they live only in memory for their 30-min
// TTL and are re-minted via challenge/response when missing or stale.

import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { generateKeypair } from '@edgecloud/shared/crypto.js';
import { SESSION_TTL_MS } from '@edgecloud/shared/constants.js';

function defaultKeystorePath() {
  return process.env.EDGECLOUD_KEYSTORE || path.join(os.homedir(), '.edgecloud', 'keys.json');
}

export class Keystore {
  /** @param {{ file?: string }} [opts] */
  constructor({ file } = {}) {
    this.file = file || defaultKeystorePath();
    this._sessions = new Map(); // tag -> { token, expiresAt }
  }

  _readAll() {
    try {
      return JSON.parse(fs.readFileSync(this.file, 'utf8'));
    } catch {
      return {};
    }
  }

  _writeAll(obj) {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    // 0600: only the owning attendee can read the secret keys.
    fs.writeFileSync(this.file, JSON.stringify(obj, null, 2), { mode: 0o600 });
    try {
      fs.chmodSync(this.file, 0o600);
    } catch {
      /* best effort on platforms without chmod semantics */
    }
  }

  /**
   * Return the persisted keypair for this (server, email), generating + saving
   * one on first use. `{ publicKey, secretKey }` as base64 strings.
   */
  keypairFor(tag) {
    const all = this._readAll();
    if (!all[tag]) {
      all[tag] = generateKeypair();
      this._writeAll(all);
    }
    return all[tag];
  }

  /** Cached, non-expired session token for this tag, or null. */
  getSession(tag) {
    const s = this._sessions.get(tag);
    if (s && s.expiresAt > Date.now()) return s.token;
    return null;
  }

  /** Cache a freshly minted session token (TTL slightly under the server's). */
  setSession(tag, token) {
    this._sessions.set(tag, { token, expiresAt: Date.now() + SESSION_TTL_MS - 30_000 });
  }
}

export function tagFor(baseUrl, email) {
  return `${baseUrl}|${email}`;
}
