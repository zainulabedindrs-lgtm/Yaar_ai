/**
 * OpenAI-compatible chat client.
 *
 * Hugging Face Inference Providers exposes an OpenAI-compatible router at
 * `https://router.huggingface.co/v1`, and so do local runtimes such as Ollama,
 * LM Studio and vLLM. One client therefore covers every provider Yaar supports —
 * which is why swapping the AI provider never touches the app logic.
 *
 * Responsibilities:
 *  - POST /chat/completions (streaming or not)
 *  - parse SSE deltas and feed them to `onDelta`
 *  - strip model reasoning blocks (Qwen3 ` thinking…<｜end▁of▁thinking｜>`)
 *  - try fallback models, and fall back to non-streaming if streaming is refused
 *  - map every upstream failure to a friendly ApiError
 *  - never leak the API key or raw provider payloads to the client
 */

import { ERROR_CODES } from '../../../shared/errors.js';
import { REASONING_CLOSE, REASONING_OPEN } from '../../../shared/reasoning.js';
import { logger } from '../../utils/logger.js';
import { ApiError } from '../../utils/errors.js';

/** Time to wait before retrying a rate-limited (429) request. */
const RATE_LIMIT_RETRY_DELAY_MS = 1_500;

/**
 * Removes model reasoning from a token stream without ever emitting a partial
 * tag to the UI. The markers come from `shared/reasoning.js` (see the note there
 * about how they are constructed).
 */
export class ReasoningFilter {
  constructor() {
    /** @type {'undecided'|'outside'|'inside'} */
    this.state = 'undecided';
    this.buffer = '';
  }

  /** @param {string} chunk @returns {string} the text that is safe to show */
  push(chunk) {
    if (!chunk) return '';
    this.buffer += chunk;
    let output = '';

    for (;;) {
      if (this.state === 'undecided') {
        const trimmedStart = this.buffer.trimStart();
        const leading = this.buffer.length - trimmedStart.length;

        if (trimmedStart.startsWith(REASONING_OPEN)) {
          this.buffer = trimmedStart.slice(REASONING_OPEN.length);
          this.state = 'inside';
          continue;
        }
        // The tag may still be arriving in pieces — wait before deciding.
        if (REASONING_OPEN.startsWith(trimmedStart) && this.buffer.length < REASONING_OPEN.length + 1) {
          return output;
        }
        this.state = 'outside';
        output += this.buffer.slice(leading);
        this.buffer = '';
        continue;
      }

      if (this.state === 'inside') {
        const closeIndex = this.buffer.indexOf(REASONING_CLOSE);
        if (closeIndex === -1) {
          // Reasoning text is discarded, but keep any suffix that might be the
          // beginning of the closing marker.
          const keep = partialTagSuffixLength(this.buffer, REASONING_CLOSE);
          this.buffer = keep > 0 ? this.buffer.slice(-keep) : '';
          return output;
        }
        this.buffer = this.buffer.slice(closeIndex + REASONING_CLOSE.length);
        this.state = 'outside';
        continue;
      }

      // outside
      const openIndex = this.buffer.indexOf(REASONING_OPEN);
      if (openIndex === -1) {
        // Hold back only a suffix that could still turn into the opening
        // marker, so real text is emitted immediately.
        const keep = partialTagSuffixLength(this.buffer, REASONING_OPEN);
        output += keep > 0 ? this.buffer.slice(0, this.buffer.length - keep) : this.buffer;
        this.buffer = keep > 0 ? this.buffer.slice(-keep) : '';
        return output;
      }
      output += this.buffer.slice(0, openIndex);
      this.buffer = this.buffer.slice(openIndex + REASONING_OPEN.length);
      this.state = 'inside';
    }
  }

  /** Flush whatever is still pending when the stream ends. */
  finish() {
    const remainder =
      this.state === 'inside' ? '' : this.state === 'undecided' ? this.buffer.trimStart() : this.buffer;
    this.buffer = '';
    return remainder;
  }
}

