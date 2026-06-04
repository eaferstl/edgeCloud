// Worker ↔ job capability matching. A worker only CLAIMS a job whose
// requirements it can satisfy, so incapable workers self-exclude from the
// election — decentralized routing, no central scheduler.
//
// caps: { cores: number, ramBytes: number, gpu: boolean }
// manifest requirements: type 'inference' ⇒ needs a GPU/LLM worker; optional
// minCores / minRamBytes.

export function meetsRequirements(manifest, caps) {
  if (!manifest || !caps) return false;
  if (manifest.type === 'inference' && !caps.gpu) return false;
  if (manifest.minCores != null && !(caps.cores >= manifest.minCores)) return false;
  if (manifest.minRamBytes != null && !(caps.ramBytes >= manifest.minRamBytes)) return false;
  return true;
}
