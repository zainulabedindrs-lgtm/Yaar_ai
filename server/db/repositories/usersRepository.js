/**
 * users table access.
 *
 * A "user" is an anonymous session today. When real authentication is added the
 * only thing that changes is how `id` / `auth_subject` are produced — the rest
 * of the app keeps working because everything else keys off `user_id`.
 */

import { getDb } from '../database.js';

/** @typedef {{ id: string, display_name: string|null, auth_provider: string, auth_subject: string|null, created_at: number, last_seen_at: number }} UserRow */

/**
 * Creates the user on first contact, otherwise only refreshes `last_seen_at`.
 * @param {string} userId
 * @param {number} now epoch ms
 * @returns {UserRow}
 */
export function ensureUser(userId, now = Date.now()) {
  const db = getDb();
  db.prepare(
    `INSERT INTO users (id, display_name, auth_provider, auth_subject, created_at, last_seen_at)
     VALUES (@id, NULL, 'anonymous', NULL, @now, @now)
     ON CONFLICT (id) DO UPDATE SET last_seen_at = excluded.last_seen_at`,
  ).run({ id: userId, now });

  return /** @type {UserRow} */ (getUser(userId));
}

/** @param {string} userId @returns {UserRow | undefined} */
export function getUser(userId) {
  return /** @type {UserRow | undefined} */ (
    getDb().prepare('SELECT * FROM users WHERE id = ?').get(userId)
  );
}

/** @param {string} userId */
export function touchUser(userId, now = Date.now()) {
  getDb().prepare('UPDATE users SET last_seen_at = ? WHERE id = ?').run(now, userId);
}

/**
 * Optional friendly name shown in Settings ("Chatting as Zain").
 * @param {string} userId
 * @param {string|null} displayName
 */
export function setDisplayName(userId, displayName) {
  const clean = typeof displayName === 'string' ? displayName.trim().slice(0, 60) : null;
  getDb()
    .prepare('UPDATE users SET display_name = ? WHERE id = ?')
    .run(clean ? clean : null, userId);
  return getUser(userId);
}

/**
 * Deletes the user and, through ON DELETE CASCADE, everything they own.
 * Used by Settings → "Delete my data".
 * @param {string} userId
 */
export function deleteUser(userId) {
  getDb().prepare('DELETE FROM users WHERE id = ?').run(userId);
}
