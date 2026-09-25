/**
 * Typed API errors.
 *
 * The message attached to an `ApiError` is always safe to show to a human; raw
 * provider errors are logged server-side and mapped to a code instead.
 */

import { ERROR_CODES, ERROR_MESSAGES } from '../../shared/errors.js';

export class ApiError extends Error {
  /**
   * @param {number} status HTTP status code
   * @param {string} code machine-readable code from ERROR_CODES
   * @param {string} [message] user-facing override
   * @param {Record<string, unknown>} [details] extra JSON payload (e.g. usage info)
   */
  constructor(status, code, message, details) {
    super(message || ERROR_MESSAGES[code] || 'Something went wrong.');
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
    /** Marks errors that are safe to expose verbatim. */
    this.expose = true;
  }

  toJSON() {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.details ? { details: this.details } : {}),
      },
    };
  }

  static badRequest(code, message, details) {
    return new ApiError(400, code, message, details);
  }

  static validation(message) {
    return new ApiError(422, ERROR_CODES.VALIDATION, message);
  }

  static notFound(code = ERROR_CODES.NOT_FOUND, message) {
    return new ApiError(404, code, message);
  }

  static tooManyRequests(code = ERROR_CODES.RATE_LIMITED, message, details) {
    return new ApiError(429, code, message, details);
  }

  static limitReached(message, details) {
    return new ApiError(429, ERROR_CODES.LIMIT_REACHED, message, details);
  }

  static upstream(code = ERROR_CODES.AI_UNAVAILABLE, message, details) {
    return new ApiError(502, code, message, details);
  }

  static timeout(message, details) {
    return new ApiError(504, ERROR_CODES.AI_TIMEOUT, message, details);
  }

  static internal(message) {
    return new ApiError(500, ERROR_CODES.SERVER, message);
  }
}

/** Wraps anything thrown into an ApiError without leaking internals. */
export function toApiError(error) {
  if (error instanceof ApiError) return error;
  return ApiError.internal();
}
