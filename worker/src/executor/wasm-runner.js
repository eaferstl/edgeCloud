// Runs a WASM job under wasmtime.
//
// SECURITY: we do NOT trust manifest.command. A malicious manifest could set
// command to e.g. ["wasmtime","run","--dir=/data",...] or enable WASI
// networking. Instead the worker constructs the entire wasmtime argv here from
// hardcoded, locked-down flags; only manifest.args (validated strings) are
// passed through — and those go to the GUEST program as argv, not to wasmtime.
//
// wasmtime is itself a strong sandbox (WASI capability model), and we further:
//   - grant exactly one preopened dir (the scratch dir), nothing else;
//   - disable WASI network + env inheritance;
//   - cap linear memory.
// The process also runs as the unprivileged sandbox uid (no /data, no network).

import { config } from '../config.js';
import { runSandboxed, runProcess } from './js-runner.js';

const WASM_MAX_MEMORY_BYTES = 256 * 1024 * 1024; // 256 MiB linear memory cap

export function runWasm(manifest, cwd, timeoutMs) {
  // Hardened, worker-controlled wasmtime invocation. manifest.command is ignored.
  const wasmtimeArgs = [
    'run',
    '-C', 'cache=n', // no compile cache (the sandbox uid can't write one; not needed for one-shot)
    '-W', `max-memory-size=${WASM_MAX_MEMORY_BYTES}`,
    '-S', 'inherit-network=n',
    '-S', 'inherit-env=n',
    '--dir', `${cwd}::/`, // only the scratch dir is visible to the guest
    `${cwd}/module.wasm`,
    ...manifest.args, // guest program argv (validated strings)
  ];
  if (config.sandboxUid) {
    return runSandboxed('wasmtime', wasmtimeArgs, cwd, timeoutMs);
  }
  // local-dev fallback (non-root): run wasmtime directly
  return runProcess('wasmtime', wasmtimeArgs, cwd, timeoutMs, { detached: true });
}
