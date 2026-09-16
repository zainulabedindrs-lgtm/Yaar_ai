/**
 * Chat orchestration.
 *
 * One "turn" = one user message + one assistant reply. The rules that matter:
 *
 *  1. `beginTurn` runs in ONE database transaction: the usage counter is only
 *     incremented if the user message row is actually written. A crash or a
 *     rejected request can therefore never burn a message.
 *  2. The assistant reply is persisted as soon as it is complete (or partially
 *     complete if the stream is cut off), so history survives refreshes.
 *  3. If the AI fails before producing any text, the message is refunded
 *     (configurable with REFUND_FAILED_MESSAGES) — the user never pays for our
 *     outage.
 *  4. Asking for a reply again (`regenerate`, or a retried send with the same
 *     `clientMessageId`) never consumes a second message.
 */

import { randomUUID } from 'node:crypto';

import { COMPANIONS, isCompanionId } from '../../shared/companions.js';
import { ERROR_CODES } from '../../shared/errors.js';
import { config } from '../config.js';
import { transaction } from '../db/database.js';
import * as conversationsRepo from '../db/repositories/conversationsRepository.js';
import * as messagesRepo from '../db/repositories/messagesRepository.js';
import * as usersRepo from '../db/repositories/usersRepository.js';
import { ApiError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { getChatProvider } from './ai/providers.js';
import { buildChatPrompt } from './ai/promptBuilder.js';
import * as usageService from './usageService.js';

/** Identifies the seeded opening line in the database (used by tests/analytics). */
export const GREETING_MODEL = 'yaar-greeting';

/** Shapes a message row for the API. */
export function serializeMessage(row) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    sender: row.sender,
    content: row.content,
    status: row.status,
    errorCode: row.error_code ?? null,
    createdAt: row.created_at,
    seq: row.seq,
  };
}

/** Shapes a usage state for the API. */
export function serializeUsage(state) {
  return {
    limit: state.limit,
    used: state.used,
    remaining: state.remaining,
    windowHours: state.windowHours,
    windowStartedAt: state.windowStartedAt,
    resetAt: state.resetAt,
    msUntilReset: state.msUntilReset,
    exhausted: state.exhausted,
  };
}

export function serializeConversation(row) {
  return {
    id: row.id,
    companionId: row.companion_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    lastMessageAt: row.last_message_at ?? null,
  };
}

/**
 * Step 1 — validate the companion, reserve a message from the daily allowance
 * and store the user message. Everything is atomic.
 *
 * @param {Object} params
 * @param {string} params.userId
 * @param {string} params.companionId
 * @param {string} params.content          already sanitised / trimmed
 * @param {string} [params.clientMessageId] client-generated id for de-duplication
 * @returns {{
 *   conversation: import('../db/repositories/conversationsRepository.js').ConversationRow,
 *   userMessage: import('../db/repositories/messagesRepository.js').MessageRow,
 *   usage: ReturnType<typeof serializeUsage>,
 *   duplicate: boolean,
 * }}
 */
export function beginTurn({ userId, companionId, content, clientMessageId }) {
  if (!isCompanionId(companionId)) {
    throw ApiError.notFound(ERROR_CODES.UNKNOWN_COMPANION);
  }

  const now = Date.now();
  // Defensive: guarantees the foreign keys resolve even when this runs outside
  // the HTTP session middleware (tests, scripts). A no-op after the first call.
  usersRepo.ensureUser(userId, now);
  const conversation = conversationsRepo.getOrCreateConversation(userId, companionId, now);

  return transaction(() => {
    // Idempotency: a retried request with the same client id must never consume
    // a second message from the allowance.
    if (clientMessageId) {
      const existing = messagesRepo.getMessage(clientMessageId);
      if (existing && existing.user_id === userId && existing.conversation_id === conversation.id) {
        return {
          conversation,
          userMessage: existing,
          usage: serializeUsage(usageService.getUsageState(userId, now)),
          duplicate: true,
        };
      }
    }

    // The opening line only exists for a brand new conversation, and it is an
    // assistant message: it never consumes a credit.
    ensureGreeting(conversation, userId, companionId);

    const usage = usageService.consumeMessage(userId, now); // throws when exhausted

    const userMessage = messagesRepo.insertMessage({
      id: clientMessageId || randomUUID(),
      conversationId: conversation.id,
      userId,
      sender: 'user',
      content,
      status: 'sent',
      createdAt: now,
    });

    conversationsRepo.touchConversation(conversation.id, now);

    return {
      conversation,
      userMessage,
      usage: serializeUsage(usage),
      duplicate: false,
    };
  })();
}

/**
 * Seeds the companion's opening line the first time a conversation is used.
 *
 * Called from BOTH the history endpoint and `beginTurn`, so a deep link that
 * sends a message before loading history still gets the greeting as message #1
 * (correct order) instead of an orphan line at the end.
 *
 * Must run inside a transaction when called from a write path.
 *
 * @param {import('../db/repositories/conversationsRepository.js').ConversationRow} conversation
 * @param {string} userId
 * @param {string} companionId
 * @returns {import('../db/repositories/messagesRepository.js').MessageRow | null}
 */
export function ensureGreeting(conversation, userId, companionId) {
  if (messagesRepo.countMessages(conversation.id) > 0) return null;
  const greeting = COMPANIONS[companionId]?.greeting;
  if (!greeting) return null;

  return messagesRepo.insertMessage({
    conversationId: conversation.id,
    userId,
    sender: 'assistant',
    content: greeting,
    status: 'sent',
    model: GREETING_MODEL,
    provider: 'yaar',
  });
}

