/**
 * Conversation + history endpoints.
 *
 *   GET    /api/conversations/:companionId/messages   → history (paginated)
 *   DELETE /api/conversations/:companionId/messages   → clear a conversation
 *
 * Opening a chat for the first time seeds the companion's greeting message, so
 * a brand new user immediately sees something warm instead of an empty box.
 * That greeting is an assistant message and therefore never affects usage.
 */

import { isCompanionId } from '../../shared/companions.js';
import { ERROR_CODES } from '../../shared/errors.js';
import * as conversationsRepo from '../db/repositories/conversationsRepository.js';
import * as messagesRepo from '../db/repositories/messagesRepository.js';
import * as chatService from '../services/chatService.js';
import { ApiError } from '../utils/errors.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { messagesQuerySchema, parseOrThrow } from '../validation/schemas.js';

/** @param {import('express').Router} router */
export function registerConversationRoutes(router) {
  router.get(
    '/conversations/:companionId/messages',
    asyncHandler(async (req, res) => {
      const companionId = requireCompanionId(req.params.companionId);
      const query = parseOrThrow(messagesQuerySchema, req.query);

      const conversation = conversationsRepo.getOrCreateConversation(req.userId, companionId);
      chatService.ensureGreeting(conversation, req.userId, companionId);

      const rows = messagesRepo.listMessages(conversation.id, {
        limit: query.limit ?? 200,
        beforeSeq: query.before ?? null,
      });

      const oldest = rows[0]?.seq ?? null;
      const total = messagesRepo.countMessages(conversation.id);

      res.json({
        conversation: {
          ...chatService.serializeConversation(conversation),
          messageCount: total,
        },
        messages: rows.map(chatService.serializeMessage),
        hasMore: oldest !== null && oldest > 1,
        usage: chatService.getUsage(req.userId),
      });
    }),
  );

  router.delete(
    '/conversations/:companionId/messages',
    asyncHandler(async (req, res) => {
      const companionId = requireCompanionId(req.params.companionId);
      const conversation = conversationsRepo.getOrCreateConversation(req.userId, companionId);

      const removed = messagesRepo.deleteMessagesForConversation(conversation.id);
      // Re-seed the opening line so the cleared chat is not a blank screen.
      chatService.ensureGreeting(conversation, req.userId, companionId);

      const rows = messagesRepo.listMessages(conversation.id, { limit: 50 });

      res.json({
        cleared: removed,
        conversation: {
          ...chatService.serializeConversation(conversation),
          messageCount: rows.length,
        },
        messages: rows.map(chatService.serializeMessage),
      });
    }),
  );
}

/** @param {string} value */
function requireCompanionId(value) {
  if (!isCompanionId(value)) throw ApiError.notFound(ERROR_CODES.UNKNOWN_COMPANION);
  return value;
}
