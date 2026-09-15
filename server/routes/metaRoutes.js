/**
 * Health + meta endpoints.
 *
 *   GET /api/health          → liveness, AI status, database counts
 *   GET /api/companions      → public companion metadata (no prompts!)
 *   GET /api/usage           → current usage window for this user
 */

import { getCompanionPublicList } from '../../shared/companions.js';
import { appMetadata } from '../appMetadata.js';
import { databaseStats } from '../db/database.js';
import * as chatService from '../services/chatService.js';
import { asyncHandler } from '../utils/asyncHandler.js';

/** @param {import('express').Router} router */
export function registerMetaRoutes(router) {
  router.get(
    '/health',
    asyncHandler(async (_req, res) => {
      const ai = chatService.aiStatus();
      let database = null;
      let healthy = true;
      try {
        database = databaseStats();
      } catch {
        healthy = false;
      }

      res.status(healthy ? 200 : 503).json({
        ok: healthy,
        uptimeSeconds: Math.round(process.uptime()),
        ai: {
          provider: ai.provider,
          model: ai.model,
          configured: ai.configured,
          streaming: ai.streaming,
        },
        database,
        app: appMetadata(),
      });
    }),
  );

  router.get(
    '/companions',
    asyncHandler(async (_req, res) => {
      res.json({ companions: getCompanionPublicList() });
    }),
  );

  router.get(
    '/usage',
    asyncHandler(async (req, res) => {
      res.json({ usage: chatService.getUsage(req.userId) });
    }),
  );
}
