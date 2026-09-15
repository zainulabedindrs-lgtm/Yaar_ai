/**
 * Streaming chat transport.
 *
 * `EventSource` cannot POST, so we read the SSE frames from a fetch stream
 * ourselves. Events emitted by the server (`server/routes/chatRoutes.js`):
 *
 *   meta   { conversation, userMessage, usage }    → the message was accepted
 *   delta  { text }                                → a piece of the reply
 *   done   { assistantMessage, usage, truncated? } → the reply is complete
 *   error  { error: { code, message, details } }   → nothing was generated
 */

import { ERROR_CODES } from '@shared/errors';

import { CHAT_TIMEOUT_MS } from '../config/appConfig.js';
import { ApiClientError, apiUrl, baseHeaders } from './httpClient.js';

/**
 * Sends a new user message and streams the reply.
 * @param {Object} params
 * @param {string} params.companionId
 * @param {string} params.content
 * @param {string} params.clientMessageId
 * @param {AbortSignal} [params.signal]
 */
export function sendMessageStream({ companionId, content, clientMessageId, signal, ...handlers }) {
  return readSse({
    path: `/chat/${companionId}/messages`,
    body: { content, clientMessageId, stream: true },
    signal,
    ...handlers,
  });
}

/**
 * Asks for a reply again when the AI produced nothing for the last user
 * message. Does NOT consume a message from the daily allowance.
 * @param {Object} params
 * @param {string} params.companionId
 * @param {AbortSignal} [params.signal]
 */
export function regenerateStream({ companionId, signal, ...handlers }) {
  return readSse({
    path: `/chat/${companionId}/regenerate`,
    body: { stream: true },
    signal,
    ...handlers,
  });
}

/**
 * @param {Object} params
 * @param {string} params.path
 * @param {Record<string, unknown>} params.body
 * @param {(payload: any) => void} [params.onMeta]
 * @param {(text: string) => void} [params.onDelta]
 * @param {(payload: any) => void} [params.onDone]
 * @param {(error: ApiClientError) => void} [params.onError]
 * @param {AbortSignal} [params.signal]
 */
async function readSse({ path, body, signal, onMeta, onDelta, onDone, onError }) {
  const controller = new AbortController();
  const onExternalAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) {
      onError?.(new ApiClientError(ERROR_CODES.CANCELLED));
      return;
    }
    signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  // Safety net in case the socket half-opens and no event ever arrives.
  let timeout = setTimeout(() => controller.abort(new Error('stream-timeout')), CHAT_TIMEOUT_MS);
  const touch = () => {
    clearTimeout(timeout);
    timeout = setTimeout(() => controller.abort(new Error('stream-timeout')), CHAT_TIMEOUT_MS);
  };

  try {
    const response = await fetch(apiUrl(path), {
      method: 'POST',
      headers: {
        ...baseHeaders(),
        'content-type': 'application/json',
        accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
      credentials: 'include',
      signal: controller.signal,
    });

    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new ApiClientError(
        payload?.error?.code ??
          (response.status >= 500 ? ERROR_CODES.SERVER : ERROR_CODES.VALIDATION),
        payload?.error?.message,
        { status: response.status, details: payload?.error?.details ?? null },
      );
    }
    if (!response.body) throw new ApiClientError(ERROR_CODES.SERVER);

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let terminated = false;

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      touch();
      buffer += decoder.decode(value, { stream: true });

      let separator;
      while ((separator = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const rawEvent = buffer.slice(0, separator);
        buffer = buffer.slice(separator).replace(/^\r?\n\r?\n/, '');

        const event = parseEvent(rawEvent);
        if (!event) continue;

        if (event.name === 'meta') {
          onMeta?.(event.data);
        } else if (event.name === 'delta') {
          if (event.data?.text) onDelta?.(event.data.text);
        } else if (event.name === 'done') {
          terminated = true;
          onDone?.(event.data);
        } else if (event.name === 'error') {
          terminated = true;
          onError?.(
            new ApiClientError(
              event.data?.error?.code ?? ERROR_CODES.SERVER,
              event.data?.error?.message,
              { details: event.data?.error?.details ?? null },
            ),
          );
        }
      }
    }

    if (!terminated) {
      // The stream ended without a done/error frame (server restart, proxy cut).
      onError?.(new ApiClientError(ERROR_CODES.AI_UNAVAILABLE));
    }
  } catch (error) {
    if (error instanceof ApiClientError) {
      onError?.(error);
    } else if (signal?.aborted) {
      onError?.(new ApiClientError(ERROR_CODES.CANCELLED));
    } else if (error?.message === 'stream-timeout' || error?.name === 'AbortError') {
      onError?.(new ApiClientError(ERROR_CODES.AI_TIMEOUT));
    } else {
      onError?.(new ApiClientError(ERROR_CODES.NETWORK));
    }
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}

/** Parses one `event:`/`data:` block. */
function parseEvent(raw) {
  if (!raw.trim() || raw.startsWith(':')) return null;
  let name = 'message';
  const dataLines = [];

  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('event:')) name = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }

  if (dataLines.length === 0) return { name, data: null };
  const data = dataLines.join('\n');
  if (data === '[DONE]') return { name: 'done', data: null };
  try {
    return { name, data: JSON.parse(data) };
  } catch {
    return { name, data: null };
  }
}
