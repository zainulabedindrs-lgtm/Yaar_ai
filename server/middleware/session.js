/**
 * Identity middleware — decides WHO is calling, from server-verified data only.
 *
 * Resolution order:
 *   1. `Authorization: Bearer <supabase access token>` → verified JWT → the
 *      Supabase account (`sb_<uuid>`). An invalid/expired token is a 401 — it
 *      is never silently downgraded to an anonymous session.
 *   2. No token and anonymous use allowed (ALLOW_ANONYMOUS=true,
 *      AUTH_REQUIRED=false) → anonymous device session:
 *        a. `x-yaar-device-id` header → deterministic HMAC'd user id
 *        b. signed session cookie     → previously issued user id
 *        c. neither                   → brand new random user id
 *   3. No token and login required → `req.userId` stays unset; routes guarded
 *      by `requireUser` answer 401.
 *
 * A user id supplied by the frontend (body, query, custom header) is NEVER
 * used: ids only come from a verified token or from server-side derivation.
 */

import { config } from '../config.js';
import * as usersRepo from '../db/repositories/usersRepository.js';
import { verifyAccessToken } from '../services/authService.js';
import { ApiError } from '../utils/errors.js';
import { ERROR_CODES } from '../../shared/errors.js';
import { generateUserId, isValidUserId, userIdFromDeviceId } from '../utils/ids.js';
import { isValidDeviceId } from '../utils/validate.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** @type {import('express').RequestHandler} */
export async function sessionMiddleware(req, res, next) {
  try {
    const token = readBearerToken(req);

    if (token) {
      const identity = await verifyAccessToken(token); // throws 401
      req.userId = identity.userId;
      req.auth = { provider: 'supabase', subject: identity.subject, email: identity.email };
      req.user = await usersRepo.ensureUser(identity.userId, Date.now(), {
        provider: 'supabase',
        subject: identity.subject,
        email: identity.email,
      });
      return next();
    }

    if (!config.auth.allowAnonymous) {
      req.userId = undefined;
      req.auth = null;
      return next();
    }

    const deviceId = readDeviceId(req);
    const cookieUserId = req.signedCookies?.[config.session.cookieName];

    /** @type {string} */
    let userId;
    if (deviceId) {
      userId = userIdFromDeviceId(deviceId);
    } else if (typeof cookieUserId === 'string' && isValidUserId(cookieUserId)) {
      userId = cookieUserId;
    } else {
      userId = generateUserId();
    }

    req.userId = userId;
    req.auth = { provider: 'anonymous', subject: null, email: null };

    // Keep the cookie in sync (and alive) with the resolved identity.
    if (cookieUserId !== userId) {
      res.cookie(config.session.cookieName, userId, cookieOptions());
    }

    req.user = await usersRepo.ensureUser(userId);
    next();
  } catch (error) {
    next(error);
  }
}

/**
 * Guards user-data routes. Mount AFTER `sessionMiddleware`.
 * @type {import('express').RequestHandler}
 */
export function requireUser(req, _res, next) {
  if (req.userId) return next();
  next(new ApiError(401, ERROR_CODES.UNAUTHORIZED));
}

/** @param {import('express').Request} req */
function readBearerToken(req) {
  const header = req.get('authorization');
  if (!header) return null;
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  return match ? match[1].trim() : null;
}

/** @param {import('express').Request} req */
function readDeviceId(req) {
  const raw = req.get(config.session.deviceIdHeader) || req.get('x-yaar-device-id');
  if (!raw) return null;
  const value = String(raw).trim();
  return isValidDeviceId(value) ? value : null;
}

function cookieOptions() {
  return {
    httpOnly: true,
    sameSite: 'lax',
    secure: config.isProduction,
    signed: true,
    path: '/',
    maxAge: config.session.cookieMaxAgeDays * DAY_MS,
  };
}
