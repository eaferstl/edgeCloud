// Registers this worker's identity key against the operator's allowlisted Edge
// Esmeralda email, via a central server's POST /api/register — the SAME endpoint
// and the same ≤4-keys-per-email limit that browser users go through. Workers
// are no longer anonymous: a worker must hold a registered, allowlisted key to
// win claims (other workers count a claim only if its key is a verified registry
// entry), which is what bounds the Sybil/grinding attack (THREAT_MODEL.md R-010)
// to the attendee list.
//
// Tolerant of transient network errors (a previous run may already be
// registered, and the attestation replicates over OrbitDB regardless); FATAL
// only on a definitive allowlist/quota rejection, so a misconfigured worker
// fails loudly instead of idling forever as an unregistered no-op.

export async function registerWorker({ httpFallback, email, pubkey, log = console.log }) {
  let res;
  try {
    res = await fetch(`${httpFallback}/api/register-worker`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ email, pubkey }),
      signal: AbortSignal.timeout(8000),
    });
  } catch (e) {
    log(`[register] could not reach ${httpFallback} (${e.message}); continuing — relying on registry replication`);
    return { ok: false, transient: true };
  }
  let body = {};
  try {
    body = await res.json();
  } catch {
    /* non-JSON body */
  }
  if (res.ok) {
    log(
      body.alreadyRegistered
        ? '[register] worker identity key already registered for this email'
        : `[register] worker identity key registered against ${email}`
    );
    return { ok: true };
  }
  throw new Error(`worker registration rejected (${res.status}): ${body.error || 'unknown error'}`);
}
