// Job execution: unzip into a throwaway scratch dir, dispatch by manifest
// type, capture stdout/stderr/exitCode, clean up.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseJobZipB64 } from '@edgecloud/shared/zip.js';
import { MAX_JOB_TIMEOUT_MS } from '@edgecloud/shared/constants.js';
import { config } from '../config.js';
import { runJs } from './js-runner.js';
import { runWasm } from './wasm-runner.js';
import { runInference } from './inference-runner.js';

export async function executeJob(env) {
  const startedAt = Date.now();
  let scratch = null;
  try {
    const { manifest, entryName, entryBytes } = parseJobZipB64(env.zipB64);

    // Inference jobs run no untrusted code — the worker just forwards the prompt
    // to its GPU/LLM endpoint, so no scratch dir / sandbox uid is involved.
    if (manifest.type === 'inference') {
      const prompt = Buffer.from(entryBytes).toString('utf8');
      const r = await runInference(prompt, manifest, Math.min(manifest.timeoutMs, MAX_JOB_TIMEOUT_MS));
      return { ...r, startedAt: r.startedAt ?? startedAt };
    }

    // Scratch dir on /tmp (a tmpfs under the hardened compose), the only place
    // both the root worker and the sandbox uid can use.
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ecjob-'));
    const entryPath = path.join(scratch, entryName);
    const outputDir = path.join(scratch, 'output');
    fs.writeFileSync(entryPath, entryBytes);
    fs.mkdirSync(outputDir, { recursive: true }); // standardized output dir (stdout is primary)

    // Make the scratch dir usable by the sandbox uid the job runs as, WITHOUT
    // giving it ownership: the dir stays root-owned so the (DAC_OVERRIDE-less)
    // root worker can always clean it up. Nothing in scratch is secret — it's
    // the job's own code + its own output. The job reads its entry and writes
    // to output/ via world perms; Node's --permission still confines it here.
    if (config.sandboxUid) {
      fs.chmodSync(scratch, 0o755); // world r+x: traverse + read entry, can't alter the dir
      fs.chmodSync(entryPath, 0o644); // world-readable
      fs.chmodSync(outputDir, 0o777); // world-writable for the job's output
    }

    const timeoutMs = Math.min(manifest.timeoutMs, MAX_JOB_TIMEOUT_MS);
    const r =
      manifest.type === 'js'
        ? await runJs(path.join(scratch, entryName), scratch, timeoutMs)
        : await runWasm(manifest, scratch, timeoutMs);
    return { ...r, startedAt: r.startedAt ?? startedAt };
  } catch (e) {
    return { stdout: '', stderr: e.message, exitCode: -1, error: 'invalid_job', startedAt };
  } finally {
    // scratch stays root-owned, so cleanup works even though job-written files
    // inside it are owned by the sandbox uid (root owns the dir → can unlink).
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  }
}
