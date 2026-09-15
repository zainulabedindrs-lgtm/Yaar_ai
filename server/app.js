/**
 * Express application factory.
 *
 * `createApp()` is used by `server/index.js` for real traffic and by the test
 * suite (with an in-memory database and a stub AI provider), so the tested
 * surface is exactly the deployed one.
 */

import fs from 'node:fs';
import path from 'node:path';

import cookieParser from 'cookie-parser';
import express from 'express';

import { ROOT_DIR, config, configWarnings, isAiConfigured } from './config.js';
import { initDatabase } from './db/database.js';
import { errorHandler, apiNotFoundHandler } from './middleware/errorHandler.js';
import { sessionMiddleware } from './middleware/session.js';
import { createApiRouter } from './routes/index.js';
import { appMetadata } from './appMetadata.js';
import { logger } from './utils/logger.js';

/**
 * @param {{ clientDistPath?: string|null }} [options]
 * @returns {import('express').Express}
 */
export function createApp({ clientDistPath = config.server.clientDistPath } = {}) {
  initDatabase();

  for (const warning of configWarnings()) logger.warn('config warning', { message: warning });

  const app = express();

  app.disable('x-powered-by');
  app.set('trust proxy', config.server.trustProxy);

  // --- security headers -----------------------------------------------------
  app.use((req, res, next) => {
    res.set('x-content-type-options', 'nosniff');
    res.set('referrer-policy', 'strict-origin-when-cross-origin');
    // FRAME_ANCESTORS defaults to * so the app also works inside a preview
    // pane or a mobile WebView shell. Set it to 'self' on a public deployment.
    res.set(
      'content-security-policy',
      [
        "default-src 'self'",
        "img-src 'self' data: blob:",
        "style-src 'self' 'unsafe-inline'",
        "script-src 'self'",
        "connect-src 'self'",
        "font-src 'self' data:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
        `frame-ancestors ${config.server.frameAncestors}`,
      ].join('; '),
    );
    if (config.server.frameAncestors !== '*') {
      res.set(
        'x-frame-options',
        config.server.frameAncestors.includes('self') ? 'SAMEORIGIN' : 'DENY',
      );
    }
    next();
  });

  app.use(express.json({ limit: '64kb' }));
  app.use(cookieParser(config.session.secret));

  // --- api ------------------------------------------------------------------
  const api = express.Router();
  api.use(sessionMiddleware);
  api.use(createApiRouter());
  api.use(apiNotFoundHandler);
  app.use('/api', api);

  // --- static client --------------------------------------------------------
  if (clientDistPath && fs.existsSync(clientDistPath)) {
    serveClient(app, clientDistPath);
  } else {
    app.get('/', (_req, res) => {
      res.status(200).type('html').send(devLandingPage());
    });
  }

  app.use(errorHandler);

  return app;
}

/** Serves the built SPA with long-lived asset caching + SPA fallback. */
function serveClient(app, clientDistPath) {
  app.use(
    express.static(clientDistPath, {
      index: false,
      setHeaders(res, filePath) {
        if (/\.(?:js|css|woff2?|png|jpg|jpeg|svg|webp|avif|ico)$/.test(filePath)) {
          res.set('cache-control', 'public, max-age=31536000, immutable');
        }
      },
    }),
  );

  app.use((req, res, next) => {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    if (req.path.startsWith('/api')) return next();
    if (path.extname(req.path)) return next();
    res.sendFile(path.join(clientDistPath, 'index.html'));
  });
}

/** Shown when the client has not been built yet (`npm run dev` uses Vite). */
function devLandingPage() {
  const meta = appMetadata();
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Yaar — API only</title>
<style>
  body { font-family: system-ui, -apple-system, "Segoe UI", sans-serif; background:#fff7fb; color:#2b1b2f; display:grid; place-items:center; min-height:100vh; margin:0; }
  .card { background:#fff; border-radius:24px; padding:32px 28px; max-width:520px; box-shadow:0 18px 40px rgba(120,40,90,.12); }
  h1 { margin:0 0 4px; font-size:28px; letter-spacing:-.5px; }
  p { line-height:1.6; color:#5b4a60; }
  code { background:#f6eef4; padding:2px 6px; border-radius:6px; font-size:13px; }
  .pill { display:inline-block; padding:6px 12px; border-radius:999px; font-size:12px; font-weight:600; }
  .on { background:#e6f7ed; color:#137a43; } .off { background:#fdeaea; color:#a32020; }
</style></head>
<body><div class="card">
  <h1>Yaar API is running</h1>
  <p>v${meta.version} — the web client is not built yet.</p>
  <p><span class="pill ${isAiConfigured() ? 'on' : 'off'}">${isAiConfigured() ? 'AI connected' : 'AI not configured'}</span></p>
  <p>Run <code>npm run dev</code> for the full app (API + Vite dev server), or
  <code>npm run build &amp;&amp; npm start</code> for the production build.</p>
  <p>Health check: <code>/api/health</code></p>
</div></body></html>`;
}

export { ROOT_DIR };
