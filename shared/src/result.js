// Result envelope: written by the executing worker to the edgecloud-results
// documents DB (indexBy jobId, so duplicates collapse to one logical entry).

import { MAX_OUTPUT_BYTES } from './constants.js';

export function buildResult({ jobId, stdout, stderr, exitCode, error = null, executedBy, startedAt }) {
  return {
    v: 1,
    jobId,
    stdout: truncate(stdout),
    stderr: truncate(stderr),
    exitCode: Number.isInteger(exitCode) ? exitCode : -1,
    ok: exitCode === 0 && !error,
    error,
    executedBy,
    startedAt,
    timestamp: Date.now(),
  };
}

/** Returns null if plausible, else a reason. (Results are advisory, not signed.) */
export function validateResult(r) {
  if (!r || typeof r !== 'object') return 'not an object';
  if (r.v !== 1) return 'unsupported result version';
  if (typeof r.jobId !== 'string' || !/^[0-9a-f]{64}$/.test(r.jobId)) return 'malformed jobId';
  if (typeof r.stdout !== 'string' || typeof r.stderr !== 'string') return 'missing output';
  if (typeof r.executedBy !== 'string') return 'missing executedBy';
  return null;
}

function truncate(s) {
  const str = typeof s === 'string' ? s : '';
  return str.length > MAX_OUTPUT_BYTES ? str.slice(0, MAX_OUTPUT_BYTES) + '\n…[truncated]' : str;
}
