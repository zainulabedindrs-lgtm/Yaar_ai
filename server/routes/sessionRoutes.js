/**
 * Session / profile endpoints.
 *
 *   GET    /api/session   → everything the app needs on boot in ONE request
 *                           (identity, usage, companions, conversations, AI status)
 *   PATCH  /api/session   → optional display name
 *   DELETE /api/session   → delete all data for this anonymous user
 *
 * Bundling the boot payload keeps startup to a single round trip, which matters
 * on mobile.
 */

import { getCompanionPublicList } from '../../shared/companions.js';
import * as conversationsRepo from '../db/repositories/conversationsRepository.js';
import * as messagesRepo from '../db/repositories/messagesRepository.js';
import * as usersRepo from '../db/repositories/usersRepository.js';
import * as chatService from '../services/chatService.js';
import { appMetadata } from '../appMetadata.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { publicSessionRef } from '../utils/ids.js';
import { sanitiseDisplayName } from '../utils/validate.js';
import { parseOrThrow, profileSchema } from '../validation/schemas.js';

/** @param {import('express').Router} router */
export function registerSessionRoutes(router) {
  router.get(
    '/session',
    asyncHandler(async (req, res) => {
      res.json(buildSessionPayload(req.userId));
    }),
  );

  router.patch(
    '/session',
    asyncHandler(async (req, res) => {
      const body = parseOrThrow(profileSchema, req.body);
      if ('displayName' in body) {
        usersRepo.setDisplayName(req.userId, sanitiseDisplayName(body.displayName));
      }
      res.json(buildSessionPayload(req.userId));
    }),
  );

  router.delete(
    '/session',
    asyncHandler(async (req, res) => {
      usersRepo.deleteUser(req.userId);
      res.clearCookie('yaar_sid', { path: '/' });
      res.json({ deleted: true });
    }),
  );
}

/** Shared boot payload (also reused by the conversations routes). */
export function buildSessionPayload(userId) {
  const user = usersRepo.getUser(userId);
  const conversations = conversationsRepo.listByUser(userId).map((conversation) => ({
    ...chatService.serializeConversation(conversation),
    messageCount: messagesRepo.countMessages(conversation.id),
  }));

  return {
    user: {
      ref: publicSessionRef(userId),
      displayName: user?.display_name ?? null,
      createdAt: user?.created_at ?? null,
      isAnonymous: (user?.auth_provider ?? 'anonymous') === 'anonymous',
    },
    usage: chatService.getUsage(userId),
    companions: getCompanionPublicList(),
    conversations,
    ai: chatService.aiStatus(),
    app: appMetadata(),
  };
}