export class OpenAiCompatibleChatClient {
  /**
   * @param {Object} options
   * @param {string} options.id                 provider id used in logs / API responses
   * @param {string} options.label              human label
   * @param {string} options.baseUrl            e.g. https://router.huggingface.co/v1
   * @param {string} options.apiKey
   * @param {string[]} options.models           primary model first, then fallbacks
   * @param {string} [options.providerPin]      HF inference provider (e.g. "together")
   * @param {number} [options.temperature]
   * @param {number} [options.topP]
   * @param {number} [options.maxTokens]
   * @param {number} [options.timeoutMs]
   * @param {number} [options.idleTimeoutMs]
   * @param {boolean} [options.requiresKey]
   */
  constructor(options) {
    this.id = options.id;
    this.label = options.label;
    this.baseUrl = options.baseUrl.replace(/\/+$/, '');
    this.apiKey = options.apiKey || '';
    this.models = options.models.filter(Boolean);
    this.providerPin = options.providerPin || '';
    this.temperature = options.temperature ?? 0.85;
    this.topP = options.topP ?? 0.95;
    this.maxTokens = options.maxTokens ?? 400;
    this.timeoutMs = options.timeoutMs ?? 45_000;
    this.idleTimeoutMs = options.idleTimeoutMs ?? 20_000;
    this.requiresKey = options.requiresKey !== false;
  }

  get isConfigured() {
    return Boolean(this.baseUrl) && this.models.length > 0 && (!this.requiresKey || Boolean(this.apiKey));
  }

  get defaultModel() {
    return this.models[0] ?? '';
  }

  /**
   * Runs one chat turn, streaming deltas through `onDelta` when `stream` is true.
   *
   * @param {Object} params
   * @param {{role: string, content: string}[]} params.messages
   * @param {(text: string) => void} [params.onDelta]
   * @param {AbortSignal} [params.signal]
   * @param {boolean} [params.stream]
   * @returns {Promise<{ text: string, model: string, provider: string, finishReason: string|null }>}
   */
  async chat({ messages, onDelta, signal, stream = true }) {
    if (!this.isConfigured) {
      throw ApiError.upstream(
        ERROR_CODES.AI_NOT_CONFIGURED,
        'Yaar is not connected to an AI provider yet.',
      );
    }

    /** @type {unknown} */
    let lastError;
    const errors = [];

    // Strategy: try to stream the primary model, then the same model without
    // streaming (some providers/models refuse SSE), then every fallback model.
    for (const model of this.models) {
      for (const useStreaming of stream ? [true, false] : [false]) {
        try {
          return await this.#attempt({ model, messages, onDelta, signal, stream: useStreaming });
        } catch (error) {
          lastError = error;
          const apiError = error instanceof ApiError ? error : ApiError.upstream();

          // Never retry bad credentials or a user cancellation.
          if (
            apiError.code === ERROR_CODES.AI_NOT_CONFIGURED ||
            apiError.code === ERROR_CODES.CANCELLED ||
            signal?.aborted
          ) {
            throw apiError;
          }

          errors.push({ model, stream: useStreaming, code: apiError.code, status: apiError.status });
          logger.warn('ai attempt failed', {
            provider: this.id,
            model,
            stream: useStreaming,
            status: apiError.status,
            code: apiError.code,
          });
        }
      }
    }

    logger.error('ai all attempts failed', { provider: this.id, errors });

    if (lastError instanceof ApiError) throw lastError;
    throw ApiError.upstream(ERROR_CODES.AI_UNAVAILABLE);
  }

