// Runs a WASM job via the manifest's command (validated: command[0] must be
// an allowed runtime, no shell involved, paths confined to the scratch dir).
// WASI permissions are deliberately generous (--dir .): the Docker container
// and its egress firewall are the sandbox, not WASI.

import { ALLOWED_WASM_RUNTIMES } from '@edgecloud/shared/manifest.js';
import { runProcess } from './js-runner.js';

export function runWasm(manifest, cwd, timeoutMs) {
  const [cmd, ...argv] = manifest.command;
  if (!ALLOWED_WASM_RUNTIMES.includes(cmd)) {
    return Promise.resolve({
      stdout: '',
      stderr: `runtime not allowed: ${cmd}`,
      exitCode: -1,
      error: 'runtime_not_allowed',
      startedAt: Date.now(),
    });
  }
  return runProcess(cmd, [...argv, ...manifest.args], cwd, timeoutMs);
}
