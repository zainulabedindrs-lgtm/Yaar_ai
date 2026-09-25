/**
 * Tiny in-memory sliding-window rate limiter.
 *
 * The daily message limit is the real product rule; this is purely abuse
 * protection (login-less apps get scraped). Single-process only — if Yaar is
 * ever scaled horizontally, move this to Redis or a shared store and keep the
 * same middleware signature.
 */

import { ERROR_CODES, ERROR_MESSAGES } from '../../shared/errors.js';

const MAX_TRACKED_KEYS = 10_000;

/**
 * @param {Object} options
 * @param {number} options.limit        requests allowed per window
 * @param {number} options.windowMs
 * @param {(req: import('express').Request) => string} [options.keyGenerator]
 * @param {string} [options.message]
 * @returns {import('express').RequestHandler}
 */
export function createRateLimiter({ limit, windowMs, keyGenerator, message }) {
  /** @type {Map<string, number[]>} */
  const hits = new Map();

  // Keep the map from growing without bound on a long-running process.
  const sweep = () => {
    if (hits.size <= MAX_TRACKED_KEYS) return;
    const cutoff = Date.now() - windowMs;
    for (const [key, timestamps] of hits) {
      const fresh = timestamps.filter((time) => time > cutoff);
      if (fresh.length === 0) hits.delete(key);
      else hits.set(key, fresh);
    }
  };

  return function rateLimiter(req, res, next) {
    const key = keyGenerator ? keyGenerator(req) : defaultKey(req);
    const now = Date.now();
    const windowStart = now - windowMs;
    const timestamps = (hits.get(key) ?? []).filter((time) => time > windowStart);

    if (timestamps.length >= limit) {
      const retryAfterSeconds = Math.max(
        1,
        Math.ceil((timestamps[0] + windowMs - now) / 1000),
      );
      res.set('retry-after', String(retryAfterSeconds));
      res.status(429).json({
        error: {
          code: ERROR_CODES.RATE_LIMITED,
          message: message || ERROR_MESSAGES[ERROR_CODES.RATE_LIMITED],
          details: { retryAfterSeconds },
        },
      });
      return;
    }

    timestamps.push(now);
    hits.set(key, timestamps);
    sweep();
    next();
  };
}

/** Express `trust proxy` aware client key. */
function defaultKey(req) {
  if (req.userId) return `user:${req.userId}`;
  return `ip:${req.ip || 'unknown'}`;
}

/** Per-user limiter key (falls back to IP before the session exists). */
export function userKeyGenerator(req) {
  return `user:${req.userId || req.ip || 'unknown'}`;
}