/** The newest message in a conversation (or null). */
export function getLatestMessage(conversationId) {
  const rows = messagesRepo.listMessages(conversationId, { limit: 1 });
  return rows[0] ?? null;
}

/**
 * True when the conversation ends with a user message, i.e. a reply is missing.
 * Used by the "ask again" flow.
 */
export function isAwaitingReply(conversationId) {
  const latest = getLatestMessage(conversationId);
  return Boolean(latest && latest.sender === 'user');
}

/** The assistant message that follows a given user message, if any. */
export function findReplyAfter(conversationId, seq) {
  return (
    messagesRepo
      .listMessages(conversationId, { limit: 500 })
      .find((row) => row.sender === 'assistant' && row.seq > seq) ?? null
  );
}

/** Builds the provider payload for the current state of a conversation. */
export function buildPromptForConversation({ companionId, conversationId }) {
  const history = messagesRepo
    .listMessages(conversationId, { limit: 40 })
    .filter((row) => row.sender === 'user' || row.sender === 'assistant')
    .map((row) => ({ sender: row.sender, content: row.content }));

  return buildChatPrompt({ companionId, history });
}

/**
 * Step 2 — ask the AI for a reply, streaming deltas through `onDelta`.
 *
 * The provider already retries with fallback models, so a thrown ApiError here
 * means "no reply could be produced".
 *
 * @param {Object} params
 * @param {string} params.companionId
 * @param {string} params.conversationId
 * @param {(text: string) => void} [params.onDelta]
 * @param {AbortSignal} [params.signal]
 */
export async function requestAiReply({ companionId, conversationId, onDelta, signal }) {
  const provider = getChatProvider();
  const messages = buildPromptForConversation({ companionId, conversationId });

  try {
    const result = await provider.chat({
      messages,
      onDelta,
      signal,
      stream: config.ai.streaming,
    });
    return { ...result, text: result.text.trim() };
  } catch (error) {
    if (error instanceof ApiError) throw error;
    logger.error('ai request crashed', { message: String(error?.message) });
    throw ApiError.upstream(ERROR_CODES.AI_UNAVAILABLE);
  }
}

/**
 * Step 3 — persist the assistant reply.
 * @param {Object} params
 * @param {string} params.userId
 * @param {import('../db/repositories/conversationsRepository.js').ConversationRow} params.conversation
 * @param {string} params.content
 * @param {string} [params.model]
 * @param {string} [params.provider]
 */
export function saveAssistantReply({ userId, conversation, content, model, provider }) {
  const now = Date.now();
  return transaction(() => {
    const row = messagesRepo.insertMessage({
      conversationId: conversation.id,
      userId,
      sender: 'assistant',
      content,
      status: 'sent',
      model: model ?? null,
      provider: provider ?? null,
      createdAt: now,
    });
    conversationsRepo.touchConversation(conversation.id, now);
    return row;
  })();
}

/**
 * Gives the reserved message back after an AI failure that produced no text.
 * @param {string} userId
 */
export function refundTurn(userId) {
  try {
    return serializeUsage(usageService.refundMessage(userId));
  } catch (error) {
    logger.error('failed to refund usage', { message: String(error?.message) });
    return null;
  }
}

/** Current usage for a user, API-shaped. */
export function getUsage(userId) {
  return serializeUsage(usageService.getUsageState(userId));
}

/**
 * Full turn for the JSON (non-streaming) endpoint.
 *
 * @param {Object} params
 * @param {string} params.userId
 * @param {string} params.companionId
 * @param {string} params.content
 * @param {string} [params.clientMessageId]
 */
export async function completeTurn({ userId, companionId, content, clientMessageId }) {
  const started = beginTurn({ userId, companionId, content, clientMessageId });

  const existingReply = findReplyAfter(started.conversation.id, started.userMessage.seq);
  if (started.duplicate && existingReply) {
    // The turn already completed (e.g. two browser tabs) — return it as-is.
    return {
      conversation: serializeConversation(started.conversation),
      userMessage: serializeMessage(started.userMessage),
      assistantMessage: serializeMessage(existingReply),
      usage: started.usage,
      duplicate: true,
    };
  }

  try {
    const reply = await requestAiReply({
      companionId,
      conversationId: started.conversation.id,
    });

    const assistantMessage = saveAssistantReply({
      userId,
      conversation: started.conversation,
      content: reply.text,
      model: reply.model,
      provider: reply.provider,
    });

    return {
      conversation: serializeConversation(started.conversation),
      userMessage: serializeMessage(started.userMessage),
      assistantMessage: serializeMessage(assistantMessage),
      usage: getUsage(userId),
      duplicate: started.duplicate,
    };
  } catch (error) {
    const apiError = error instanceof ApiError ? error : ApiError.upstream();
    // Only refund when this request actually consumed a credit.
    const usage = started.duplicate ? getUsage(userId) : refundTurn(userId);
    throw new ApiError(apiError.status, apiError.code, apiError.message, {
      ...(apiError.details || {}),
      ...(usage ? { usage } : {}),
    });
  }
}

/**
 * Metadata about the active AI provider — used by the health endpoint.
 */
export function aiStatus() {
  const provider = getChatProvider();
  return {
    provider: provider.id,
    label: provider.label,
    model: provider.defaultModel,
    fallbackModels: provider.models.slice(1),
    streaming: config.ai.streaming,
    configured: provider.isConfigured,
    // Never let a stand-in pass for a real model: the UI and /api/health can
    // both see that replies are not coming from a hosted model.
    local: config.ai.localProvider,
    demo: config.ai.demoProvider,
    host: config.ai.providerHost || null,
  };
}

/** Companion metadata for a conversation (used by the session endpoint). */
export function companionFor(companionId) {
  return COMPANIONS[companionId] ?? null;
}
