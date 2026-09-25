/**
 * SSE transport tests.
 *
 * The stream is what makes the chat feel alive, so the parsing rules matter:
 * frames arrive in order, a `[DONE]`-style terminator closes the turn, a stream
 * that dies without a terminator is reported as a provider problem, and an
 * explicit `error` frame surfaces the server's friendly message.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { regenerateStream, sendMessageStream } from '../../client/src/api/chatStream.js';

/** Builds a fake fetch Response whose body streams the given frames. */
function sseResponse(frames, { status = 200 } = {}) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return new Response(stream, { status, headers: { 'content-type': 'text/event-stream' } });
}

function frame(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/** Collects the handler calls for a streamed send. */
function collect() {
  const calls = { meta: [], delta: [], done: [], error: [] };
  return {
    calls,
    handlers: {
      onMeta: (payload) => calls.meta.push(payload),
      onDelta: (text) => calls.delta.push(text),
      onDone: (payload) => calls.done.push(payload),
      onError: (error) => calls.error.push(error),
    },
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('sendMessageStream', () => {
  it('delivers meta, deltas and done in order', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        sseResponse([
          frame('meta', { usage: { used: 1, limit: 20 }, userMessage: { id: 'm1' } }),
          frame('delta', { text: 'Hello ' }),
          frame('delta', { text: 'yaar 💛' }),
          frame('done', { assistantMessage: { id: 'a1', content: 'Hello yaar 💛' } }),
        ]),
      ),
    );

    const { calls, handlers } = collect();
    await sendMessageStream({
      companionId: 'girlfriend',
      content: 'hi',
      clientMessageId: 'abc-123-456',
      ...handlers,
    });

    expect(calls.meta).toHaveLength(1);
    expect(calls.meta[0].usage.used).toBe(1);
    expect(calls.delta.join('')).toBe('Hello yaar 💛');
    expect(calls.done).toHaveLength(1);
    expect(calls.done[0].assistantMessage.content).toBe('Hello yaar 💛');
    expect(calls.error).toHaveLength(0);
  });

  it('sends the clientMessageId so the server can de-duplicate a retry', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([frame('done', {})]));
    vi.stubGlobal('fetch', fetchMock);

    const { handlers } = collect();
    await sendMessageStream({
      companionId: 'boyfriend',
      content: 'hello',
      clientMessageId: 'retry-id-123456',
      ...handlers,
    });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/chat/boyfriend/messages');
    expect(JSON.parse(init.body)).toMatchObject({
      content: 'hello',
      clientMessageId: 'retry-id-123456',
      stream: true,
    });
  });

  it('surfaces an error frame with the server copy and usage details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        sseResponse([
          frame('meta', { usage: { used: 20, limit: 20 } }),
          frame('error', {
            error: {
              code: 'ai_unavailable',
              message: "I couldn't reply just now — try again?",
              details: { usage: { used: 20, limit: 20, remaining: 0 } },
            },
          }),
        ]),
      ),
    );

    const { calls, handlers } = collect();
    await sendMessageStream({ companionId: 'girlfriend', content: 'hi', ...handlers });

    expect(calls.error).toHaveLength(1);
    expect(calls.error[0].code).toBe('ai_unavailable');
    expect(calls.error[0].details.usage.remaining).toBe(0);
    expect(calls.done).toHaveLength(0);
  });

  it('reports ai_unavailable when the stream ends without a terminal frame', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(sseResponse([frame('meta', {}), frame('delta', { text: 'par' })])),
    );

    const { calls, handlers } = collect();
    await sendMessageStream({ companionId: 'girlfriend', content: 'hi', ...handlers });

    expect(calls.delta.join('')).toBe('par');
    expect(calls.error).toHaveLength(1);
    expect(calls.error[0].code).toBe('ai_unavailable');
  });

  it('reports the limit error when the send is rejected before streaming', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            error: {
              code: 'daily_limit_reached',
              message: 'Come back after 24 hours',
              details: { usage: { used: 20, limit: 20, remaining: 0 } },
            },
          }),
          { status: 429, headers: { 'content-type': 'application/json' } },
        ),
      ),
    );

    const { calls, handlers } = collect();
    await sendMessageStream({ companionId: 'girlfriend', content: 'hi', ...handlers });

    expect(calls.error[0].code).toBe('daily_limit_reached');
    expect(calls.error[0].details.usage.used).toBe(20);
  });

  it('ignores heartbeat comments and tolerates split frames', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        sseResponse([
          ': ping\n\n',
          'event: delta\ndata: {"text":"half',
          '"}\n\n',
          frame('done', { assistantMessage: { id: 'a1', content: 'half' } }),
        ]),
      ),
    );

    const { calls, handlers } = collect();
    await sendMessageStream({ companionId: 'girlfriend', content: 'hi', ...handlers });

    expect(calls.delta).toEqual(['half']);
    expect(calls.done).toHaveLength(1);
    expect(calls.error).toHaveLength(0);
  });

  it('does not start a request when the signal is already aborted', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const controller = new AbortController();
    controller.abort();

    const { calls, handlers } = collect();
    await sendMessageStream({
      companionId: 'girlfriend',
      content: 'hi',
      signal: controller.signal,
      ...handlers,
    });

    expect(fetchMock).not.toHaveBeenCalled();
    expect(calls.error[0].code).toBe('cancelled');
  });

  it('reports a user cancellation as cancelled', async () => {
    const controller = new AbortController();
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      ),
    );

    const { calls, handlers } = collect();
    const promise = sendMessageStream({
      companionId: 'girlfriend',
      content: 'hi',
      signal: controller.signal,
      ...handlers,
    });
    controller.abort();
    await promise;

    expect(calls.error).toHaveLength(1);
    expect(calls.error[0].code).toBe('cancelled');
  });
});

describe('regenerateStream', () => {
  it('posts to the regenerate endpoint with no message content', async () => {
    const fetchMock = vi.fn().mockResolvedValue(sseResponse([frame('done', {})]));
    vi.stubGlobal('fetch', fetchMock);

    const { handlers } = collect();
    await regenerateStream({ companionId: 'boyfriend', ...handlers });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain('/api/chat/boyfriend/regenerate');
    expect(JSON.parse(init.body)).toEqual({ stream: true });
  });
});
