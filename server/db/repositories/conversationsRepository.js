/**
 * conversations table access.
 *
 * A user has exactly one conversation per companion (a unique index enforces
 * it). That keeps "continue where you stopped" trivial and prevents accidental
 * history loss when the client reloads.
 */

import { randomUUID } from 'node:crypto';

import { getDb } from '../database.js';

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
 * @param {string} userId
 * @param {string} companionId
 * @param {number} now
 * @returns {ConversationRow}
 */
export function getOrCreateConversation(userId, companionId, now = Date.now()) {
  const db = getDb();
  const existing = /** @type {ConversationRow | undefined} */ (
    db
      .prepare('SELECT * FROM conversations WHERE user_id = ? AND companion_id = ?')
      .get(userId, companionId)
  );
  if (existing) {
    if (existing.is_archived) {
      db.prepare('UPDATE conversations SET is_archived = 0, updated_at = ? WHERE id = ?').run(
        now,
        existing.id,
      );
      return /** @type {ConversationRow} */ (getConversation(existing.id));
    }
    return existing;
  }

  const id = randomUUID();
  db.prepare(
    `INSERT INTO conversations (id, user_id, companion_id, title, created_at, updated_at, last_message_at, is_archived)
     VALUES (@id, @userId, @companionId, NULL, @now, @now, NULL, 0)`,
  ).run({ id, userId, companionId, now });

  return /** @type {ConversationRow} */ (getConversation(id));
}

/** @param {string} conversationId @returns {ConversationRow | undefined} */
export function getConversation(conversationId) {
  return /** @type {ConversationRow | undefined} */ (
    getDb().prepare('SELECT * FROM conversations WHERE id = ?').get(conversationId)
  );
}

/**
 * Ownership check — the single place that guarantees a user can never read or
 * write another user's conversation.
 * @param {string} conversationId
 * @param {string} userId
 * @returns {ConversationRow | undefined}
 */
export function getOwnedConversation(conversationId, userId) {
  return /** @type {ConversationRow | undefined} */ (
    getDb()
      .prepare('SELECT * FROM conversations WHERE id = ? AND user_id = ?')
      .get(conversationId, userId)
  );
}

/** @param {string} conversationId @param {number} at */
export function touchConversation(conversationId, at = Date.now()) {
  getDb()
    .prepare('UPDATE conversations SET updated_at = ?, last_message_at = ? WHERE id = ?')
    .run(at, at, conversationId);
}

/**
 * All conversations belonging to a user (used for the session bootstrap and
 * Settings screen).
 * @param {string} userId
 */
export function listByUser(userId) {
  return /** @type {ConversationRow[]} */ (
    getDb()
      .prepare('SELECT * FROM conversations WHERE user_id = ? ORDER BY updated_at DESC')
      .all(userId)
  );
}

/** @param {string} userId @param {string} companionId */
export function findByUserAndCompanion(userId, companionId) {
  return /** @type {ConversationRow | undefined} */ (
    getDb()
      .prepare('SELECT * FROM conversations WHERE user_id = ? AND companion_id = ?')
      .get(userId, companionId)
  );
}
