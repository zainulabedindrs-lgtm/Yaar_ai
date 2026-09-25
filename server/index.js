/**
 * Yaar server entry point.
 *
 *   npm start        → production: serves the built client from ./dist and the API
 *   npm run dev      → scripts/dev.mjs starts this API + the Vite dev server
 *
 * The process is deliberately boring: one Express app, one SQLite file, one
 * outbound HTTPS connection to the AI provider.
 */

import http from 'node:http';
import process from 'node:process';

import { createApp } from './app.js';
import { config, isAiConfigured } from './config.js';
import { closeDatabase, databaseStats } from './db/database.js';
import { logger } from './utils/logger.js';

const app = createApp();
const server = http.createServer(app);

// Streaming replies need generous timeouts; an idle keep-alive socket does not.
server.keepAliveTimeout = 65_000;
server.headersTimeout = 70_000;
server.requestTimeout = 0;

server.listen(config.server.port, config.server.host, () => {
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : config.server.port;
  logger.info('yaar server listening', {
    url: `http://${config.server.host}:${port}`,
    env: config.env,
    aiProvider: config.ai.provider,
    aiConfigured: isAiConfigured(),
    model: config.ai.huggingface.models[0],
    dailyMessageLimit: config.usage.dailyLimit,
  });
  if (!isAiConfigured()) {
    logger.warn('ai provider not configured', {
      hint: 'Set HUGGINGFACE_API_KEY in .env (see .env.example) and restart.',
    });
  } else {
    try {
      logger.info('database statistics', databaseStats());
    } catch {
      /* non-fatal */
    }
  }
});

server.on('error', (error) => {
  if (error?.code === 'EADDRINUSE') {
    logger.error('port already in use', { port: config.server.port });
  } else {
    logger.error('server error', { message: String(error?.message) });
  }
  process.exitCode = 1;
});

/** Graceful shutdown so SQLite always closes cleanly. */
function shutdown(signal) {
  logger.info('shutting down', { signal });
  server.close(() => {
    closeDatabase();
    process.exit(0);
  });
  // Don't hang forever on lingering keep-alive sockets.
  setTimeout(() => process.exit(0), 5_000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('unhandledRejection', (reason) => {
  logger.error('unhandled rejection', { message: String(reason) });
});
process.on('uncaughtException', (error) => {
  logger.error('uncaught exception', { message: String(error?.message) });
});
