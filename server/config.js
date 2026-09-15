/**
 * Server configuration.
 *
 * Every value comes from the environment (see `.env.example`). Nothing secret is
 * ever imported into the client bundle: this module is server-only.
 */

import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';

import dotenv from 'dotenv';

import { DEFAULT_DAILY_MESSAGE_LIMIT, DEFAULT_USAGE_WINDOW_HOURS } from '../shared/companions.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Repository root (one level above /server). */
export const ROOT_DIR = path.resolve(__dirname, '..');

// Load `.env` from the repo root, but never override real environment values.
dotenv.config({ path: path.join(ROOT_DIR, '.env'), quiet: true });

const env = process.env;

/** @param {string} key @param {string} [fallback] */
function str(key, fallback = '') {
  const value = env[key];
  return value === undefined || value === null || value === '' ? fallback : String(value);
}

/** @param {string} key @param {number} fallback */
function num(key, fallback) {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** @param {string} key @param {boolean} fallback */
function bool(key, fallback) {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  return ['1', 'true', 'yes', 'on'].includes(String(raw).trim().toLowerCase());
}

const NODE_ENV = str('NODE_ENV', 'development');
const isProduction = NODE_ENV === 'production';

const DEFAULT_SESSION_SECRET = 'yaar-insecure-development-secret-change-me';

function resolveDatabasePath() {
  const raw = str('DATABASE_PATH', './data/yaar.sqlite');
  if (raw === ':memory:') return ':memory:';
  return path.isAbsolute(raw) ? raw : path.resolve(ROOT_DIR, raw);
}

function parseModelList() {
  const primary = str('HF_MODEL', 'Qwen/Qwen3-8B');
  const fallbacks = str('HF_MODEL_FALLBACKS')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);
  return [primary, ...fallbacks].filter((model, index, all) => all.indexOf(model) === index);
}

const sessionSecret = str('SESSION_SECRET', '') || (isProduction ? '' : DEFAULT_SESSION_SECRET);

export const config = {
  env: NODE_ENV,
  isProduction,
  isTest: NODE_ENV === 'test',

  server: {
    port: num('PORT', 8787),
    host: str('HOST', '0.0.0.0'),
    trustProxy: bool('TRUST_PROXY', false),
    /** CSP frame-ancestors. Defaults to * so previews / WebView shells work. */
    frameAncestors: str('FRAME_ANCESTORS', '*'),
    /** Absolute path of the built client (served in production). */
    clientDistPath: path.join(ROOT_DIR, 'dist'),
  },

  ai: {
    provider: str('AI_PROVIDER', 'huggingface').toLowerCase(),
    streaming: bool('AI_STREAMING', true),
    temperature: num('HF_TEMPERATURE', 0.85),
    topP: num('HF_TOP_P', 0.95),
    maxTokens: num('HF_MAX_TOKENS', 400),
    timeoutMs: num('HF_TIMEOUT_MS', 45_000),
    idleTimeoutMs: num('HF_IDLE_TIMEOUT_MS', 20_000),
    huggingface: {
      /**
       * Server-only credential. `HUGGINGFACE_API_KEY` is the documented name;
       * `HF_API_KEY` is accepted as an alias so existing deployment configs
       * keep working. It is never read from, or sent to, the client.
       */
      apiKey: str('HUGGINGFACE_API_KEY') || str('HF_API_KEY'),
      baseUrl: str('HF_BASE_URL', 'https://router.huggingface.co/v1').replace(/\/+$/, ''),
      models: parseModelList(),
      providerPin: str('HF_INFERENCE_PROVIDER'),
    },
    openaiCompatible: {
      apiKey: str('OPENAI_COMPATIBLE_API_KEY'),
      baseUrl: str('OPENAI_COMPATIBLE_BASE_URL', 'http://127.0.0.1:11434/v1').replace(/\/+$/, ''),
      model: str('OPENAI_COMPATIBLE_MODEL', 'qwen2.5:7b-instruct'),
    },
  },

  database: {
    path: resolveDatabasePath(),
    busyTimeoutMs: num('DATABASE_BUSY_TIMEOUT_MS', 5_000),
  },

  usage: {
    /** Exactly 20 user messages per rolling window by default. */
    dailyLimit: Math.max(1, Math.trunc(num('DAILY_MESSAGE_LIMIT', DEFAULT_DAILY_MESSAGE_LIMIT))),
    windowHours: Math.max(1, num('USAGE_WINDOW_HOURS', DEFAULT_USAGE_WINDOW_HOURS)),
    refundFailedMessages: bool('REFUND_FAILED_MESSAGES', true),
  },

  session: {
    cookieName: str('SESSION_COOKIE_NAME', 'yaar_sid'),
    cookieMaxAgeDays: Math.max(1, num('SESSION_COOKIE_MAX_AGE_DAYS', 365)),
    secret: sessionSecret,
    deviceIdHeader: str('DEVICE_ID_HEADER', 'x-yaar-device-id'),
  },

  rateLimit: {
    chatPerMinute: Math.max(1, num('CHAT_RATE_LIMIT_PER_MINUTE', 30)),
    sessionPerMinute: Math.max(1, num('SESSION_RATE_LIMIT_PER_MINUTE', 120)),
  },

  logLevel: str('LOG_LEVEL', isProduction ? 'info' : 'debug'),
};

/** Convenience flag used by the health endpoint and the UI banner. */
export function isAiConfigured() {
  if (config.ai.provider === 'openai-compatible') {
    return Boolean(config.ai.openaiCompatible.baseUrl);
  }
  return Boolean(config.ai.huggingface.apiKey);
}

/**
 * Warnings printed at boot. Keeps misconfiguration loud but non-fatal: the app
 * still runs and shows a friendly "AI not connected" state.
 * @returns {string[]}
 */
export function configWarnings() {
  /** @type {string[]} */
  const warnings = [];

  if (!isAiConfigured()) {
    warnings.push(
      config.ai.provider === 'huggingface'
        ? 'HUGGINGFACE_API_KEY is not set — chat replies will fail with a friendly "AI not connected" message. Add it to .env.'
        : 'OPENAI_COMPATIBLE_BASE_URL is not set — chat replies will fail.',
    );
  }

  if (config.session.secret === DEFAULT_SESSION_SECRET) {
    warnings.push(
      'SESSION_SECRET is using the insecure development default. Set a long random value before deploying.',
    );
  }

  if (config.isProduction && !config.session.secret) {
    throw new Error('SESSION_SECRET must be set when NODE_ENV=production.');
  }

  return warnings;
}
