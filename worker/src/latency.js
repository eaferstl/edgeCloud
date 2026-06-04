// Measures this worker's round-trip latency to the rendezvous by timing a tiny
// HTTP request (GET /api/ping) periodically and keeping the median of recent
// samples. The value feeds:
//   - the heartbeat (record.rttMs) → the live map shows "~N ms · hops"
//   - the worker's claims (claim.rtt) → the proximity-based election prefers the
//     closest capable worker (shared/src/election.js)
//
// Median (not last) so a single slow request doesn't swing routing.

export function createLatencyProbe({ url, intervalMs = 15000, keep = 5 } = {}) {
  const recent = [];
  let current = null;

  async function measure() {
    if (!url) return;
    const t0 = Date.now();
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(5000) });
      // drain the (tiny/empty) body so the connection completes
      await res.arrayBuffer().catch(() => {});
      if (res.status >= 200 && res.status < 500) {
        recent.push(Date.now() - t0);
        if (recent.length > keep) recent.shift();
        const sorted = [...recent].sort((a, b) => a - b);
        current = sorted[Math.floor(sorted.length / 2)];
      }
    } catch {
      /* transient / endpoint missing → leave current as-is (or null) */
    }
  }

  function start() {
    measure();
    const h = setInterval(measure, intervalMs);
    h.unref?.();
    return h;
  }

  return { rttMs: () => current, start };
}
