/**
 * Session / profile endpoints.
 *
 *   GET    /api/session   → everything the app needs on boot in ONE request
 *                           (identity, usage, companions, conversations, AI status)
 *   PATCH  /api/session   → optional display name
 *   DELETE /api/session   → delete all data for this user (and, for a
 *                           Supabase account, the auth account itself)
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
import { config } from '../config.js';
import { deleteAuthUser } from '../services/authService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { publicSessionRef } from '../utils/ids.js';
import { sanitiseDisplayName } from '../utils/validate.js';
import { parseOrThrow, profileSchema } from '../validation/schemas.js';

/** @param {import('express').Router} router */
export function registerSessionRoutes(router) {
  router.get(
    '/session',
    asyncHandler(async (req, res) => {
      res.json(await buildSessionPayload(req.userId));
    }),
  );

  router.patch(
    '/session',
    asyncHandler(async (req, res) => {
      const body = parseOrThrow(profileSchema, req.body);
      if ('displayName' in body) {
        await usersRepo.setDisplayName(req.userId, sanitiseDisplayName(body.displayName));
      }
      res.json(await buildSessionPayload(req.userId));
    }),
  );

  router.delete(
    '/session',
    asyncHandler(async (req, res) => {
      await usersRepo.deleteUser(req.userId);
      // Signed-in account: also remove the Supabase Auth user (needs
      // SUPABASE_SECRET_KEY). The subject comes from the VERIFIED token only.
      const accountDeleted =
        req.auth?.provider === 'supabase' && req.auth.subject
          ? await deleteAuthUser(req.auth.subject)
          : false;
      res.clearCookie(config.session.cookieName, { path: '/' });
      res.json({ deleted: true, accountDeleted });
    }),
  );
}

/** Shared boot payload (also reused by the conversations routes). */
export async function buildSessionPayload(userId) {
  const user = await usersRepo.getUser(userId);
  const conversations = await Promise.all(
    (await conversationsRepo.listByUser(userId)).map(async (conversation) => ({
      ...chatService.serializeConversation(conversation),
      messageCount: await messagesRepo.countMessages(conversation.id),
    })),
  );

  return {
    user: {
      ref: publicSessionRef(userId),
      displayName: user?.display_name ?? null,
      createdAt: user?.created_at ?? null,
      isAnonymous: (user?.auth_provider ?? 'anonymous') === 'anonymous',
      email: user?.email ?? null,
    },
    usage: await chatService.getUsage(userId),
    companions: getCompanionPublicList(),
    conversations,
    ai: chatService.aiStatus(),
    app: appMetadata(),
  };
}
