// Result envelope: written by the executing worker to the edgecloud-results
// documents DB (indexBy jobId, so duplicates collapse to one logical entry).
//
// SIGNED RESULTS (THREAT_MODEL.md R-003): the results DB is open-write, so any
// participant could otherwise forge a result for a jobId and have it served to
// the user (first-result-wins). Each result is now SIGNED by the executing
// worker's identity key (executedBy = the worker's base64 Ed25519 public key);
// the server verifies the signature before caching/serving and workers verify
// before treating a result as "already done". This proves the result came from
// the worker that holds that key — closing THIRD-PARTY forgery and enabling
// attribution/reputation. It does NOT (yet) stop a worker signing a *wrong*
// answer with its own key; that needs redundant execution / agreement /
// reputation (see ROADMAP.md §B + THREAT_MODEL "Potential improvements").

import { MAX_OUTPUT_BYTES } from './constants.js';
import { canonicalJson } from './canonical.js';
import { signDetachedB64, verifyDetachedB64, isValidPubkeyB64 } from './crypto.js';

// Sign/verify over the canonical form of the result, excluding the signature
// itself and the OrbitDB-added `_id`.
function resultMessage(r) {
  const { sig: _sig, _id: _ignore, ...rest } = r;
  return canonicalJson(rest);
}

export function buildResult({ jobId, stdout, stderr, exitCode, error = null, executedBy, startedAt, secretKeyB64 }) {
  const r = {
    v: 1,
    jobId,
    stdout: truncate(stdout),
    stderr: truncate(stderr),
    exitCode: Number.isInteger(exitCode) ? exitCode : -1,
    ok: exitCode === 0 && !error,
    error,
    executedBy, // the worker's base64 Ed25519 identity (its public key)
    startedAt,
    timestamp: Date.now(),
  };
  if (secretKeyB64) r.sig = signDetachedB64(resultMessage(r), secretKeyB64);
  return r;
}

/** Structural validation only (no signature check). */
export function validateResult(r) {
  if (!r || typeof r !== 'object') return 'not an object';
  if (r.v !== 1) return 'unsupported result version';
  if (typeof r.jobId !== 'string' || !/^[0-9a-f]{64}$/.test(r.jobId)) return 'malformed jobId';
  if (typeof r.stdout !== 'string' || typeof r.stderr !== 'string') return 'missing output';
  if (typeof r.executedBy !== 'string') return 'missing executedBy';
  return null;
}

/** Full verification: structure + signature by `executedBy` (the worker's key). */
export function verifyResult(r) {
  const shape = validateResult(r);
  if (shape) return shape;
  if (!isValidPubkeyB64(r.executedBy)) return 'executedBy is not a public key';
  if (typeof r.sig !== 'string') return 'missing result signature';
  if (!verifyDetachedB64(resultMessage(r), r.sig, r.executedBy)) return 'bad result signature';
  return null;
}

function truncate(s) {
  const str = typeof s === 'string' ? s : '';
  return str.length > MAX_OUTPUT_BYTES ? str.slice(0, MAX_OUTPUT_BYTES) + '\n…[truncated]' : str;
}
