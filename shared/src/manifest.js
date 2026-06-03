// Job manifest schema + validation.
//
// The manifest travels inside the job zip as manifest.json (canonical JSON).
// For WASM jobs it carries the command used to run the module; workers do NOT
// execute arbitrary commands — command[0] must be an allowed runtime and the
// invocation is spawned without a shell.

import { DEFAULT_JOB_TIMEOUT_MS, MAX_JOB_TIMEOUT_MS } from './constants.js';

export const JS_ENTRY = 'main.js';
export const WASM_ENTRY = 'module.wasm';

// Runtimes a worker is willing to spawn for type:"wasm" jobs.
export const ALLOWED_WASM_RUNTIMES = ['wasmtime'];

const ENTRY_BY_TYPE = { js: JS_ENTRY, wasm: WASM_ENTRY };

export function buildManifest({ type, args = [], timeoutMs = DEFAULT_JOB_TIMEOUT_MS, label = '' }) {
  const manifest = {
    v: 1,
    type,
    entry: ENTRY_BY_TYPE[type],
    args,
    timeoutMs,
    label,
  };
  if (type === 'wasm') {
    // The standard invocation; --dir . grants the module read/write access to
    // its (throwaway) scratch directory. Generous on purpose: the container +
    // egress firewall are the sandbox.
    manifest.command = ['wasmtime', 'run', '--dir', '.', WASM_ENTRY];
  }
  const err = validateManifest(manifest);
  if (err) throw new Error(`invalid manifest: ${err}`);
  return manifest;
}

/** Returns null if valid, else a string reason. */
export function validateManifest(m) {
  if (!m || typeof m !== 'object' || Array.isArray(m)) return 'not an object';
  if (m.v !== 1) return 'unsupported manifest version';
  if (m.type !== 'js' && m.type !== 'wasm') return 'type must be "js" or "wasm"';
  if (m.entry !== ENTRY_BY_TYPE[m.type]) return `entry must be ${ENTRY_BY_TYPE[m.type]}`;
  if (!Array.isArray(m.args) || !m.args.every((a) => typeof a === 'string')) {
    return 'args must be an array of strings';
  }
  if (m.args.length > 16) return 'too many args';
  if (m.args.some((a) => a.length > 256)) return 'arg too long';
  if (!Number.isInteger(m.timeoutMs) || m.timeoutMs <= 0 || m.timeoutMs > MAX_JOB_TIMEOUT_MS) {
    return `timeoutMs must be an integer in (0, ${MAX_JOB_TIMEOUT_MS}]`;
  }
  if (typeof m.label !== 'string' || m.label.length > 128) return 'label must be a short string';
  if (m.type === 'wasm') {
    if (!Array.isArray(m.command) || m.command.length === 0) return 'wasm manifest needs command';
    if (!m.command.every((c) => typeof c === 'string' && c.length <= 256)) {
      return 'command must be an array of short strings';
    }
    if (!ALLOWED_WASM_RUNTIMES.includes(m.command[0])) {
      return `command[0] must be one of: ${ALLOWED_WASM_RUNTIMES.join(', ')}`;
    }
    if (!m.command.includes(WASM_ENTRY)) return `command must reference ${WASM_ENTRY}`;
    if (m.command.some((c) => c.includes('..') || c.startsWith('/'))) {
      return 'command must not contain absolute paths or ..';
    }
  } else if (m.command !== undefined) {
    return 'js manifest must not set command';
  }
  return null;
}
