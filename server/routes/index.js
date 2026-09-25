/**
 * API router.
 *
 * Mounted at `/api` by `server/app.js`. Rate limits are applied per router so
 * cheap read endpoints are never starved by chat traffic.
 */

import express from 'express';

import { config } from '../config.js';
import { createRateLimiter, userKeyGenerator } from '../middleware/rateLimit.js';
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

  registerMetaRoutes(router);
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
