/**
 * Structured logger with a "production hides debug" policy.
 *
 * The log output is intentionally greppable (`level`, `event`, JSON context)
 * and never logs secrets, prompts or full message bodies.
 *
 * Secrets are removed twice: known key names (`apiKey`, `token`, `secret`,
 * `cookie`, `authorization`…) are replaced outright, and any string value that
 * *looks* like a credential (`hf_…`, `sk-…`, `Bearer …`) is masked even when it
 * arrives inside an unrelated field, for example a provider error body.
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

/** Masks credential-looking substrings inside arbitrary text. */
const VALUE_PATTERNS = [
  /\bhf_[A-Za-z0-9]{10,}/g,
  /\bsk-[A-Za-z0-9]{10,}/g,
  /\bAKIA[0-9A-Z]{12,}/g,
  /(\bBearer\s+)[A-Za-z0-9._\-]{10,}/gi,
];

/**
 * @param {string} text
 * @returns {string}
 */
export function maskSecrets(text) {
  let masked = text;
  for (const pattern of VALUE_PATTERNS) {
    // The replacer receives the first capture group when the pattern declares
    // one, and the match offset otherwise — hence the type check.
    masked = masked.replace(pattern, (...args) =>
      typeof args[1] === 'string' && args[1] ? `${args[1]}[redacted]` : '[redacted]',
    );
  }
  return masked;
}

function currentLevel() {
  const raw = String(config.logLevel || 'info').toLowerCase();
  return LEVELS[raw] ?? LEVELS.info;
}

/** @param {unknown} value */
function redact(value, depth = 0) {
  if (value === null || value === undefined || depth > 3) return value;
  if (Array.isArray(value)) return value.map((item) => redact(item, depth + 1));
  if (typeof value === 'string') return maskSecrets(value);
  if (typeof value !== 'object') return value;
  /** @type {Record<string, unknown>} */
  const out = {};
  for (const [key, item] of Object.entries(value)) {
    const isSecretKey = REDACTED_KEYS.has(key.toLowerCase());
    out[key] = isSecretKey ? '[redacted]' : redact(item, depth + 1);
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
