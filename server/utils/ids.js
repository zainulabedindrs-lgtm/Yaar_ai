/**
 * Identity helpers.
 *
 * Yaar has no login yet, so identity is an anonymous, device-scoped id:
 *
 *   device id (client, localStorage)  --HMAC(secret)-->  user id (server)
 *
 * Hashing keeps raw client values out of the database, and because the id is
 * deterministic the same device always maps to the same user — which is exactly
 * what makes the daily limit survive page refreshes, cache clears of cookies,
 * and iframe/third-party-cookie edge cases (e.g. the mobile WebView).
 *
 * When real authentication arrives, `users.auth_subject` gets a value and this
 * module is the only place that needs to change.
 */

import crypto from 'node:crypto';

import { config } from '../config.js';
import { isValidDeviceId } from './validate.js';

const USER_ID_PREFIX = 'usr_';

/** Random, server-issued user id (used when no device id is available). */
export function generateUserId() {
  return `${USER_ID_PREFIX}${crypto.randomUUID()}`;
}

/**
 * Deterministic id for a device id.
 * @param {string} deviceId
 */
export function userIdFromDeviceId(deviceId) {
  const digest = crypto
    .createHmac('sha256', config.session.secret)
    .update(`device:${deviceId}`)
    .digest('hex')
    .slice(0, 40);
  return `${USER_ID_PREFIX}d${digest}`;
}

/** @param {unknown} value */
export function isValidUserId(value) {
  return typeof value === 'string' && /^usr_[A-Za-z0-9_-]{8,80}$/.test(value);
}

/**
 * Short, non-reversible reference shown in Settings ("Session ID: 4f9c2a1b").
 * The full id never needs to leave the server.
 * @param {string} userId
 */
export function publicSessionRef(userId) {
  return crypto.createHash('sha256').update(userId).digest('hex').slice(0, 12);
}

export { isValidDeviceId };
