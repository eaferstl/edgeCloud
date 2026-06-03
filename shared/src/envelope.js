// Job envelope: the signed unit that travels browser -> server -> OrbitDB ->
// workers.
//
//   jobId = sha256hex(utf8(zipB64))          — identity of the job
//   sig   = Ed25519(secretKey, utf8(jobId))  — checked FIRST, before unzipping
//
// nonce/submittedAt are informational and deliberately NOT part of jobId:
// identical code yields an identical jobId, so a resubmission is a cache hit
// (the cached result is returned; nothing re-executes). Result retrieval is
// gated separately by challenge/response.

import { sha256Hex, signDetachedB64, verifyDetachedB64, isValidPubkeyB64, randomB64 } from './crypto.js';
import { MAX_ZIP_B64_BYTES } from './constants.js';

export function jobIdOf(zipB64) {
  return sha256Hex(zipB64);
}

export function createEnvelope({ zipB64, publicKeyB64, secretKeyB64 }) {
  const jobId = jobIdOf(zipB64);
  return {
    v: 1,
    jobId,
    zipB64,
    pubkey: publicKeyB64,
    sig: signDetachedB64(jobId, secretKeyB64),
    submittedAt: Date.now(),
    nonce: randomB64(16),
  };
}

/**
 * Structural + cryptographic validation (does NOT check registry membership).
 * Returns null if valid, else a string reason.
 */
export function verifyEnvelope(env) {
  if (!env || typeof env !== 'object') return 'not an object';
  if (env.v !== 1) return 'unsupported envelope version';
  if (typeof env.zipB64 !== 'string' || env.zipB64.length === 0) return 'missing zipB64';
  if (env.zipB64.length > MAX_ZIP_B64_BYTES) return 'zipB64 too large';
  if (typeof env.jobId !== 'string' || !/^[0-9a-f]{64}$/.test(env.jobId)) return 'malformed jobId';
  if (!isValidPubkeyB64(env.pubkey)) return 'malformed pubkey';
  if (typeof env.sig !== 'string') return 'missing sig';
  // Signature first — cheap rejection before touching the payload.
  if (!verifyDetachedB64(env.jobId, env.sig, env.pubkey)) return 'bad signature';
  if (jobIdOf(env.zipB64) !== env.jobId) return 'jobId does not match payload';
  return null;
}
