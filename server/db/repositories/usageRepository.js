/**
 * usage_limits table access.
 *
 * This table is the ONLY authoritative record of how many user messages have
 * been sent in the current window. Nothing here is ever derived from the client.
 */

import { getDb } from '../database.js';

/**
 * @typedef {Object} UsageRow
 * @property {string} user_id
 * @property {number} window_started_at
 * @property {number} window_expires_at
 * @property {number} messages_used
 * @property {number} lifetime_messages
 * @property {number} updated_at
 */

/**
 * Reads the usage row, creating it (window starting now) when missing.
 * @param {string} userId
 * @param {number} now
 * @param {number} windowMs
 * @returns {UsageRow}
 */
export function ensureUsageRow(userId, now, windowMs) {
  const db = getDb();
  db.prepare(
    `INSERT INTO usage_limits
       (user_id, window_started_at, window_expires_at, messages_used, lifetime_messages, updated_at)
     VALUES (@userId, @now, @expiresAt, 0, 0, @now)
     ON CONFLICT (user_id) DO NOTHING`,
  ).run({ userId, now, expiresAt: now + windowMs });

  return /** @type {UsageRow} */ (getUsageRow(userId));
}

/** @param {string} userId @returns {UsageRow | undefined} */
export function getUsageRow(userId) {
  return /** @type {UsageRow | undefined} */ (
    getDb().prepare('SELECT * FROM usage_limits WHERE user_id = ?').get(userId)
  );
}

/** @param {string} userId @param {number} now @param {number} windowMs */
export function rollWindow(userId, now, windowMs) {
  getDb()
    .prepare(
      `UPDATE usage_limits
          SET window_started_at = @now,
              window_expires_at = @expiresAt,
              messages_used = 0,
              updated_at = @now
        WHERE user_id = @userId`,
    )
    .run({ userId, now, expiresAt: now + windowMs });
  return /** @type {UsageRow} */ (getUsageRow(userId));
}

/** @param {string} userId */
export function incrementUsage(userId, now = Date.now()) {
  getDb()
    .prepare(
      `UPDATE usage_limits
          SET messages_used = messages_used + 1,
              lifetime_messages = lifetime_messages + 1,
              updated_at = ?
        WHERE user_id = ?`,
    )
    .run(now, userId);
  return /** @type {UsageRow} */ (getUsageRow(userId));
}

/**
 * Gives a message back. Only used when the AI failed before producing anything.
 * Never drops below zero.
 * @param {string} userId
 */
export function decrementUsage(userId, now = Date.now()) {
  const db = getDb();
  db.prepare(
    `UPDATE usage_limits
        SET messages_used = MAX(messages_used - 1, 0),
            lifetime_messages = MAX(lifetime_messages - 1, 0),
            updated_at = @now
      WHERE user_id = @userId`,
  ).run({ userId, now });
  return /** @type {UsageRow} */ (getUsageRow(userId));
}

/** Development/testing helper — starts a brand new window for the user. */
export function resetUsage(userId, now = Date.now(), windowMs = 24 * 60 * 60 * 1000) {
  const db = getDb();
  const existing = getUsageRow(userId);
  if (!existing) return ensureUsageRow(userId, now, windowMs);
  return rollWindow(userId, now, windowMs);
}
