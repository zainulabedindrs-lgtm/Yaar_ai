/**
 * usage_limits table access.
 *
 * This table is the ONLY authoritative record of how many user messages have
 * been sent in the current window. Nothing here is ever derived from the client.
 */

import { query, queryOne } from '../database.js';

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
 * With `{ lock: true }` the row stays locked until the surrounding transaction
 * ends, so two concurrent sends can never both slip under the limit.
 * @param {string} userId
 * @param {number} now
 * @param {number} windowMs
 * @param {{ lock?: boolean }} [options]
 * @returns {Promise<UsageRow>}
 */
export async function ensureUsageRow(userId, now, windowMs, { lock = false } = {}) {
  await query(
    `INSERT INTO usage_limits
       (user_id, window_started_at, window_expires_at, messages_used, lifetime_messages, updated_at)
     VALUES ($1, $2, $3, 0, 0, $2)
     ON CONFLICT (user_id) DO NOTHING`,
    [userId, now, now + windowMs],
  );
  return queryOne(`SELECT * FROM usage_limits WHERE user_id = $1${lock ? ' FOR UPDATE' : ''}`, [
    userId,
  ]);
}

/** @param {string} userId @returns {Promise<UsageRow | undefined>} */
export async function getUsageRow(userId) {
  return queryOne('SELECT * FROM usage_limits WHERE user_id = $1', [userId]);
}

/** @param {string} userId @param {number} now @param {number} windowMs */
export async function rollWindow(userId, now, windowMs) {
  return queryOne(
    `UPDATE usage_limits
        SET window_started_at = $2, window_expires_at = $3, messages_used = 0, updated_at = $2
      WHERE user_id = $1
      RETURNING *`,
    [userId, now, now + windowMs],
  );
}

/** @param {string} userId */
export async function incrementUsage(userId, now = Date.now()) {
  return queryOne(
    `UPDATE usage_limits
        SET messages_used = messages_used + 1,
            lifetime_messages = lifetime_messages + 1,
            updated_at = $2
      WHERE user_id = $1
      RETURNING *`,
    [userId, now],
  );
}

/**
 * Gives a message back. Only used when the AI failed before producing anything.
 * Never drops below zero.
 * @param {string} userId
 */
export async function decrementUsage(userId, now = Date.now()) {
  return queryOne(
    `UPDATE usage_limits
        SET messages_used = GREATEST(messages_used - 1, 0),
            lifetime_messages = GREATEST(lifetime_messages - 1, 0),
            updated_at = $2
      WHERE user_id = $1
      RETURNING *`,
    [userId, now],
  );
}

/** Development/testing helper — starts a brand new window for the user. */
export async function resetUsage(userId, now = Date.now(), windowMs = 24 * 60 * 60 * 1000) {
  const existing = await getUsageRow(userId);
  if (!existing) return ensureUsageRow(userId, now, windowMs);
  return rollWindow(userId, now, windowMs);
}
