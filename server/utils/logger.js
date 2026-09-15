/**
 * Structured logger with a "production hides debug" policy.
 *
 * The log output is intentionally greppable (`level`, `event`, JSON context)
 * and never logs secrets, prompts or full message bodies.
 */

import { config } from '../config.js';

const LEVELS = { debug: 10, info: 20, warn: 30, error: 40, silent: 100 };

const REDACTED_KEYS = new Set([
  'apikey',
  'api_key',
  'authorization',
  'cookie',
  'hf_api_key',
  'password',
  'secret',
  'session_secret',
  'token',
]);

function currentLevel() {
  const raw = String(config.logLevel || 'info').toLowerCase();
  return LEVELS[raw] ?? LEVELS.info;
}

/** @param {unknown} value */
function redact(value, depth = 0) {
  if (value === null || value === undefined || depth > 3) return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (typeof value !== 'object') return value;
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    out[key] = REDACTED_KEYS.has(key.toLowerCase()) ? '[redacted]' : redact(item, depth + 1);
  }
  return out;
}

/** @param {'debug'|'info'|'warn'|'error'} level @param {string} event @param {Record<string, unknown>} [context] */
function write(level, event, context) {
  if (LEVELS[level] < currentLevel()) return;
  const line = {
    ts: new Date().toISOString(),
    level,
    event,
    ...(context ? /** @type {Record<string, unknown>} */ (redact(context)) : {}),
  };
  const serialised = JSON.stringify(line);
  if (level === 'error') console.error(serialised);
  else if (level === 'warn') console.warn(serialised);
  else console.log(serialised);
}

export const logger = {
  debug: (event, context) => write('debug', event, context),
  info: (event, context) => write('info', event, context),
  warn: (event, context) => write('warn', event, context),
  error: (event, context) => write('error', event, context),
};
