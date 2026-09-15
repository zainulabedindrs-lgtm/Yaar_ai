/**
 * Chat endpoints.
 *
 *   POST /api/chat/:companionId/messages    → send a message, get the AI reply
 *   POST /api/chat/:companionId/regenerate  → ask again for a missing reply
 *
 * Two response modes on both routes:
 *   • Server-Sent Events (default) — the reply streams token by token.
 *   • Plain JSON (`"stream": false`, or AI_STREAMING=false) — resolves with the
 *     complete reply.
 *
 * Guarantees:
 *   • the user message is persisted and counted BEFORE the AI is contacted;
 *   • the reply is persisted before it is returned;
 *   • a failure that produced no text refunds the message;
 *   • `regenerate` and a retried `clientMessageId` never consume a new credit.
 */

import { isCompanionId } from '../../shared/companions.js';
import { ERROR_CODES } from '../../shared/errors.js';
import { config } from '../config.js';
import * as conversationsRepo from '../db/repositories/conversationsRepository.js';
import { openSseStream } from '../http/sse.js';
import * as chatService from '../services/chatService.js';
import * as usageService from '../services/usageService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { ApiError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';
import { validateMessage } from '../utils/validate.js';
import { parseOrThrow, sendMessageSchema } from '../validation/schemas.js';

/** @param {unknown} raw @returns {string} */
function requireValidContent(raw) {
  const result = validateMessage(raw);
  if (result.ok) return result.value;
  if (result.code === 'empty') throw ApiError.badRequest(ERROR_CODES.EMPTY_MESSAGE);
  throw ApiError.badRequest(ERROR_CODES.MESSAGE_TOO_LONG);
}

/** @param {unknown} value @returns {string} */
function requireCompanionId(value) {
  if (!isCompanionId(value)) throw ApiError.notFound(ERROR_CODES.UNKNOWN_COMPANION);
  return value;
}

/** @param {import('express').Router} router */
export function registerChatRoutes(router) {
  router.post(
    '/:companionId/messages',
    asyncHandler(async (req, res) => {
      const companionId = requireCompanionId(req.params.companionId);
      const body = parseOrThrow(sendMessageSchema, req.body);
      const content = requireValidContent(body.content);
      const wantsStream = (body.stream ?? true) && config.ai.streaming;

      // Non-streaming path: `completeTurn` owns the whole turn (it begins the
      // turn itself, so the usage counter is only touched ONCE per message).
      if (!wantsStream) {
        const response = await chatService.completeTurn({
          userId: req.userId,
          companionId,
          content,
          clientMessageId: body.clientMessageId,
        });
        res.json(response);
        return;
      }

      // Step 1 — reserve the message (atomic: usage counter + insert).
      const turn = chatService.beginTurn({
        userId: req.userId,
        companionId,
        content,
        clientMessageId: body.clientMessageId,
      });

      const existingReply = turn.duplicate
        ? chatService.findReplyAfter(turn.conversation.id, turn.userMessage.seq)
        : null;

      if (existingReply) {
        // The same request already completed (double tap, two tabs, a retry
        // after a network drop). Return the stored turn instead of generating
        // — and charging — again.
        res.json({
          conversation: chatService.serializeConversation(turn.conversation),
          userMessage: chatService.serializeMessage(turn.userMessage),
          assistantMessage: chatService.serializeMessage(existingReply),
          usage: turn.usage,
          duplicate: true,
        });
        return;
      }

      await streamReply({
        res,
        companionId,
        userId: req.userId,
        conversation: turn.conversation,
        userMessage: turn.userMessage,
        usage: turn.usage,
        refundable: !turn.duplicate,
      });
    }),
  );

  /**
   * Asks for a reply again when the conversation ends with a user message that
   * never got an answer (AI outage, timeout, the user pressed stop).
   * Never consumes a message from the daily allowance.
   */
  router.post(
    '/:companionId/regenerate',
    asyncHandler(async (req, res) => {
      const companionId = requireCompanionId(req.params.companionId);
      const wantsStream = (req.body?.stream ?? true) && config.ai.streaming;

      const conversation = conversationsRepo.getOrCreateConversation(req.userId, companionId);
      if (!chatService.isAwaitingReply(conversation.id)) {
        throw ApiError.badRequest(
          ERROR_CODES.VALIDATION,
          'There is nothing to reply to right now.',
        );
      }

      const userMessage = chatService.getLatestMessage(conversation.id);
      const usage = chatService.getUsage(req.userId);

      if (!wantsStream) {
        try {
          const reply = await chatService.requestAiReply({
            companionId,
            conversationId: conversation.id,
          });
          const assistantMessage = chatService.saveAssistantReply({
            userId: req.userId,
            conversation,
            content: reply.text,
            model: reply.model,
            provider: reply.provider,
          });
          res.json({
            conversation: chatService.serializeConversation(conversation),
            userMessage: chatService.serializeMessage(userMessage),
            assistantMessage: chatService.serializeMessage(assistantMessage),
            usage: chatService.getUsage(req.userId),
          });
        } catch (error) {
          const apiError = error instanceof ApiError ? error : ApiError.upstream();
          throw new ApiError(apiError.status, apiError.code, apiError.message, {
            ...(apiError.details || {}),
            usage: chatService.getUsage(req.userId),
          });
        }
        return;
      }

      await streamReply({
        res,
        companionId,
        userId: req.userId,
        conversation,
        userMessage,
        usage,
        refundable: false,
        sendUserMessage: false,
      });
    }),
  );

  /**
   * Development-only: resets the caller's usage window so the limit can be
   * re-tested without waiting 24 hours. Returns 404 in production.
   */
  router.post(
    '/dev/reset-usage',
    asyncHandler(async (req, res) => {
      if (config.isProduction) throw ApiError.notFound();
      const usage = usageService.resetUsage(req.userId);
      res.json({ usage: chatService.serializeUsage(usage) });
    }),
  );
}

