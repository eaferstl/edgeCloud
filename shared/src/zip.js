// Deterministic zip building/parsing.
//
// The jobId is SHA256(base64(zip bytes)), so the SAME logical job must produce
// the SAME bytes everywhere (browser fflate and Node fflate, same pinned
// version). Determinism rules:
//   - STORE only (level 0) — no compressor drift
//   - fixed mtime (ZIP_FIXED_MTIME_MS) — fflate would otherwise stamp "now"
//   - fixed entry order: entry file first, then manifest.json
//   - manifest serialized as canonical JSON (sorted keys, no whitespace)

import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import { canonicalJson } from './canonical.js';
import { validateManifest, JS_ENTRY, WASM_ENTRY, INFERENCE_ENTRY } from './manifest.js';
import { ZIP_FIXED_MTIME_MS, MAX_ZIP_B64_BYTES } from './constants.js';

/**
 * Build the deterministic job zip.
 * @param {object} manifest - validated manifest (see manifest.js)
 * @param {Uint8Array|string} entryData - main.js source (string) or module.wasm bytes
 * @returns {string} base64 of the zip bytes
 */
export function buildJobZipB64(manifest, entryData) {
  const err = validateManifest(manifest);
  if (err) throw new Error(`invalid manifest: ${err}`);
  const entryBytes = typeof entryData === 'string' ? strToU8(entryData) : entryData;
  const opts = { level: 0, mtime: new Date(ZIP_FIXED_MTIME_MS) };
  // Insertion order is preserved by fflate: entry file first, manifest second.
  const tree = {
    [manifest.entry]: [entryBytes, opts],
    'manifest.json': [strToU8(canonicalJson(manifest)), opts],
  };
  const zipped = zipSync(tree, { level: 0, mtime: new Date(ZIP_FIXED_MTIME_MS) });
  return Buffer.from(zipped).toString('base64');
}

/**
 * Parse and validate a job zip.
 * @returns {{ manifest: object, entryName: string, entryBytes: Uint8Array }}
 * @throws on structural problems
 */
export function parseJobZipB64(zipB64) {
  if (typeof zipB64 !== 'string' || zipB64.length === 0) throw new Error('empty zip payload');
  if (zipB64.length > MAX_ZIP_B64_BYTES) throw new Error('zip payload too large');
  const bytes = new Uint8Array(Buffer.from(zipB64, 'base64'));
  const files = unzipSync(bytes);
  const names = Object.keys(files);
  if (!files['manifest.json']) throw new Error('zip missing manifest.json');
  let manifest;
  try {
    manifest = JSON.parse(strFromU8(files['manifest.json']));
  } catch {
    throw new Error('manifest.json is not valid JSON');
  }
  const err = validateManifest(manifest);
  if (err) throw new Error(`invalid manifest: ${err}`);
  if (!files[manifest.entry]) throw new Error(`zip missing entry file ${manifest.entry}`);
  const allowed = new Set(['manifest.json', JS_ENTRY, WASM_ENTRY, INFERENCE_ENTRY]);
  for (const n of names) {
    if (!allowed.has(n)) throw new Error(`unexpected file in zip: ${n}`);
  }
  return { manifest, entryName: manifest.entry, entryBytes: files[manifest.entry] };
}
