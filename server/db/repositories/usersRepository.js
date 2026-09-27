/**
 * users table access.
 *
 * A user is either an anonymous device session (`auth_provider = 'anonymous'`)
 * or a Supabase account (`auth_provider = 'supabase'`). Everything else in the
 * app keys off `user_id`, so both kinds behave identically downstream.
 */

import { query, queryOne } from '../database.js';

/** @typedef {{ id: string, display_name: string|null, auth_provider: string, auth_subject: string|null, email: string|null, created_at: number, last_seen_at: number }} UserRow */

/**
 * Creates the user on first contact, otherwise only refreshes `last_seen_at`.
 * @param {string} userId
 * @param {number} [now] epoch ms
 * @param {{ provider?: string, subject?: string|null, email?: string|null }} [identity]
 * @returns {Promise<UserRow>}
 */
export async function ensureUser(userId, now = Date.now(), identity = {}) {
  const provider = identity.provider ?? 'anonymous';
  return queryOne(
    `INSERT INTO users (id, display_name, auth_provider, auth_subject, email, created_at, last_seen_at)
     VALUES ($1, NULL, $2, $3, $4, $5, $5)
     ON CONFLICT (id) DO UPDATE
       SET last_seen_at = EXCLUDED.last_seen_at,
           email = COALESCE(EXCLUDED.email, users.email)
     RETURNING *`,
    [userId, provider, identity.subject ?? null, identity.email ?? null, now],
  );
}

/** @param {string} userId @returns {Promise<UserRow | undefined>} */
export async function getUser(userId) {
  return queryOne('SELECT * FROM users WHERE id = $1', [userId]);
}

/** @param {string} userId */
export async function touchUser(userId, now = Date.now()) {
  await query('UPDATE users SET last_seen_at = $1 WHERE id = $2', [now, userId]);
}

/**
 * Optional friendly name shown in Settings ("Chatting as Zain").
 * @param {string} userId
 * @param {string|null} displayName
 */
export async function setDisplayName(userId, displayName) {
  const clean = typeof displayName === 'string' ? displayName.trim().slice(0, 60) : null;
  await query('UPDATE users SET display_name = $1 WHERE id = $2', [clean || null, userId]);
  return getUser(userId);
}

/**
 * Deletes the user and, through ON DELETE CASCADE, everything they own.
 * @param {string} userId
 */
export async function deleteUser(userId) {
  await query('DELETE FROM users WHERE id = $1', [userId]);
}
