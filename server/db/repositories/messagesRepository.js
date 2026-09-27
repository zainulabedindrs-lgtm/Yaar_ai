/**
 * messages table access.
 *
 * `seq` is a monotonic counter per conversation and is what the UI renders in
 * order. It is allocated inside the INSERT itself and protected by a unique
 * index; write paths also lock the conversation row first.
 */

import { randomUUID } from 'node:crypto';

import { query, queryOne } from '../database.js';

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

/**
 * Inserts a message. Runs inside whatever transaction the caller opened.
 * @param {{
 *   conversationId: string, userId: string, sender: 'user'|'assistant'|'system',
 *   content: string, status?: 'sent'|'streaming'|'failed', errorCode?: string|null,
 *   model?: string|null, provider?: string|null, createdAt?: number, id?: string,
 * }} input
 * @returns {Promise<MessageRow>}
 */
export async function insertMessage(input) {
  return queryOne(
    `INSERT INTO messages
       (id, conversation_id, user_id, sender, content, status, error_code, model, provider, created_at, seq)
     VALUES
       ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10,
        (SELECT COALESCE(MAX(seq), 0) + 1 FROM messages WHERE conversation_id = $2))
     RETURNING *`,
    [
      input.id ?? randomUUID(),
      input.conversationId,
      input.userId,
      input.sender,
      input.content,
      input.status ?? 'sent',
      input.errorCode ?? null,
      input.model ?? null,
      input.provider ?? null,
      input.createdAt ?? Date.now(),
    ],
  );
}

/** @param {string} id @returns {Promise<MessageRow | undefined>} */
export async function getMessage(id) {
  return queryOne('SELECT * FROM messages WHERE id = $1', [id]);
}

/**
 * Newest-first page of a conversation, returned oldest-first for rendering.
 * @param {string} conversationId
 * @param {{ limit?: number, beforeSeq?: number|null }} [options]
 * @returns {Promise<MessageRow[]>}
 */
export async function listMessages(conversationId, { limit = 200, beforeSeq = null } = {}) {
  const safeLimit = Math.min(Math.max(1, Math.trunc(limit)), 500);
  const rows = beforeSeq
    ? await query(
        `SELECT * FROM messages WHERE conversation_id = $1 AND seq < $2
         ORDER BY seq DESC LIMIT $3`,
        [conversationId, beforeSeq, safeLimit],
      )
    : await query(
        `SELECT * FROM messages WHERE conversation_id = $1
         ORDER BY seq DESC LIMIT $2`,
        [conversationId, safeLimit],
      );
  return rows.reverse();
}

/** @param {string} conversationId @returns {Promise<number>} */
export async function countMessages(conversationId) {
  const row = await queryOne('SELECT COUNT(*) AS c FROM messages WHERE conversation_id = $1', [
    conversationId,
  ]);
  return Number(row?.c ?? 0);
}

/** Removes every message of a conversation. Returns how many were deleted. */
export async function deleteMessagesForConversation(conversationId) {
  const rows = await query('DELETE FROM messages WHERE conversation_id = $1 RETURNING id', [
    conversationId,
  ]);
  return rows.length;
}

/** Used to keep a finished streaming reply (or to drop a failed one). */
export async function updateMessageContent(id, { content, status, errorCode, model, provider }) {
  await query(
    `UPDATE messages
        SET content = COALESCE($2, content),
            status = COALESCE($3, status),
            error_code = $4,
            model = COALESCE($5, model),
            provider = COALESCE($6, provider)
      WHERE id = $1`,
    [id, content ?? null, status ?? null, errorCode ?? null, model ?? null, provider ?? null],
  );
}

/** @param {string} id */
export async function deleteMessage(id) {
  await query('DELETE FROM messages WHERE id = $1', [id]);
}
