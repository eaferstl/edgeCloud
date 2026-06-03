// Runs a JS job in a child Node process with a hard timeout and output caps.
// The container (plus its private-IP egress firewall) is the sandbox; the
// child still gets a minimal environment and its own scratch cwd.

import { spawn } from 'node:child_process';
import { MAX_OUTPUT_BYTES } from '@edgecloud/shared/constants.js';

export function runJs(entryPath, cwd, timeoutMs) {
  return runProcess(process.execPath, [entryPath], cwd, timeoutMs);
}

export function runProcess(cmd, argv, cwd, timeoutMs) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(cmd, argv, {
      cwd,
      env: { PATH: process.env.PATH }, // no inherited secrets/config
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const cap = (s, chunk) =>
      s.length >= MAX_OUTPUT_BYTES ? s : s + chunk.toString('utf8').slice(0, MAX_OUTPUT_BYTES - s.length);
    child.stdout.on('data', (c) => (stdout = cap(stdout, c)));
    child.stderr.on('data', (c) => (stderr = cap(stderr, c)));

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGKILL');
    }, timeoutMs);

    child.on('error', (err) => {
      clearTimeout(timer);
      resolve({ stdout, stderr: stderr + `\nspawn error: ${err.message}`, exitCode: -1, error: 'spawn_failed', startedAt });
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      resolve({
        stdout,
        stderr,
        exitCode: code ?? -1,
        error: timedOut ? 'timeout' : null,
        startedAt,
      });
    });
  });
}
