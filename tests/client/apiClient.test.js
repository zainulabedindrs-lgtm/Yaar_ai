/**
 * API client error handling.
 *
 * Every failure a user can hit — offline, timeout, 429, 5xx, a limit error with
 * usage details — must arrive as an `ApiClientError` with a friendly message,
 * never as a raw fetch/TypeError.
 */

import { afterEach, describe, expect, it, vi } from 'vitest';

import { ApiClientError, apiRequest, apiUrl } from '../../client/src/api/httpClient.js';

function jsonResponse(body, { status = 200 } = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('apiUrl', () => {
  it('targets the same origin by default', () => {
    expect(apiUrl('/session')).toBe('/api/session');
    expect(apiUrl('session')).toBe('/api/session');
  });
});

describe('apiRequest', () => {
  it('sends the anonymous device id header so the server can track usage', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ ok: true }));
    vi.stubGlobal('fetch', fetchMock);

    await apiRequest('/session');
    const [, init] = fetchMock.mock.calls[0];
    expect(init.headers['x-yaar-device-id']).toMatch(/^[A-Za-z0-9_-]{8,128}$/);
    expect(init.credentials).toBe('include');
  });

  it('returns parsed JSON on success', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(jsonResponse({ usage: { used: 3 } })));
    const payload = await apiRequest('/usage');
    expect(payload.usage.used).toBe(3);
  });

  it('maps an offline failure to the network error code', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(apiRequest('/session')).rejects.toMatchObject({
      code: 'network_error',
      name: 'ApiClientError',
    });
  });

  it('passes through the server error code, message and usage details', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        jsonResponse(
          {
            error: {
              code: 'daily_limit_reached',
              message: "That's all 20 messages for now 💛",
              details: { usage: { used: 20, limit: 20, remaining: 0 } },
            },
          },
          { status: 429 },
        ),
      ),
    );

    const error = await apiRequest('/chat/girlfriend/messages', { method: 'POST' }).catch((e) => e);
    expect(error).toBeInstanceOf(ApiClientError);
    expect(error.code).toBe('daily_limit_reached');
    expect(error.message).toContain('20 messages');
    expect(error.details.usage.remaining).toBe(0);
  });

  it('falls back to a friendly code when the body is not JSON', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(new Response('<html>500</html>', { status: 500 })),
    );
    await expect(apiRequest('/session')).rejects.toMatchObject({ code: 'server_error' });
  });

  it('maps 429 without a body to rate_limited', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 429 })));
    await expect(apiRequest('/session')).rejects.toMatchObject({ code: 'rate_limited' });
  });

  it('aborts with the timeout copy when the server never answers', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockImplementation(
        (_url, { signal }) =>
          new Promise((_resolve, reject) => {
            signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')));
          }),
      ),
    );

    await expect(apiRequest('/session', { timeoutMs: 20 })).rejects.toMatchObject({
      code: 'network_error',
    });
  });

  it('reports a cancelled request as cancelled, not as a server error', async () => {
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

    const promise = apiRequest('/session', { signal: controller.signal });
    controller.abort();
    await expect(promise).rejects.toMatchObject({ code: 'cancelled' });
  });
});
