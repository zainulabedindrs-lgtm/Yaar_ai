/**
 * conversations table access.
 *
 * A user has exactly one conversation per companion (a unique index enforces
 * it). That keeps "continue where you stopped" trivial.
 */

import { randomUUID } from 'node:crypto';

import { query, queryOne } from '../database.js';

/**
 * @typedef {Object} ConversationRow
 * @property {string} id
 * @property {string} user_id
 * @property {string} companion_id
 * @property {string|null} title
 * @property {number} created_at
 * @property {number} updated_at
 * @property {number|null} last_message_at
 * @property {number} is_archived
 */

/**
 * Race-safe get-or-create (two tabs opening the same chat at once both get the
 * same row thanks to the unique index + ON CONFLICT).
 * @param {string} userId
 * @param {string} companionId
 * @param {number} [now]
 * @returns {Promise<ConversationRow>}
 */
export async function getOrCreateConversation(userId, companionId, now = Date.now()) {
  await query(
    `INSERT INTO conversations (id, user_id, companion_id, title, created_at, updated_at, last_message_at, is_archived)
     VALUES ($1, $2, $3, NULL, $4, $4, NULL, 0)
     ON CONFLICT (user_id, companion_id) DO NOTHING`,
    [randomUUID(), userId, companionId, now],
  );

  const existing = /** @type {ConversationRow} */ (
    await findByUserAndCompanion(userId, companionId)
  );
  if (existing.is_archived) {
    return queryOne(
      'UPDATE conversations SET is_archived = 0, updated_at = $1 WHERE id = $2 RETURNING *',
      [now, existing.id],
    );
  }
  return existing;
}

/** @param {string} conversationId @returns {Promise<ConversationRow | undefined>} */
export async function getConversation(conversationId) {
  return queryOne('SELECT * FROM conversations WHERE id = $1', [conversationId]);
}

/**
 * Ownership check — guarantees a user can never read or write another user's
 * conversation.
 * @param {string} conversationId
 * @param {string} userId
 */
export async function getOwnedConversation(conversationId, userId) {
  return queryOne('SELECT * FROM conversations WHERE id = $1 AND user_id = $2', [
    conversationId,
    userId,
  ]);
}

/**
 * Takes a row lock on the conversation for the rest of the transaction, which
 * serialises concurrent writers (message `seq` allocation).
 * @param {string} conversationId
 */
export async function lockConversation(conversationId) {
  await query('SELECT id FROM conversations WHERE id = $1 FOR UPDATE', [conversationId]);
}

/** @param {string} conversationId @param {number} at */
export async function touchConversation(conversationId, at = Date.now()) {
  await query('UPDATE conversations SET updated_at = $1, last_message_at = $1 WHERE id = $2', [
    at,
    conversationId,
  ]);
}

/** @param {string} userId @returns {Promise<ConversationRow[]>} */
export async function listByUser(userId) {
  return query('SELECT * FROM conversations WHERE user_id = $1 ORDER BY updated_at DESC', [userId]);
}

/** @param {string} userId @param {string} companionId */
export async function findByUserAndCompanion(userId, companionId) {
  return queryOne('SELECT * FROM conversations WHERE user_id = $1 AND companion_id = $2', [
    userId,
    companionId,
  ]);
}