/**
 * Streams one AI reply over SSE.
 *
 * @param {{
 *   req: import('express').Request,
 *   res: import('express').Response,
 *   companionId: string,
 *   userId: string,
 *   conversation: import('../db/repositories/conversationsRepository.js').ConversationRow,
 *   userMessage: import('../db/repositories/messagesRepository.js').MessageRow,
 *   usage: any,
 *   refundable: boolean,
 *   sendUserMessage?: boolean,
 * }} params
 */
async function streamReply({
  res,
  companionId,
  userId,
  conversation,
  userMessage,
  usage,
  refundable,
  sendUserMessage = true,
}) {
  const stream = openSseStream(res);
  const controller = new AbortController();
  let clientGone = false;

  // IMPORTANT: listen on the RESPONSE, not the request. `req` emits 'close' as
  // soon as the request body has been read, which would abort every reply the
  // moment it starts. `res` emits 'close' before 'finish' only when the client
  // really went away (tab closed, network dropped, fetch aborted).
  const onResponseClose = () => {
    if (res.writableEnded) return; // normal completion
    clientGone = true;
    controller.abort();
  };
  res.on('close', onResponseClose);

  stream.send('meta', {
    conversation: chatService.serializeConversation(conversation),
    ...(sendUserMessage ? { userMessage: chatService.serializeMessage(userMessage) } : {}),
    usage,
  });

  let text = '';
  const startedAt = Date.now();

  try {
    const reply = await chatService.requestAiReply({
      companionId,
      conversationId: conversation.id,
      signal: controller.signal,
      onDelta: (delta) => {
        text += delta;
        stream.send('delta', { text: delta });
      },
    });

    const content = (reply.text || text).trim();
    if (!content) throw ApiError.upstream(ERROR_CODES.AI_EMPTY);

    const assistantMessage = chatService.saveAssistantReply({
      userId,
      conversation,
      content,
      model: reply.model,
      provider: reply.provider,
    });

    stream.send('done', {
      assistantMessage: chatService.serializeMessage(assistantMessage),
      usage: chatService.getUsage(userId),
      ms: Date.now() - startedAt,
    });
  } catch (error) {
    const apiError =
      error instanceof ApiError ? error : ApiError.upstream(ERROR_CODES.AI_UNAVAILABLE);
    const cancelled = apiError.code === ERROR_CODES.CANCELLED || clientGone;
    const partial = text.trim();

    if (partial) {
      // The user already saw part of the reply — keep it so the history matches
      // the screen instead of deleting something they read.
      const salvaged = chatService.saveAssistantReply({
        userId,
        conversation,
        content: partial,
      });
      stream.send('done', {
        assistantMessage: chatService.serializeMessage(salvaged),
        usage: chatService.getUsage(userId),
        truncated: true,
        ms: Date.now() - startedAt,
      });
    } else {
      const refunded = refundable ? chatService.refundTurn(userId) : null;
      const nextUsage = refunded ?? chatService.getUsage(userId);

      if (cancelled && clientGone) {
        logger.info('chat stream cancelled', { companionId });
      } else if (cancelled) {
        stream.send('error', {
          error: { code: ERROR_CODES.CANCELLED, message: undefined, details: { usage: nextUsage } },
        });
      } else {
        stream.send('error', {
          error: {
            code: apiError.code,
            message: apiError.message,
            details: { usage: nextUsage },
          },
        });
      }
    }
  } finally {
    res.off('close', onResponseClose);
    stream.close();
  }
}
