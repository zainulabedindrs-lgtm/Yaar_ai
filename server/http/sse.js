/**
 * Minimal Server-Sent Events helper.
 *
 * Used to stream AI replies token-by-token so the chat feels alive, and to
 * deliver the "message accepted / usage updated" metadata before the model has
 * produced anything.
 */

const HEARTBEAT_MS = 15_000;

/**
 * @param {import('express').Response} res
 */
export function openSseStream(res) {
  res.writeHead(200, {
    'content-type': 'text/event-stream; charset=utf-8',
    'cache-control': 'no-cache, no-transform',
    connection: 'keep-alive',
    'x-accel-buffering': 'no',
  });
  res.flushHeaders?.();

  let closed = false;
  const heartbeat = setInterval(() => {
    if (closed) return;
    try {
      res.write(': ping\n\n');
    } catch {
      closed = true;
    }
  }, HEARTBEAT_MS);
  // Never hold the event loop open because of a heartbeat.
  heartbeat.unref?.();

  return {
    /** @param {string} event @param {unknown} data */
    send(event, data) {
      if (closed || res.writableEnded) return false;
      try {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data ?? null)}\n\n`);
        return true;
      } catch {
        closed = true;
        return false;
      }
    },
    close() {
      clearInterval(heartbeat);
      if (closed) return;
      closed = true;
      if (!res.writableEnded) res.end();
    },
    get isClosed() {
      return closed || res.writableEnded;
    },
  };
}
