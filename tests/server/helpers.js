/**
 * Shared test helpers for the server suite.
 *
 * IMPORTANT: every test file sets the environment BEFORE importing any server
 * module, because `server/config.js` reads `process.env` once at import time.
 * That is why this helper exposes `useTestEnv()` plus dynamic loaders.
 */

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

/** Applies a fully isolated test environment. Returns the temporary directory. */
export function useTestEnv(overrides = {}) {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'yaar-test-'));

  const defaults = {
    NODE_ENV: 'test',
    PORT: '0',
    HOST: '127.0.0.1',
    DATABASE_PATH: path.join(tmpDir, 'test.sqlite'),
    SESSION_SECRET: 'test-secret-not-used-anywhere-real',
    AI_PROVIDER: 'openai-compatible',
    OPENAI_COMPATIBLE_BASE_URL: 'http://127.0.0.1:1/v1',
    OPENAI_COMPATIBLE_MODEL: 'test-model',
    AI_STREAMING: 'true',
    HF_TIMEOUT_MS: '3000',
    HF_IDLE_TIMEOUT_MS: '3000',
    DAILY_MESSAGE_LIMIT: '20',
    USAGE_WINDOW_HOURS: '24',
    REFUND_FAILED_MESSAGES: 'true',
    LOG_LEVEL: 'silent',
    CHAT_RATE_LIMIT_PER_MINUTE: '1000',
    SESSION_RATE_LIMIT_PER_MINUTE: '1000',
  };

  for (const [key, value] of Object.entries({ ...defaults, ...overrides })) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = String(value);
  }

  return tmpDir;
}

/** Loads the server modules (after `useTestEnv`). */
export async function loadServer() {
  const [{ createApp }, database, chatService, usageService, messagesRepo, conversationsRepo, configModule] =
    await Promise.all([
      import('../../server/app.js'),
      import('../../server/db/database.js'),
      import('../../server/services/chatService.js'),
      import('../../server/services/usageService.js'),
      import('../../server/db/repositories/messagesRepository.js'),
      import('../../server/db/repositories/conversationsRepository.js'),
      import('../../server/config.js'),
    ]);

  return {
    createApp,
    initDatabase: database.initDatabase,
    closeDatabase: database.closeDatabase,
    getDb: database.getDb,
    chatService,
    usageService,
    messagesRepo,
    conversationsRepo,
    config: configModule.config,
  };
}

/**
 * Boots the real Express app on an ephemeral port.
 * @param {{ env?: Record<string, string> }} [options]
 */
export async function startTestServer() {
  const { createApp, initDatabase } = await loadServer();
  initDatabase();
  const app = createApp({ clientDistPath: null });

  const server = await new Promise((resolve) => {
    const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
  });

  const { port } = server.address();
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    baseUrl,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}

/**
 * A tiny HTTP client that mimics the browser: it keeps the session cookie and
 * sends the anonymous device id header, so tests exercise the same identity
 * path the app uses.
 */
export function createClient(baseUrl, { deviceId = 'testdevice0001' } = {}) {
  /** @type {Map<string, string>} */
  const cookies = new Map();

  const cookieHeader = () =>
    cookies.size === 0
      ? undefined
      : Array.from(cookies, ([name, value]) => `${name}=${value}`).join('; ');

  async function request(path, { method = 'GET', body, device = deviceId, headers = {} } = {}) {
    const response = await fetch(`${baseUrl}/api${path}`, {
      method,
      headers: {
        accept: 'application/json',
        ...(device ? { 'x-yaar-device-id': device } : {}),
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(cookieHeader() ? { cookie: cookieHeader() } : {}),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    for (const raw of response.headers.getSetCookie?.() ?? []) {
      const [pair] = raw.split(';');
      const index = pair.indexOf('=');
      if (index > 0) cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim());
    }

    const text = await response.text();
    let json = null;
    try {
      json = text ? JSON.parse(text) : null;
    } catch {
      json = null;
    }

    return { status: response.status, body: json, headers: response.headers };
  }

  /** Reads an SSE response into an array of { event, data } frames. */
  async function stream(path, { body, device = deviceId } = {}) {
    const response = await fetch(`${baseUrl}/api${path}`, {
      method: 'POST',
      headers: {
        accept: 'text/event-stream',
        'content-type': 'application/json',
        ...(device ? { 'x-yaar-device-id': device } : {}),
        ...(cookieHeader() ? { cookie: cookieHeader() } : {}),
      },
      body: JSON.stringify(body ?? {}),
    });

    const frames = [];
    if (!response.ok) {
      const text = await response.text();
      let parsed = null;
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = null;
      }
      return { status: response.status, frames, body: parsed };
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let separator;
      while ((separator = buffer.search(/\r?\n\r?\n/)) !== -1) {
        const raw = buffer.slice(0, separator);
        buffer = buffer.slice(separator).replace(/^\r?\n\r?\n/, '');
        const event = parseFrame(raw);
        if (event) frames.push(event);
      }
    }

    return { status: response.status, frames };
  }

  return { request, stream, cookies };
}

function parseFrame(raw) {
  if (!raw.trim() || raw.startsWith(':')) return null;
  let event = 'message';
  const dataLines = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) dataLines.push(line.slice(5).trim());
  }
  if (dataLines.length === 0) return { event, data: null };
  try {
    return { event, data: JSON.parse(dataLines.join('\n')) };
  } catch {
    return { event, data: null };
  }
}

/** Collects the text of every `delta` frame. */
export function streamedText(frames) {
  return frames
    .filter((frame) => frame.event === 'delta')
    .map((frame) => frame.data?.text ?? '')
    .join('');
}