  /**
   * Builds the completions endpoint, preserving any query string the configured
   * base URL carries (useful for proxies, Azure-style `?api-version=` and the
   * local mock provider).
   */
  #endpointUrl() {
    try {
      const url = new URL(this.baseUrl);
      url.pathname = `${url.pathname.replace(/\/+$/, '')}/chat/completions`;
      return url.toString();
    } catch {
      return `${this.baseUrl}/chat/completions`;
    }
  }

  /** One HTTP attempt against one model. */
  async #attempt({ model, messages, onDelta, signal, stream }) {
    const controller = new AbortController();
    const onExternalAbort = () => controller.abort(signal?.reason);
    if (signal) {
      if (signal.aborted) throw new ApiError(499, ERROR_CODES.CANCELLED);
      signal.addEventListener('abort', onExternalAbort, { once: true });
    }

    // Timers abort through the controller; we remember WHY so the failure can be
    // reported as a timeout (504) rather than a generic provider error (502).
    let timedOut = false;
    const abortWithTimeout = () => {
      timedOut = true;
      controller.abort();
    };
    let timeoutId = setTimeout(abortWithTimeout, this.timeoutMs);

    /** Resets the inactivity timer after every chunk/byte. */
    const touch = () => {
      clearTimeout(timeoutId);
      timeoutId = setTimeout(abortWithTimeout, this.idleTimeoutMs);
    };

    const url = this.#endpointUrl();
    const body = {
      model: this.#resolveModel(model),
      messages,
      temperature: this.temperature,
      top_p: this.topP,
      max_tokens: this.maxTokens,
      stream: Boolean(stream),
    };
    if (stream) body.stream_options = { include_usage: true };

    /** @type {Record<string,string>} */
    const headers = {
      'content-type': 'application/json',
      accept: stream ? 'text/event-stream' : 'application/json',
      'user-agent': 'yaar-ai-companion/1.0',
    };
    if (this.apiKey) headers.authorization = `Bearer ${this.apiKey}`;

    const startedAt = Date.now();
    let response;

    try {
      response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });
    } catch (error) {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onExternalAbort);
      if (signal?.aborted) throw new ApiError(499, ERROR_CODES.CANCELLED);
      if (timedOut || error?.name === 'AbortError' || error?.name === 'TimeoutError') {
        throw ApiError.timeout();
      }
      logger.warn('ai network error', { provider: this.id, model, message: String(error?.message) });
      throw ApiError.upstream(ERROR_CODES.AI_UNAVAILABLE);
    }

    if (!response.ok) {
      const errorBody = await safeReadText(response);
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onExternalAbort);
      throw this.#mapHttpError(response.status, errorBody, model);
    }

    try {
      if (stream) {
        const result = await this.#consumeStream({
          response,
          model,
          onDelta,
          touch,
        });
        this.#logSuccess({ model, startedAt, chars: result.text.length, stream: true });
        return result;
      }

      const payload = await response.json();
      // Non-streaming replies can carry a reasoning block as well, so the same
      // filter runs on them.
      const filter = new ReasoningFilter();
      const text = `${filter.push(extractMessageText(payload))}${filter.finish()}`.trim();
      if (!text) throw ApiError.upstream(ERROR_CODES.AI_EMPTY);
      if (onDelta) onDelta(text);
      this.#logSuccess({ model, startedAt, chars: text.length, stream: false });
      return {
        text,
        model,
        provider: this.id,
        finishReason: payload?.choices?.[0]?.finish_reason ?? null,
      };
    } catch (error) {
      if (error instanceof ApiError) throw error;
      if (signal?.aborted) throw new ApiError(499, ERROR_CODES.CANCELLED);
      if (timedOut || error?.name === 'AbortError') {
        throw ApiError.timeout();
      }
      logger.warn('ai stream error', { provider: this.id, model, message: String(error?.message) });
      throw ApiError.upstream(ERROR_CODES.AI_UNAVAILABLE);
    } finally {
      clearTimeout(timeoutId);
      signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  /** Reads the SSE body and emits deltas as they arrive. */
  async #consumeStream({ response, model, onDelta, touch }) {
    if (!response.body) throw ApiError.upstream(ERROR_CODES.AI_UNAVAILABLE);

    const reader = response.body.getReader();
    const decoder = new TextDecoder('utf-8');
    const filter = new ReasoningFilter();

    let buffer = '';
    let text = '';
    let finishReason = null;

    const emit = (chunk) => {
      if (!chunk) return;
      text += chunk;
      if (onDelta) onDelta(chunk);
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      touch();

      buffer += decoder.decode(value, { stream: true });

      // SSE events are separated by a blank line.
      let separatorIndex;
      while ((separatorIndex = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const rawEvent = buffer.slice(0, separatorIndex);
        buffer = buffer.slice(separatorIndex).replace(/^\r?\n\r?\n/, '');
        const parsed = parseSseEvent(rawEvent);

        if (parsed === DONE_SENTINEL) {
          emit(filter.finish());
          return { text, model, provider: this.id, finishReason };
        }
        if (!parsed) continue;

        if (parsed.error) {
          logger.warn('ai stream returned error payload', {
            provider: this.id,
            model,
            message: parsed.error?.message ?? 'unknown',
          });
          throw ApiError.upstream(ERROR_CODES.AI_UNAVAILABLE);
        }

        const choice = parsed.choices?.[0];
        if (choice?.finish_reason) finishReason = choice.finish_reason;
        const delta =
          typeof choice?.delta?.content === 'string'
            ? choice.delta.content
            : typeof choice?.text === 'string'
              ? choice.text
              : '';
        if (delta) emit(filter.push(delta));
      }
    }

    emit(filter.finish());

    if (!text.trim()) throw ApiError.upstream(ERROR_CODES.AI_EMPTY);

    return { text, model, provider: this.id, finishReason };
  }

  /** Hugging Face accepts "model:provider"; a pin can also come from config. */
  #resolveModel(model) {
    if (this.id !== 'huggingface') return model;
    if (model.includes(':')) return model;
    return this.providerPin ? `${model}:${this.providerPin}` : model;
  }

  #mapHttpError(status, bodyText, model) {
    const snippet = String(bodyText || '').slice(0, 600);
    logger.warn('ai http error', { provider: this.id, model, status, body: snippet });

    if (status === 401 || status === 403) {
      return ApiError.upstream(
        ERROR_CODES.AI_NOT_CONFIGURED,
        'The AI provider rejected our credentials. Check HUGGINGFACE_API_KEY on the server.',
      );
    }
    if (status === 429) {
      return ApiError.tooManyRequests(
        ERROR_CODES.RATE_LIMITED,
        'The AI service is busy right now — try again in a few seconds?',
      );
    }
    if (status === 404 || status === 400) {
      return ApiError.upstream(ERROR_CODES.AI_UNAVAILABLE, undefined, { status, model });
    }
    if (status === 503 || status === 504) {
      return ApiError.upstream(ERROR_CODES.AI_UNAVAILABLE, undefined, { status });
    }
    return ApiError.upstream(ERROR_CODES.AI_UNAVAILABLE, undefined, { status });
  }

  #logSuccess({ model, startedAt, chars, stream }) {
    logger.info('ai reply generated', {
      provider: this.id,
      model,
      stream,
      chars,
      ms: Date.now() - startedAt,
    });
  }
}

