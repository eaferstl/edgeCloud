// type:"inference" executor — forward the prompt to this worker's configured
// GPU/LLM endpoint (OpenAI-compatible /v1/chat/completions, e.g. the host's
// llama-swap / Ollama / llama-server, "only a curl away") and return the
// completion as stdout.
//
// Unlike js/wasm jobs, NOTHING untrusted executes here — the prompt is just text
// POSTed to the operator's own model server — so this runs in the worker process
// (no sandbox uid, no scratch dir). The egress firewall must allow the endpoint's
// host (see the GPU worker setup in the README).

import { config } from '../config.js';

export async function runInference(prompt, manifest, timeoutMs) {
  const startedAt = Date.now();
  if (!config.llmUrl) {
    return { stdout: '', stderr: 'this worker has no GPU/LLM endpoint (EDGECLOUD_LLM_URL)', exitCode: -1, error: 'no_gpu', startedAt };
  }
  const model = (manifest && manifest.model) || config.llmModels[0];
  const headers = { 'content-type': 'application/json' };
  if (config.llmApiKey) headers.authorization = `Bearer ${config.llmApiKey}`;
  const body = JSON.stringify({
    model,
    messages: [{ role: 'user', content: prompt }],
    temperature: 0.2,
    max_tokens: 2048,
    stream: false,
  });
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), Math.max(1000, timeoutMs));
  try {
    const res = await fetch(`${config.llmUrl}/v1/chat/completions`, { method: 'POST', headers, body, signal: ctrl.signal });
    const text = await res.text();
    if (!res.ok) {
      return { stdout: '', stderr: `LLM endpoint ${res.status}: ${text.slice(0, 500)}`, exitCode: -1, error: 'llm_error', startedAt };
    }
    let content = text;
    try {
      const j = JSON.parse(text);
      content = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || '';
    } catch {
      /* non-JSON body → return as-is */
    }
    return { stdout: content, stderr: '', exitCode: 0, error: null, startedAt };
  } catch (e) {
    const msg = e.name === 'AbortError' ? `inference timed out after ${timeoutMs}ms` : e.message;
    return { stdout: '', stderr: msg, exitCode: -1, error: 'llm_unreachable', startedAt };
  } finally {
    clearTimeout(timer);
  }
}
