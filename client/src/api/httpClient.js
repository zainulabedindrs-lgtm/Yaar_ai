/**
 * Thin fetch wrapper for the Yaar API.
 *
 * Responsibilities:
 *  - attach the anonymous device id and cookies
 *  - turn every failure (offline, timeout, HTTP error, malformed body) into an
 *    `ApiClientError` that carries a machine code plus a friendly message, so
 *    UI code never has to inspect status codes or parse error HTML
 *  - never surface a stack trace or raw server payload to the user
 */

import { ERROR_CODES, ERROR_MESSAGES } from '@shared/errors';

import { API_BASE_URL, REQUEST_TIMEOUT_MS } from '../config/appConfig.js';
import { getDeviceId } from '../utils/device.js';

export class ApiClientError extends Error {
  /**
   * @param {string} code
   * @param {string} [message]
   * @param {{ status?: number, details?: Record<string, unknown> }} [extra]
   */
  constructor(code, message, extra = {}) {
    super(message || ERROR_MESSAGES[code] || ERROR_MESSAGES[ERROR_CODES.SERVER]);
    this.name = 'ApiClientError';
    this.code = code;
    this.status = extra.status ?? 0;
    this.details = extra.details ?? null;
  }
}

/** Builds an absolute URL for the API, honouring VITE_API_BASE_URL. */
export function apiUrl(path) {
  const normalised = path.startsWith('/') ? path : `/${path}`;
  return `${API_BASE_URL}/api${normalised}`;
}

/** Headers common to every request. */
export function baseHeaders() {
  return {
    accept: 'application/json',
    [headersDeviceKey()]: getDeviceId(),
  };
}

function headersDeviceKey() {
  return 'x-yaar-device-id';
}

/**
 * @param {string} path    API path without the /api prefix
 * @param {Object} [options]
 * @param {string} [options.method]
 * @param {unknown} [options.body]
 * @param {number} [options.timeoutMs]
 * @param {AbortSignal} [options.signal]
 * @returns {Promise<any>}
 */
export async function apiRequest(path, options = {}) {
  const { method = 'GET', body, timeoutMs = REQUEST_TIMEOUT_MS, signal } = options;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(new Error('client-timeout')), timeoutMs);
  const onExternalAbort = () => controller.abort(signal?.reason);
  if (signal) {
    if (signal.aborted) throw new ApiClientError(ERROR_CODES.CANCELLED);
    signal.addEventListener('abort', onExternalAbort, { once: true });
  }

  try {
    const response = await fetch(apiUrl(path), {
      method,
      headers: {
        ...baseHeaders(),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      credentials: 'include',
      signal: controller.signal,
    });

    const payload = await readJson(response);

    if (!response.ok) {
      throw toApiError(response.status, payload);
    }

    return payload;
  } catch (error) {
    if (error instanceof ApiClientError) throw error;
    if (signal?.aborted) throw new ApiClientError(ERROR_CODES.CANCELLED);
    if (error?.name === 'AbortError' || error?.message === 'client-timeout') {
      throw new ApiClientError(ERROR_CODES.NETWORK, 'That took too long. Try again?');
    }
    // fetch() rejects with a TypeError when offline or the request is blocked.
    if (!navigatorOnline()) {
      throw new ApiClientError(ERROR_CODES.NETWORK);
    }
    throw new ApiClientError(ERROR_CODES.NETWORK);
  } finally {
    clearTimeout(timeout);
    signal?.removeEventListener('abort', onExternalAbort);
  }
}

/** @param {Response} response */
async function readJson(response) {
  const text = await response.text();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** @param {number} status @param {any} payload */
function toApiError(status, payload) {
  const code = payload?.error?.code;
  const message = payload?.error?.message;
  const details = payload?.error?.details;

  if (code) {
    return new ApiClientError(code, message, {
      status,
      details: details ?? null,
    });
  }

  if (status === 429) return new ApiClientError(ERROR_CODES.RATE_LIMITED, undefined, { status });
  if (status === 404) return new ApiClientError(ERROR_CODES.NOT_FOUND, undefined, { status });
  if (status >= 500) return new ApiClientError(ERROR_CODES.SERVER, undefined, { status });
  return new ApiClientError(ERROR_CODES.VALIDATION, undefined, { status });
}

function navigatorOnline() {
  return typeof navigator === 'undefined' || navigator.onLine !== false;
}
