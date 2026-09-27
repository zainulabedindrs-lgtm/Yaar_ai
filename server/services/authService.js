/**
 * Supabase Auth — server-side token verification.
 *
 * The browser signs in with supabase-js and sends its access token as
 * `Authorization: Bearer <jwt>`. The server derives the user id ONLY from a
 * token whose signature it has verified; any user id the frontend might send
 * (body, query, headers) is ignored.
 *
 * Verification strategy, fastest first:
 *   1. Asymmetric keys (RS256 / ES256 — Supabase's current signing keys):
 *      verified locally against the project's public JWKS
 *      (`{SUPABASE_URL}/auth/v1/.well-known/jwks.json`, cached by `jose`).
 *   2. Legacy HS256 tokens + `SUPABASE_JWT_SECRET` set: verified locally.
 *   3. Otherwise: asks Supabase itself (`GET /auth/v1/user`), cached briefly.
 * In every case issuer, audience ("authenticated") and expiry are enforced.
 */

import crypto from 'node:crypto';

import { createRemoteJWKSet, decodeProtectedHeader, jwtVerify } from 'jose';

import { ERROR_CODES } from '../../shared/errors.js';
import { config } from '../config.js';
import { ApiError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/** Prefix for users.id of Supabase accounts (anonymous ids start with `usr_`). */
export const SUPABASE_USER_PREFIX = 'sb_';

const USER_CACHE_TTL_MS = 60_000;
const USER_CACHE_MAX = 5_000;

/** @type {ReturnType<typeof createRemoteJWKSet> | null} */
let jwks = null;
let jwksUrl = '';

/** @type {Map<string, { identity: AuthIdentity, expiresAt: number }>} */
const remoteCache = new Map();

/**
 * @typedef {Object} AuthIdentity
 * @property {string} userId   internal users.id (`sb_<supabase uuid>`)
 * @property {string} subject  Supabase user id (uuid)
 * @property {string|null} email
 */

function issuer() {
  return `${config.auth.supabaseUrl}/auth/v1`;
}

function getJwks() {
  const url = `${issuer()}/.well-known/jwks.json`;
  if (!jwks || jwksUrl !== url) {
    jwks = createRemoteJWKSet(new URL(url), { cacheMaxAge: 10 * 60_000 });
    jwksUrl = url;
  }
  return jwks;
}

/** @param {string} subject */
export function userIdForSubject(subject) {
  return `${SUPABASE_USER_PREFIX}${subject}`;
}

/** @param {any} claims @returns {AuthIdentity} */
function identityFromClaims(claims) {
  const subject = typeof claims?.sub === 'string' ? claims.sub : '';
  if (!/^[A-Za-z0-9-]{8,64}$/.test(subject)) throw unauthorized();
  // Supabase anonymous sign-ins are not real accounts.
  if (claims.is_anonymous === true) throw unauthorized();
  return {
    userId: userIdForSubject(subject),
    subject,
    email: typeof claims.email === 'string' ? claims.email : null,
  };
}

function unauthorized(message = 'Please sign in again.') {
  return new ApiError(401, ERROR_CODES.UNAUTHORIZED, message);
}

/**
 * Verifies a Supabase access token.
 * @param {string} token
 * @returns {Promise<AuthIdentity>}
 * @throws {ApiError} 401 when the token is missing, forged, expired or foreign
 */
export async function verifyAccessToken(token) {
  if (!config.auth.enabled) throw unauthorized('Sign-in is not enabled on this server.');
  if (!token || token.length > 8_192) throw unauthorized();

  let header;
  try {
    header = decodeProtectedHeader(token);
  } catch {
    throw unauthorized();
  }

  const verifyOptions = { issuer: issuer(), audience: 'authenticated', clockTolerance: 30 };

  try {
    if (header.alg === 'HS256') {
      if (config.auth.jwtSecret) {
        const { payload } = await jwtVerify(
          token,
          new TextEncoder().encode(config.auth.jwtSecret),
          { ...verifyOptions, algorithms: ['HS256'] },
        );
        return identityFromClaims(payload);
      }
      return await verifyWithSupabase(token);
    }

    const { payload } = await jwtVerify(token, getJwks(), {
      ...verifyOptions,
      algorithms: ['RS256', 'ES256', 'EdDSA'],
    });
    return identityFromClaims(payload);
  } catch (error) {
    if (error instanceof ApiError) throw error;
    logger.debug('auth token rejected', { reason: String(error?.code || error?.message) });
    throw unauthorized();
  }
}

/** Fallback: let Supabase validate the token (legacy HS256 without a local secret). */
async function verifyWithSupabase(token) {
  const cacheKey = crypto.createHash('sha256').update(token).digest('hex');
  const cached = remoteCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return cached.identity;

  let response;
  try {
    response = await fetch(`${issuer()}/user`, {
      headers: { apikey: config.auth.publishableKey, authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(8_000),
    });
  } catch (error) {
    logger.error('supabase auth unreachable', { message: String(error?.message) });
    throw new ApiError(503, ERROR_CODES.SERVER, 'Sign-in is temporarily unavailable.');
  }
  if (!response.ok) throw unauthorized();

  const user = await response.json().catch(() => null);
  const identity = identityFromClaims({
    sub: user?.id,
    email: user?.email,
    is_anonymous: user?.is_anonymous,
  });

  if (remoteCache.size >= USER_CACHE_MAX) remoteCache.clear();
  remoteCache.set(cacheKey, { identity, expiresAt: Date.now() + USER_CACHE_TTL_MS });
  return identity;
}

/**
 * Deletes the Supabase Auth account (Settings → Delete my account).
 * Needs SUPABASE_SECRET_KEY; without it only Yaar's own data is deleted.
 * @param {string} subject Supabase user id
 * @returns {Promise<boolean>} true when the auth account was removed
 */
export async function deleteAuthUser(subject) {
  const key = config.auth.secretKey;
  if (!config.auth.enabled || !key) return false;

  /** @type {Record<string, string>} */
  const headers = { apikey: key };
  // Legacy service_role keys are JWTs and also go in Authorization; the new
  // `sb_secret_…` keys are sent in `apikey` only.
  if (key.startsWith('eyJ')) headers.authorization = `Bearer ${key}`;

  try {
    const response = await fetch(
      `${issuer()}/admin/users/${encodeURIComponent(subject)}`,
      { method: 'DELETE', headers, signal: AbortSignal.timeout(10_000) },
    );
    if (!response.ok && response.status !== 404) {
      logger.error('supabase account deletion failed', { status: response.status });
      return false;
    }
    return true;
  } catch (error) {
    logger.error('supabase account deletion failed', { message: String(error?.message) });
    return false;
  }
}

/** Public, non-secret auth settings for the client. */
export function publicAuthConfig() {
  return {
    enabled: config.auth.enabled,
    required: config.auth.required,
    allowAnonymous: config.auth.allowAnonymous,
    supabaseUrl: config.auth.enabled ? config.auth.supabaseUrl : null,
    publishableKey: config.auth.enabled ? config.auth.publishableKey : null,
  };
}

/** Test helper. */
export function resetAuthCaches() {
  jwks = null;
  jwksUrl = '';
  remoteCache.clear();
}
