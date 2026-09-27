/**
 * Health + meta endpoints.
 *
 *   GET /api/health          → liveness, AI status, database counts
 *   GET /api/companions      → public companion metadata (no prompts!)
 *   GET /api/auth/config     → public Supabase Auth settings (no secrets)
 */

import { getCompanionPublicList } from '../../shared/companions.js';
import { appMetadata } from '../appMetadata.js';
import { databaseStats } from '../db/database.js';
import { publicAuthConfig } from '../services/authService.js';
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
        database = await databaseStats();
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
          /** true when the endpoint is machine-local (not a hosted model) */
          local: ai.local,
          /** true when the bundled canned-reply stand-in is answering */
          demo: ai.demo,
          host: ai.host,
        },
        database,
        auth: { enabled: publicAuthConfig().enabled, required: publicAuthConfig().required },
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

  // Public, non-secret settings the client needs to start Supabase Auth.
  router.get(
    '/auth/config',
    asyncHandler(async (_req, res) => {
      res.json({ auth: publicAuthConfig() });
    }),
  );
}
