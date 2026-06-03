// Challenge/response auth: the server hands out a random nonce; the browser
// signs it with the user's Ed25519 key; a verified signature mints a
// short-lived bearer session bound to that pubkey. Challenges and sessions
// are deliberately in-memory only — they are per-server ephemera, consistent
// with servers holding no unique durable state.

import { randomB64, verifyDetachedB64, isValidPubkeyB64 } from '@edgecloud/shared/crypto.js';
import { CHALLENGE_TTL_MS, SESSION_TTL_MS } from '@edgecloud/shared/constants.js';

export function createAuth() {
  const challenges = new Map(); // nonce -> { pubkey, expiresAt }
  const sessions = new Map(); // token -> { pubkey, expiresAt }

  setInterval(() => {
    const now = Date.now();
    for (const [k, v] of challenges) if (v.expiresAt < now) challenges.delete(k);
    for (const [k, v] of sessions) if (v.expiresAt < now) sessions.delete(k);
  }, 60000).unref();

  return {
    issueChallenge(pubkey) {
      if (!isValidPubkeyB64(pubkey)) return null;
      const nonce = randomB64(32);
      challenges.set(nonce, { pubkey, expiresAt: Date.now() + CHALLENGE_TTL_MS });
      return nonce;
    },

    /** Verify a signed nonce; consumes the challenge. Returns a session token or null. */
    verifyChallenge(pubkey, nonce, sig) {
      const ch = challenges.get(nonce);
      if (!ch) return null;
      challenges.delete(nonce); // single-use regardless of outcome
      if (ch.expiresAt < Date.now()) return null;
      if (ch.pubkey !== pubkey) return null;
      if (!verifyDetachedB64(nonce, sig, pubkey)) return null;
      const token = randomB64(32);
      sessions.set(token, { pubkey, expiresAt: Date.now() + SESSION_TTL_MS });
      return token;
    },

    /** Returns the session's pubkey or null. */
    sessionPubkey(token) {
      const s = sessions.get(token);
      if (!s || s.expiresAt < Date.now()) return null;
      return s.pubkey;
    },
  };
}

/** Express middleware: requires `Authorization: Bearer <token>`; sets req.pubkey. */
export function requireSession(auth) {
  return (req, res, next) => {
    const m = /^Bearer (.+)$/.exec(req.headers.authorization || '');
    const pubkey = m && auth.sessionPubkey(m[1]);
    if (!pubkey) return res.status(401).json({ error: 'invalid or expired session' });
    req.pubkey = pubkey;
    next();
  };
}
