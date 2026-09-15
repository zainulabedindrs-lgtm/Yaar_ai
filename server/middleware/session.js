/**
 * Anonymous session middleware.
 *
 * Resolution order:
 *   1. `x-yaar-device-id` header  → deterministic user id (primary: also works
 *      when cookies are blocked inside WebViews / third-party iframes)
 *   2. signed session cookie      → previously issued user id
 *   3. neither                    → brand new random user id
 *
 * The resolved id is written back as a signed cookie so a client that only has
 * cookies (no localStorage) also keeps a stable identity.
 */

import { config } from '../config.js';
import * as usersRepo from '../db/repositories/usersRepository.js';
import { generateUserId, isValidUserId, userIdFromDeviceId } from '../utils/ids.js';
import { isValidDeviceId } from '../utils/validate.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** @type {import('express').RequestHandler} */
export function sessionMiddleware(req, res, next) {
  try {
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

    // Keep the cookie in sync (and alive) with the resolved identity.
    if (cookieUserId !== userId) {
      res.cookie(config.session.cookieName, userId, cookieOptions());
    }

    req.user = usersRepo.ensureUser(userId);
    next();
  } catch (error) {
    next(error);
  }
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
