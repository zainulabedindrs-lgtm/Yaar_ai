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

export const BAZAARLINK_DEFAULT_BASE_URL = 'https://api.bazaarlink.ai/v1';
export const BAZAARLINK_DEFAULT_MODEL = 'deepseek-v4-flash';

/** True inside a Vercel serverless function (read-only filesystem except /tmp). */
const isVercel = Boolean(env.VERCEL);

function resolveDatabasePath() {
  const fallback = isVercel ? '/tmp/yaar-pglite' : './data/pglite';
  const raw = str('DATABASE_PATH', fallback);
  if (raw === ':memory:' || raw.startsWith('memory://')) return ':memory:';
  return path.isAbsolute(raw) ? raw : path.resolve(ROOT_DIR, raw);
}

/**
 * TLS for Postgres. Supabase requires it; a local Postgres usually has none.
 * DATABASE_SSL=true|false overrides the guess.
 */
function resolveDatabaseSsl(url) {
  const raw = env.DATABASE_SSL;
  if (raw !== undefined && raw !== '') return bool('DATABASE_SSL', true);
  if (!url) return false;
  try {
    const { hostname } = new URL(url);
    return !['localhost', '127.0.0.1', '::1'].includes(hostname);
  } catch {
    return true;
  }
}

/** Supabase URL without a trailing slash (server + client share the project). */
const supabaseUrl = (str('SUPABASE_URL') || str('VITE_SUPABASE_URL')).replace(/\/+$/, '');
/** The PUBLIC key: new `sb_publishable_…` key, or the legacy anon JWT. */
const supabasePublishableKey =
  str('SUPABASE_PUBLISHABLE_KEY') ||
  str('SUPABASE_ANON_KEY') ||
  str('VITE_SUPABASE_PUBLISHABLE_KEY') ||
  str('VITE_SUPABASE_ANON_KEY');
const authRequired = bool('AUTH_REQUIRED', false);
const allowAnonymous = bool('ALLOW_ANONYMOUS', true);

function parseModelList() {
  const primary = str('HF_MODEL', 'Qwen/Qwen3-8B');
  const fallbacks = str('HF_MODEL_FALLBACKS')
    .split(',')
    .map((model) => model.trim())
    .filter(Boolean);
  return [primary, ...fallbacks].filter((model, index, all) => all.indexOf(model) === index);
}

/**
 * Detects when the configured provider is NOT a hosted model.
 *
 * This exists because a stand-in endpoint (the bundled mock, or a local server)
 * answering in place of a real model is indistinguishable from the outside — and
 * that is exactly how a chat ends up "repeating itself". The flags are reported
 * by `/api/health` and warned about at boot, so the active provider is always
 * visible instead of assumed.
 *
 * `local` — the base URL points at this machine (Ollama, LM Studio, mock…).
 * `demo`  — the bundled canned-reply stand-in is in use (never real AI).
 *
 * @returns {{ local: boolean, demo: boolean, host: string }}
 */
function detectProviderKind() {
  const provider = str('AI_PROVIDER', 'huggingface').toLowerCase();
  if (provider === 'bazaarlink') {
    let host = '';
    try {
      host = new URL(str('BAZAARLINK_BASE_URL', BAZAARLINK_DEFAULT_BASE_URL)).hostname;
    } catch {
      host = '';
    }
    return { local: false, demo: false, host };
  }
  if (provider !== 'openai-compatible') {
    return { local: false, demo: false, host: '' };
  }

  const baseUrl = str('OPENAI_COMPATIBLE_BASE_URL', 'http://127.0.0.1:11434/v1');
  const model = str('OPENAI_COMPATIBLE_MODEL', 'qwen2.5:7b-instruct');

  let host = '';
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    host = '';
  }

  const isLoopback = ['127.0.0.1', 'localhost', '::1', '0.0.0.0', '[::1]'].includes(host);
  const isBundledMock = /^yaar-mock/i.test(model);

  return { local: isLoopback, demo: isBundledMock, host };
}

const sessionSecret = str('SESSION_SECRET', '') || (isProduction ? '' : DEFAULT_SESSION_SECRET);
const providerKind = detectProviderKind();