/**
 * Length of the longest suffix of `text` that is also a prefix of `tag`.
 * Used to hold back only the characters that might still become a tag.
 */
function partialTagSuffixLength(text, tag) {
  const max = Math.min(text.length, tag.length - 1);
  for (let length = max; length > 0; length -= 1) {
    if (text.endsWith(tag.slice(0, length))) return length;
  }
  return 0;
}

const DONE_SENTINEL = Symbol('sse-done');

/**
 * Parses one SSE event block.
 * @param {string} raw
 * @returns {any | null | typeof DONE_SENTINEL}
 */
function parseSseEvent(raw) {
  const dataLines = raw
    .split(/\r?\n/)
    .filter((line) => line.startsWith('data:'))
    .map((line) => line.slice(5).trim());

  if (dataLines.length === 0) return null;
  const data = dataLines.join('\n');
  if (data === '[DONE]') return DONE_SENTINEL;
  try {
    return JSON.parse(data);
  } catch {
    return null;
  }
}

/** Extracts assistant text from a non-streaming completion payload. */
export function extractMessageText(payload) {
  const message = payload?.choices?.[0]?.message;
  if (!message) return '';
  if (typeof message.content === 'string') return message.content;
  if (Array.isArray(message.content)) {
    return message.content
      .map((part) => (typeof part === 'string' ? part : part?.text ?? ''))
      .join('');
  }
  return '';
}

/** @param {Response} response */
async function safeReadText(response) {
  try {
    return await response.text();
  } catch {
    return '';
  }
}
