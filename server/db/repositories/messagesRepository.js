/**
 * messages table access.
 *
 * `seq` is a monotonic counter per conversation and is what the UI renders in
 * order — it is immune to same-millisecond timestamp collisions and lets the
 * client paginate with `before=seq`.
 */

import { randomUUID } from 'node:crypto';

import { getDb } from '../database.js';

/**
 * @typedef {Object} MessageRow
 * @property {string} id
 * @property {string} conversation_id
 * @property {string} user_id
 * @property {'user'|'assistant'|'system'} sender
 * @property {string} content
 * @property {'sent'|'streaming'|'failed'} status
 * @property {string|null} error_code
 * @property {string|null} model
 * @property {string|null} provider
 * @property {number} created_at
 * @property {number} seq
 */

function nextSeq(conversationId) {
  const row = getDb()
    .prepare('SELECT COALESCE(MAX(seq), 0) AS max_seq FROM messages WHERE conversation_id = ?')
    .get(conversationId);
  return (row?.max_seq ?? 0) + 1;
}

/**
 * Inserts a message. Runs inside whatever transaction the caller opened.
 * @param {{
 *   conversationId: string,
 *   userId: string,
 *   sender: 'user'|'assistant'|'system',
 *   content: string,
 *   status?: 'sent'|'streaming'|'failed',
 *   errorCode?: string|null,
 *   model?: string|null,
 *   provider?: string|null,
 *   createdAt?: number,
 *   id?: string,
 * }} input
 * @returns {MessageRow}
 */
export function insertMessage(input) {
  const db = getDb();
  const now = input.createdAt ?? Date.now();
  const row = {
    id: input.id ?? randomUUID(),
    conversation_id: input.conversationId,
    user_id: input.userId,
    sender: input.sender,
    content: input.content,
    status: input.status ?? 'sent',
    error_code: input.errorCode ?? null,
    model: input.model ?? null,
    provider: input.provider ?? null,
    created_at: now,
    seq: nextSeq(input.conversationId),
  };

  db.prepare(
    `INSERT INTO messages
       (id, conversation_id, user_id, sender, content, status, error_code, model, provider, created_at, seq)
     VALUES
       (@id, @conversation_id, @user_id, @sender, @content, @status, @error_code, @model, @provider, @created_at, @seq)`,
  ).run(row);

  return /** @type {MessageRow} */ (row);
}

/** @param {string} id @returns {MessageRow | undefined} */
export function getMessage(id) {
  return /** @type {MessageRow | undefined} */ (
    getDb().prepare('SELECT * FROM messages WHERE id = ?').get(id)
  );
}

/**
 * Newest-first page of a conversation, returned oldest-first for rendering.
 * @param {string} conversationId
 * @param {{ limit?: number, beforeSeq?: number|null }} [options]
 * @returns {MessageRow[]}
 */
export function listMessages(conversationId, { limit = 200, beforeSeq = null } = {}) {
  const db = getDb();
  const safeLimit = Math.min(Math.max(1, Math.trunc(limit)), 500);

  const rows = beforeSeq
    ? db
        .prepare(
          `SELECT * FROM messages
           WHERE conversation_id = ? AND seq < ?
           ORDER BY seq DESC LIMIT ?`,
        )
        .all(conversationId, beforeSeq, safeLimit)
    : db
        .prepare(
          `SELECT * FROM messages
           WHERE conversation_id = ?
           ORDER BY seq DESC LIMIT ?`,
        )
        .all(conversationId, safeLimit);

  return /** @type {MessageRow[]} */ (rows).reverse();
}

/** @param {string} conversationId */
export function countMessages(conversationId) {
  return getDb()
    .prepare('SELECT COUNT(*) AS c FROM messages WHERE conversation_id = ?')
    .get(conversationId).c;
}

/**
 * Removes every message of a conversation (Settings → Clear conversation).
 * The conversation row itself is kept so the user stays "in" the chat.
 */
export function deleteMessagesForConversation(conversationId) {
  const info = getDb().prepare('DELETE FROM messages WHERE conversation_id = ?').run(conversationId);
  return info.changes;
}

/** Used to keep a finished streaming reply (or to drop a failed one). */
export function updateMessageContent(id, { content, status, errorCode, model, provider }) {
  getDb()
    .prepare(
      `UPDATE messages
         SET content = COALESCE(@content, content),
             status = COALESCE(@status, status),
             error_code = @errorCode,
             model = COALESCE(@model, model),
             provider = COALESCE(@provider, provider)
       WHERE id = @id`,
    )
    .run({
      id,
      content: content ?? null,
      status: status ?? null,
      errorCode: errorCode ?? null,
      model: model ?? null,
      provider: provider ?? null,
    });
}

/** @param {string} id */
export function deleteMessage(id) {
  getDb().prepare('DELETE FROM messages WHERE id = ?').run(id);
}
