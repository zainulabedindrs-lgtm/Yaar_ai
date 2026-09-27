/**
 * API router.
 *
 * Mounted at `/api` by `server/app.js`. Rate limits are applied per router so
 * cheap read endpoints are never starved by chat traffic.
 */

import express from 'express';

import { config } from '../config.js';
import { createRateLimiter, userKeyGenerator } from '../middleware/rateLimit.js';
import { requireUser } from '../middleware/session.js';
import * as chatService from '../services/chatService.js';
import { asyncHandler } from '../utils/asyncHandler.js';
import { registerChatRoutes } from './chatRoutes.js';
import { registerConversationRoutes } from './conversationRoutes.js';
import { registerMetaRoutes } from './metaRoutes.js';
import { registerSessionRoutes } from './sessionRoutes.js';

export function createApiRouter() {
  const router = express.Router();

  // Coarse per-identity guard for every API call.
  router.use(
    createRateLimiter({
      limit: config.rateLimit.sessionPerMinute,
      windowMs: 60_000,
      keyGenerator: userKeyGenerator,
    }),
  );

  // Public: health, companions, auth config.
  registerMetaRoutes(router);

  // Everything below belongs to a user. With AUTH_REQUIRED=true (or
  // ALLOW_ANONYMOUS=false) that means a verified Supabase login.
  router.use(requireUser);

  router.get(
    '/usage',
    asyncHandler(async (req, res) => {
      res.json({ usage: await chatService.getUsage(req.userId) });
    }),
  );

  registerSessionRoutes(router);
  registerConversationRoutes(router);

  // Chat is the expensive one: separate, tighter bucket.
  const chatRouter = express.Router({
    mergeParams: true,
  });
  chatRouter.use(
    createRateLimiter({
      limit: config.rateLimit.chatPerMinute,
      windowMs: 60_000,
      keyGenerator: userKeyGenerator,
    }),
  );
  registerChatRoutes(chatRouter);
  router.use('/chat', chatRouter);

  return router;
}
