// Server-Sent Events: one-way push (server → browser) for the live execution
// map. Deliberately NOT WebSockets — the browser only needs to *receive* fleet
// status + execution events; the existing job/auth flow stays plain HTTP. SSE
// adds no dependency, works over plain HTTP with no upgrade handshake, and the
// browser's built-in EventSource auto-reconnects.
//
// Events emitted:
//   status     — full fleet snapshot (same shape as GET /api/status)
//   execution  — { jobId, executedBy, ok, ts } the instant a result is cached

export function createSSE() {
  const clients = new Set(); // open res streams

  function send(res, event, data) {
    try {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    } catch {
      clients.delete(res); // stream broke; will also fire 'close'
    }
  }

  function handler(req, res, initial) {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no', // don't let a proxy buffer the stream
    });
    res.write('retry: 3000\n\n'); // client reconnect backoff hint
    clients.add(res);
    if (initial !== undefined) send(res, 'status', initial);
    req.on('close', () => clients.delete(res));
  }

  function broadcast(event, data) {
    for (const res of clients) send(res, event, data);
  }

  // Keepalive comment so intermediaries don't reap an idle connection.
  const ka = setInterval(() => {
    for (const res of clients) {
      try {
        res.write(': ping\n\n');
      } catch {
        clients.delete(res);
      }
    }
  }, 25000);
  ka.unref?.();

  return { handler, broadcast, count: () => clients.size };
}
