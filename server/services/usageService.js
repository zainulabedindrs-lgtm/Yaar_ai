/**
 * Daily usage limit service.
 *
 * RULES (see README → "How the 20-message limit works"):
 *  - A user may send exactly `DAILY_MESSAGE_LIMIT` (default 20) USER messages
 *    per rolling 24 hour window.
 *  - Only accepted USER messages are counted. AI replies are never counted.
 *  - Typing, validation failures, requests rejected by the limit itself and
 *    (by default) AI failures that produced no text are NOT counted.
 *  - The window starts when the first message of that window is sent and
 *    expires 24 hours later; the counter then resets automatically.
 *  - Everything is stored server-side in SQLite keyed by the user id, so
 *    refreshing the page, clearing localStorage or switching browsers cannot
 *    reset it (the identity lives in a signed cookie / device header).
 */

import { config } from '../config.js';
import { ApiError } from '../utils/errors.js';
import * as usageRepo from '../db/repositories/usageRepository.js';
import * as usersRepo from '../db/repositories/usersRepository.js';

const HOUR_MS = 60 * 60 * 1000;

export function windowMs() {
  return config.usage.windowHours * HOUR_MS;
}

export function limit() {
  return config.usage.dailyLimit;
}

/**
 * @typedef {Object} UsageState
 * @property {number} limit            total user messages allowed per window
 * @property {number} used             successful user messages in this window
 * @property {number} remaining        how many are left
 * @property {number} windowHours
 * @property {number} windowStartedAt  epoch ms
 * @property {number} resetAt          epoch ms when the counter resets
 * @property {number} msUntilReset
 * @property {boolean} exhausted
 */

/**
 * Current usage for a user without consuming anything.
 * @param {string} userId
 * @param {number} [now]
 * @returns {UsageState}
 */
export function getUsageState(userId, now = Date.now()) {
  // Usage rows reference `users`, so make sure the user exists first.
  usersRepo.ensureUser(userId, now);
  const row = usageRepo.ensureUsageRow(userId, now, windowMs());

  // The window has passed → the counter is logically already zero. We persist
  // the roll so that concurrent requests stay consistent.
  if (now >= row.window_expires_at || row.messages_used > limit()) {
    const rolled = usageRepo.rollWindow(userId, now, windowMs());
    return toState(rolled, now);
  }

  return toState(row, now);
}

/**
 * Consumes one message from the allowance.
 *
 * MUST be called inside the same database transaction that inserts the user
 * message so that a crash can never count a message that was never stored.
 *
 * @param {string} userId
 * @param {number} [now]
 * @param {{ alreadyReset?: boolean }} [options] - set by `runTurn` when the
 *        window was already rolled in the same transaction.
 * @returns {UsageState}
 * @throws {ApiError} 429 LIMIT_REACHED when the allowance is exhausted
 */
export function consumeMessage(userId, now = Date.now(), options = {}) {
  usersRepo.ensureUser(userId, now);
  let row = usageRepo.ensureUsageRow(userId, now, windowMs());

  if (now >= row.window_expires_at) {
    row = usageRepo.rollWindow(userId, now, windowMs());
  } else if (options.alreadyReset) {
    row = usageRepo.getUsageRow(userId) ?? row;
  }

  if (row.messages_used >= limit()) {
    throw ApiError.limitReached(undefined, { usage: toState(row, now) });
  }

  const updated = usageRepo.incrementUsage(userId, now);
  return toState(updated, now);
}

/**
 * Gives a message back after an AI failure that produced no reply at all.
 * @param {string} userId
 * @returns {UsageState}
 */
export function refundMessage(userId, now = Date.now()) {
  if (!config.usage.refundFailedMessages) return getUsageState(userId, now);
  const row = usageRepo.decrementUsage(userId, now);
  return toState(row, now);
}

/** Development/testing only (exposed by a dev-only route). */
export function resetUsage(userId, now = Date.now()) {
  const row = usageRepo.resetUsage(userId, now, windowMs());
  return toState(row, now);
}

/**
 * Converts a database row into the public usage shape.
 *
 * This is the ONLY shape the API ever returns (it is also what the client
 * types against), so internal columns such as `lifetime_messages` never leak
 * into responses — including error payloads.
 *
 * @param {import('../db/repositories/usageRepository.js').UsageRow} row
 * @param {number} now
 * @returns {UsageState}
 */
function toState(row, now) {
  const used = Math.min(row.messages_used, limit());
  return {
    limit: limit(),
    used,
    remaining: Math.max(0, limit() - used),
    windowHours: config.usage.windowHours,
    windowStartedAt: row.window_started_at,
    resetAt: row.window_expires_at,
    msUntilReset: Math.max(0, row.window_expires_at - now),
    exhausted: used >= limit(),
  };
}

/** Human readable "comes back in" string used by server logs only. */
export function describeReset(state) {
  const hours = Math.floor(state.msUntilReset / HOUR_MS);
  const minutes = Math.round((state.msUntilReset % HOUR_MS) / 60000);
  return `${hours}h ${minutes}m`;
}
