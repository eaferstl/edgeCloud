// Runs a JS job in a child Node process with a hard timeout and output caps.
//
// Hardening (when EDGECLOUD_SANDBOX_UID is set, i.e. inside the container):
//   - the child runs as the unprivileged `sandbox` uid via setpriv
//     (--clear-groups --no-new-privs), so it can't read /data and — together
//     with the per-uid iptables rule — has NO network;
//   - Node's Permission Model (--permission --allow-fs-read/write=<scratch>)
//     confines filesystem access to the throwaway scratch dir and blocks
//     child_process / worker_threads / native addons / WASI;
//   - --max-old-space-size caps heap; the process runs in its own process group
//     so a timeout kills any grandchildren too.
// Without EDGECLOUD_SANDBOX_UID (local dev / tests) it falls back to a plain
// `node main.js` so the suite runs without root.

import { spawn } from 'node:child_process';
import { MAX_OUTPUT_BYTES } from '@edgecloud/shared/constants.js';
import { config } from '../config.js';

export function runJs(entryPath, cwd, timeoutMs) {
  if (config.sandboxUid) {
    const nodeArgs = [
      '--permission',
      `--allow-fs-read=${cwd}`,
      `--allow-fs-write=${cwd}`,
      '--max-old-space-size=128',
      entryPath,
    ];
    return runSandboxed('node', nodeArgs, cwd, timeoutMs);
  }
  // local-dev fallback (non-root, no setpriv): plain node
  return runProcess(process.execPath, [entryPath], cwd, timeoutMs, {});
}

/** Run `cmd argv...` as the sandbox uid via setpriv, in its own process group. */
export function runSandboxed(cmd, argv, cwd, timeoutMs) {
  const setprivArgs = [
    `--reuid=${config.sandboxUid}`,
    `--regid=${config.sandboxGid}`,
    '--clear-groups',
    '--no-new-privs',
    '--',
    cmd,
    ...argv,
  ];
  return runProcess('setpriv', setprivArgs, cwd, timeoutMs, { detached: true });
}

export function runProcess(cmd, argv, cwd, timeoutMs, { detached = false } = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    const child = spawn(cmd, argv, {
      cwd,
      env: { PATH: process.env.PATH, HOME: cwd, TMPDIR: cwd }, // no inherited secrets/config
      stdio: ['ignore', 'pipe', 'pipe'],
      detached, // own process group so we can kill grandchildren on timeout
    });

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const cap = (s, chunk) =>
      s.length >= MAX_OUTPUT_BYTES ? s : s + chunk.toString('utf8').slice(0, MAX_OUTPUT_BYTES - s.length);
    child.stdout.on('data', (c) => (stdout = cap(stdout, c)));
    child.stderr.on('data', (c) => (stderr = cap(stderr, c)));

    const kill = () => {
      try {
        if (detached && child.pid) process.kill(-child.pid, 'SIGKILL'); // whole group
        else child.kill('SIGKILL');
      } catch {
        /* already gone */
      }
    };
    const timer = setTimeout(() => {
      timedOut = true;
      kill();
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
