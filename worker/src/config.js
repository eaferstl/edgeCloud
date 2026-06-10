// Worker configuration from environment.

import path from 'node:path';
import { GENESIS_MULTIADDRS } from '@edgecloud/shared/constants.js';

export const config = {
  dataDir: path.resolve(process.env.EDGECLOUD_DATA || './worker-data'),
  // Rendezvous server multiaddrs (comma-separated). Defaults to the genesis
  // server baked into shared/constants.js; RENDEZVOUS_MULTIADDR overrides.
  rendezvous: (process.env.RENDEZVOUS_MULTIADDR
    ? process.env.RENDEZVOUS_MULTIADDR.split(',').map((s) => s.trim()).filter(Boolean)
    : GENESIS_MULTIADDRS),
  // HTTP fallback for worker registration + the registry-grace check (any central
  // server). Bare IP, NOT the domain: the hardened worker firewall blocks
  // in-container DNS on some hosts (e.g. Docker Desktop), so a domain here would
  // be unreachable for those workers. The server serves this over plain HTTP on
  // its raw IP (Caddy `http://<ip>` vhost); browsers use the HTTPS domain instead.
  // EDGECLOUD_HTTP_FALLBACK overrides.
  httpFallback: (process.env.EDGECLOUD_HTTP_FALLBACK || 'http://64.23.224.76').replace(/\/$/, ''),
  // Max simultaneous jobs this node advertises (seeds availableCapacity; from
  // chaodoze's EDGECLOUD_MAX_CONCURRENT). The claim protocol does not yet gate
  // on this — it's advertised for display and future least-loaded routing.
  maxConcurrent: Number(process.env.EDGECLOUD_MAX_CONCURRENT) || 4,
  // The Edge Esmeralda email this worker registers its identity key against.
  // Workers are no longer anonymous: a worker's identity must be a registered,
  // allowlisted key (≤4 keys/email), which is what bounds the Sybil/grinding
  // attack on claim selection (THREAT_MODEL.md R-010). Required.
  email: (process.env.EDGECLOUD_EMAIL || '').trim().toLowerCase(),
  // GPU / LLM inference. Set EDGECLOUD_LLM_URL to an OpenAI-compatible endpoint
  // the worker can curl (e.g. a host llama-swap/Ollama/llama-server reachable at
  // http://host.docker.internal:9090 or http://172.17.0.1:9090). When set, this
  // worker advertises GPU capability and is the only kind that can win
  // type:"inference" jobs. The base URL is enough — "/v1/chat/completions" is
  // appended. Optional: a default model and an API bearer key.
  llmUrl: (process.env.EDGECLOUD_LLM_URL || '').trim().replace(/\/$/, ''),
  // Models this worker serves, advertised to the network (array). Comma-separated;
  // the first is the default when a job doesn't pin one. EDGECLOUD_LLM_MODEL
  // (singular) is accepted as a fallback.
  llmModels: (process.env.EDGECLOUD_LLM_MODELS || process.env.EDGECLOUD_LLM_MODEL || 'lfm2.5-8b-a1b')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean),
  llmApiKey: (process.env.EDGECLOUD_LLM_API_KEY || process.env.LLAMA_API_KEY || '').trim(),
  // The unprivileged uid/gid that UNTRUSTED submitted code is dropped to. Set
  // in the Docker image; unset in local dev/tests (jobs then run in-process as
  // the current user — fine for trusted local runs, NOT for production).
  sandboxUid: process.env.EDGECLOUD_SANDBOX_UID ? Number(process.env.EDGECLOUD_SANDBOX_UID) : null,
  sandboxGid: process.env.EDGECLOUD_SANDBOX_GID ? Number(process.env.EDGECLOUD_SANDBOX_GID) : null,
};

if (config.rendezvous.length === 0) {
  console.error(
    '[config] no rendezvous multiaddrs: set RENDEZVOUS_MULTIADDR=/ip4/<host>/tcp/4002/ws/p2p/<peerId>'
  );
  process.exit(1);
}
