// edgeCloud HTTP client — the proven browser/e2e flow, factored for reuse.
//
// This is a faithful port of scripts/e2e-client.mjs (register -> sign -> submit
// -> poll -> challenge/response -> fetch result) using the SAME @edgecloud/shared
// code the workers use, so the envelope/zip contract is guaranteed identical.
// It adds NO new network protocol or payload — it is purely a client of the
// existing HTTP API in server/src/http/app.js.

import { buildManifest } from '@edgecloud/shared/manifest.js';
import { buildJobZipB64 } from '@edgecloud/shared/zip.js';
import { createEnvelope } from '@edgecloud/shared/envelope.js';
import { signDetachedB64, fromB64 } from '@edgecloud/shared/crypto.js';
import { Keystore, tagFor } from './keystore.js';

/**
 * Wrap raw JS the same way the webform and e2e client do: if the snippet already
 * prints, run it verbatim; otherwise eval it and print the resulting value.
 */
export function wrapJs(code) {
  return /console\.(log|error|info|warn)/.test(code)
    ? code
    : `const __r = eval(${JSON.stringify(code)});\nif (__r !== undefined) console.log(__r);`;
}

export class EdgeCloudClient {
  /**
   * @param {object} opts
   * @param {string} opts.baseUrl  e.g. http://146.190.123.91
   * @param {string} opts.email    allowlisted Edge Esmeralda attendee email
   * @param {Keystore} [opts.keystore]
   */
  constructor({ baseUrl, email, keystore, requestTimeoutMs }) {
    if (!baseUrl) throw new Error('EDGECLOUD_SERVER is required');
    if (!email || !email.includes('@')) throw new Error('EDGECLOUD_EMAIL (a valid attendee email) is required');
    this.baseUrl = baseUrl.replace(/\/+$/, '');
    this.email = email;
    this.keystore = keystore || new Keystore();
    this.tag = tagFor(this.baseUrl, this.email);
    this._registered = false;
    // A registration is an OrbitDB (CRDT) write that can be slow on a cold server;
    // keep this comfortably above worst-case write latency.
    this.requestTimeoutMs = requestTimeoutMs || Number(process.env.EDGECLOUD_REQUEST_TIMEOUT_MS) || 30_000;
  }

  get keypair() {
    return this.keystore.keypairFor(this.tag);
  }

  async _api(method, pathname, body, headers = {}) {
    const res = await fetch(this.baseUrl + pathname, {
      method,
      headers: { 'content-type': 'application/json', ...headers },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(this.requestTimeoutMs),
    });
    let json = {};
    try {
      json = await res.json();
    } catch {
      /* non-JSON body */
    }
    return { status: res.status, body: json };
  }

  /** Register this agent's key against the attendee email (idempotent). */
  async ensureRegistered() {
    if (this._registered) return;
    const { status, body } = await this._api('POST', '/api/register', {
      email: this.email,
      pubkey: this.keypair.publicKey,
    });
    if (status !== 200) {
      throw new Error(body.error || `registration failed (${status})`);
    }
    this._registered = true;
  }

  /** Mint (or reuse) a challenge/response session token for result retrieval. */
  async _sessionToken() {
    const cached = this.keystore.getSession(this.tag);
    if (cached) return cached;
    const { publicKey, secretKey } = this.keypair;
    const ch = await this._api('GET', `/api/challenge?pubkey=${encodeURIComponent(publicKey)}`);
    if (ch.status !== 200 || !ch.body.nonce) throw new Error(ch.body.error || 'challenge failed');
    const sig = signDetachedB64(ch.body.nonce, secretKey);
    const ver = await this._api('POST', '/api/auth/verify', { pubkey: publicKey, nonce: ch.body.nonce, sig });
    if (ver.status !== 200 || !ver.body.token) throw new Error(ver.body.error || 'auth verification failed');
    this.keystore.setSession(this.tag, ver.body.token);
    return ver.body.token;
  }

  /**
   * Build + sign a job envelope.
   * @param {object} job
   * @param {'js'|'wasm'} job.type
   * @param {string} [job.code]       JS source/expression (type: 'js')
   * @param {string} [job.moduleB64]  base64 WASM module (type: 'wasm')
   * @param {string[]} [job.args]
   * @param {number} [job.timeoutMs]
   * @param {string} [job.label]
   */
  buildEnvelope(job) {
    const { type = 'js', code, moduleB64, args = [], timeoutMs, label } = job;
    let entryData;
    if (type === 'js') {
      if (typeof code !== 'string' || !code.length) throw new Error('js job requires `code`');
      entryData = wrapJs(code);
    } else if (type === 'wasm') {
      if (typeof moduleB64 !== 'string' || !moduleB64.length) throw new Error('wasm job requires `moduleB64`');
      entryData = fromB64(moduleB64); // Uint8Array bytes
    } else {
      throw new Error(`unsupported job type: ${type}`);
    }
    const manifest = buildManifest({
      type,
      args,
      ...(timeoutMs ? { timeoutMs } : {}),
      label: label || (type === 'js' ? String(code).slice(0, 60) : 'wasm job'),
    });
    const zipB64 = buildJobZipB64(manifest, entryData);
    const { publicKey, secretKey } = this.keypair;
    return createEnvelope({ zipB64, publicKeyB64: publicKey, secretKeyB64: secretKey });
  }

  /** Submit a signed envelope. Returns the server's submit response. */
  async submit(env) {
    const { status, body } = await this._api('POST', '/api/jobs', env);
    if (status !== 200) throw new Error(body.error || `submit failed (${status})`);
    return body; // { jobId, status, cached, result?, jobsSubmitted }
  }

  async statusOf(jobId) {
    const { body } = await this._api('GET', `/api/jobs/${jobId}/status`);
    return body.status; // queued | done | unknown
  }

  /** Challenge/response-gated result fetch. Returns the result object or null. */
  async fetchResult(jobId) {
    const token = await this._sessionToken();
    const { status, body } = await this._api('GET', `/api/jobs/${jobId}/result`, undefined, {
      authorization: `Bearer ${token}`,
    });
    if (status === 200) return body.result;
    if (status === 202) return null; // not done yet
    throw new Error(body.error || `result fetch failed (${status})`);
  }

  async networkStatus() {
    const { body } = await this._api('GET', '/api/status');
    return body;
  }

  /**
   * High-level: register -> submit -> (optionally) wait -> retrieve.
   * @returns {{ jobId, status, cached, result?: object }}
   */
  async run(job, { wait = true, waitMs = 120_000, pollMs = 1500 } = {}) {
    await this.ensureRegistered();
    const env = this.buildEnvelope(job);
    const sub = await this.submit(env);

    // Duplicate submission == cache hit: result rides back on the submit response.
    if (sub.result) {
      return { jobId: env.jobId, status: 'done', cached: true, result: sub.result };
    }
    if (!wait) {
      return { jobId: env.jobId, status: sub.status, cached: false };
    }

    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      await new Promise((r) => setTimeout(r, pollMs));
      if ((await this.statusOf(env.jobId)) === 'done') break;
    }
    const result = await this.fetchResult(env.jobId);
    if (!result) {
      // No worker picked it up in time; it stays queued and can be fetched later.
      return { jobId: env.jobId, status: 'queued', cached: false };
    }
    return { jobId: env.jobId, status: 'done', cached: false, result };
  }
}
