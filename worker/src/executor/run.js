// Job execution: unzip into a throwaway scratch dir, dispatch by manifest
// type, capture stdout/stderr/exitCode, clean up.

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseJobZipB64 } from '@edgecloud/shared/zip.js';
import { MAX_JOB_TIMEOUT_MS } from '@edgecloud/shared/constants.js';
import { runJs } from './js-runner.js';
import { runWasm } from './wasm-runner.js';

export async function executeJob(env) {
  const startedAt = Date.now();
  let scratch = null;
  try {
    const { manifest, entryName, entryBytes } = parseJobZipB64(env.zipB64);
    scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'ecjob-'));
    fs.writeFileSync(path.join(scratch, entryName), entryBytes);
    fs.mkdirSync(path.join(scratch, 'output'), { recursive: true }); // standardized output dir (stdout is primary)

    const timeoutMs = Math.min(manifest.timeoutMs, MAX_JOB_TIMEOUT_MS);
    const r =
      manifest.type === 'js'
        ? await runJs(path.join(scratch, entryName), scratch, timeoutMs)
        : await runWasm(manifest, scratch, timeoutMs);
    return { ...r, startedAt: r.startedAt ?? startedAt };
  } catch (e) {
    return { stdout: '', stderr: e.message, exitCode: -1, error: 'invalid_job', startedAt };
  } finally {
    if (scratch) fs.rmSync(scratch, { recursive: true, force: true });
  }
}