export const config = {
  env: NODE_ENV,
  isProduction,
  isTest: NODE_ENV === 'test',

  server: {
    port: num('PORT', 8787),
    host: str('HOST', '0.0.0.0'),
    /** Vercel always sits behind its proxy, so trust it there by default. */
    trustProxy: bool('TRUST_PROXY', isVercel),
    /** CSP frame-ancestors. Defaults to * so previews / WebView shells work. */
    frameAncestors: str('FRAME_ANCESTORS', '*'),
    /** Absolute path of the built client (served in production). */
    clientDistPath: path.join(ROOT_DIR, 'dist'),
  },

  ai: {
    provider: str('AI_PROVIDER', 'huggingface').toLowerCase(),
    /** True when replies come from a machine-local endpoint, not a hosted model. */
    localProvider: providerKind.local,
    /** True when the bundled canned-reply stand-in is configured. */
    demoProvider: providerKind.demo,
    /** Host of the configured endpoint (diagnostics only). */
    providerHost: providerKind.host,
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
    bazaarlink: {
      /** Server-only credential — never bundled into the client. */
      apiKey: str('BAZAARLINK_API_KEY'),
      baseUrl: str('BAZAARLINK_BASE_URL', BAZAARLINK_DEFAULT_BASE_URL).replace(/\/+$/, ''),
      model: str('BAZAARLINK_MODEL', BAZAARLINK_DEFAULT_MODEL),
      /** Optional comma-separated fallbacks tried when the primary model fails. */
      fallbackModels: str('BAZAARLINK_MODEL_FALLBACKS')
        .split(',')
        .map((model) => model.trim())
        .filter(Boolean),
    },
  },

  auth: {
    /** Supabase Auth is active when the project URL + public key are set. */
    enabled: Boolean(supabaseUrl && supabasePublishableKey),
    supabaseUrl,
    publishableKey: supabasePublishableKey,
    /** Server-only. Used ONLY to delete the auth account on "Delete my account". */
    secretKey: str('SUPABASE_SECRET_KEY') || str('SUPABASE_SERVICE_ROLE_KEY'),
    /** Optional legacy HS256 JWT secret — lets the server verify tokens offline. */
    jwtSecret: str('SUPABASE_JWT_SECRET'),
    /** Every user-data route needs a verified Supabase login. */
    required: authRequired || !allowAnonymous,
    /** Anonymous (device-id) sessions are accepted when no token is sent. */
    allowAnonymous: allowAnonymous && !authRequired,
  },

  database: {
    /** Postgres connection string (Supabase). Empty → embedded PGlite. */
    url: str('DATABASE_URL') || str('POSTGRES_URL'),
    ssl: resolveDatabaseSsl(str('DATABASE_URL') || str('POSTGRES_URL')),
    /** Keep tiny on serverless: each function instance holds its own pool. */
    poolMax: Math.max(1, Math.trunc(num('DATABASE_POOL_MAX', isVercel ? 1 : 10))),
    /** PGlite data directory (local fallback only). ':memory:' for tests. */
    path: resolveDatabasePath(),
  },

  isVercel,

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
  if (config.ai.provider === 'bazaarlink') {
    return Boolean(config.ai.bazaarlink.apiKey && config.ai.bazaarlink.baseUrl);
  }
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
    const hints = {
      huggingface:
        'HUGGINGFACE_API_KEY is not set — chat replies will fail with a friendly "AI not connected" message. Add it to .env.',
      bazaarlink:
        'BAZAARLINK_API_KEY is not set — chat replies will fail with a friendly "AI not connected" message.',
    };
    warnings.push(
      hints[config.ai.provider] ?? 'OPENAI_COMPATIBLE_BASE_URL is not set — chat replies will fail.',
    );
  }

  if (config.auth.required && !config.auth.enabled) {
    warnings.push(
      'AUTH_REQUIRED=true (or ALLOW_ANONYMOUS=false) but SUPABASE_URL / SUPABASE_PUBLISHABLE_KEY are not set — nobody can sign in.',
    );
  }

  if (config.isVercel && !config.database.url) {
    warnings.push(
      'Running on Vercel without DATABASE_URL: data lives in an ephemeral /tmp PGlite database and WILL be lost. Set DATABASE_URL to your Supabase Postgres connection string.',
    );
  }

  if (config.ai.demoProvider) {
    warnings.push(
      'AI_PROVIDER=openai-compatible with the bundled stand-in model: replies are CANNED test text, ' +
        'not AI. For real conversations set AI_PROVIDER=huggingface and HUGGINGFACE_API_KEY in .env.',
    );
  } else if (config.ai.localProvider) {
    warnings.push(
      `The AI provider points at a machine-local endpoint (${config.ai.providerHost}). Replies come ` +
        'from that server, not a hosted model — make sure it is actually running a model.',
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
