/**
 * Environment-secret handling on the server.
 *
 * Contract:
 *   - the Hugging Face credential is read from `HUGGINGFACE_API_KEY` (with
 *     `HF_API_KEY` accepted as a legacy alias);
 *   - it is sent to the provider as a Bearer token and nowhere else;
 *   - it never appears in an API response, a log line or an error message;
 *   - a missing key produces a clear, actionable boot warning instead of a crash.
 *
 * Tokens in this file are assembled from fragments so no scanner (or secret
 * filter) mistakes them for a real credential.
 */

import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { after, before, describe, it } from 'node:test';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

import { useTestEnv, startTestServer, createClient } from './helpers.js';

const FAKE_TOKEN = ['hf', 'A'.repeat(24)].join('_'); // fake, never a real key
const LEGACY_TOKEN = ['hf', 'B'.repeat(24)].join('_');

// LOG_LEVEL must be set before the server modules are imported.
useTestEnv({
  AI_PROVIDER: 'huggingface',
  HUGGINGFACE_API_KEY: FAKE_TOKEN,
  HF_BASE_URL: 'http://127.0.0.1:1/v1',
  LOG_LEVEL: 'warn',
  NODE_ENV: 'test',
});

let config;
let app;
let server;
let client;
let logger;
let maskSecrets;

before(async () => {
  const helpers = await import('./helpers.js');
  const [configModule, appModule, loggerModule] = await Promise.all([
    import('../../server/config.js'),
    import('../../server/app.js'),
    import('../../server/utils/logger.js'),
  ]);

  config = configModule.config;
  logger = loggerModule.logger;
  maskSecrets = loggerModule.maskSecrets;

  app = appModule.createApp({ clientDistPath: null });
  server = await helpers.startTestServer(app);
  client = helpers.createClient(server.baseUrl, { deviceId: 'secret-test-device-0001' });
});

after(async () => {
  await server?.close();
});

describe('HUGGINGFACE_API_KEY is read from the server environment', () => {
  it('reads the documented variable name', () => {
    assert.equal(config.ai.huggingface.apiKey, FAKE_TOKEN);
  });

  it('never exposes the key through an API response', async () => {
    const bodies = [];
    for (const path of ['/health', '/session', '/companions', '/usage']) {
      const response = await client.request(path);
      bodies.push(JSON.stringify(response.body));
    }
    const combined = bodies.join('\n');
    assert.ok(!combined.includes(FAKE_TOKEN), 'the key must not be sent to the client');
    assert.ok(!/hf_[A-Za-z0-9]{20,}/.test(combined), 'no token-shaped value may reach the client');
  });

  it('reports only whether the provider is configured', async () => {
    const response = await client.request('/health');
    assert.equal(response.body.ai.configured, true);
    assert.equal(typeof response.body.ai.provider, 'string');
    assert.equal(response.body.ai.apiKey, undefined);
    assert.ok(!('key' in response.body.ai));
  });

  it('accepts HF_API_KEY as a legacy alias when the new name is absent', async () => {
    // A fresh module instance reads the current process.env.
    const previous = process.env.HUGGINGFACE_API_KEY;
    // Present but empty: `.env` is loaded by dotenv at import time and would
    // otherwise fill the primary name straight back in.
    process.env.HUGGINGFACE_API_KEY = '';
    process.env.HF_API_KEY = LEGACY_TOKEN;

    const fresh = await import('../../server/config.js?legacy=1');
    assert.equal(fresh.config.ai.huggingface.apiKey, LEGACY_TOKEN);

    process.env.HUGGINGFACE_API_KEY = previous;
    delete process.env.HF_API_KEY;
  });

  it('warns with the variable name when no key is configured', async () => {
    const previous = process.env.HUGGINGFACE_API_KEY;
    process.env.HUGGINGFACE_API_KEY = '';
    delete process.env.HF_API_KEY;

    const fresh = await import('../../server/config.js?missing=1');
    const warnings = fresh.configWarnings();
    assert.ok(
      warnings.some((warning) => warning.includes('HUGGINGFACE_API_KEY')),
      `expected a warning naming HUGGINGFACE_API_KEY, got: ${JSON.stringify(warnings)}`,
    );

    process.env.HUGGINGFACE_API_KEY = previous;
  });
});

describe('the key cannot leak through logs or errors', () => {
  it('masks credential-shaped substrings inside any logged string', () => {
    assert.equal(
      maskSecrets(`upstream said: invalid key ${FAKE_TOKEN}`),
      'upstream said: invalid key [redacted]',
    );
    assert.equal(
      maskSecrets('Authorization: Bearer abcdefghijklmnopqrstuvwxyz'),
      'Authorization: Bearer [redacted]',
    );
  });

  it('redacts secret-named fields entirely', () => {
    const lines = [];
    const originalWarn = console.warn;
    console.warn = (line) => lines.push(line);
    try {
      logger.warn('demo event', {
        apiKey: FAKE_TOKEN,
        authorization: `Bearer ${FAKE_TOKEN}`,
        nested: { token: FAKE_TOKEN, note: `key was ${FAKE_TOKEN}` },
      });
    } finally {
      console.warn = originalWarn;
    }

    const output = lines.join('\n');
    assert.ok(output.includes('demo event'), 'the event should still be logged');
    assert.ok(!output.includes(FAKE_TOKEN), 'the raw key must never be logged');
    assert.ok(output.includes('[redacted]'));
  });

  it('keeps the key out of thrown API errors', async () => {
    // Point the provider at a port nothing listens on; the failure must be
    // reported without echoing the credential.
    const response = await client.request('/chat/girlfriend/messages', {
      method: 'POST',
      body: {
        content: 'hello',
        clientMessageId: 'b7d3f5a1-0c62-4e75-9a1f-2c8d3e4f5a6b',
        stream: false,
      },
    });
    const text = JSON.stringify(response.body);
    assert.ok(!text.includes(FAKE_TOKEN));
    assert.equal(response.body.error.code, 'ai_unavailable');
    assert.ok(!/hf_[A-Za-z0-9]{20,}/.test(text));
  });
});

describe('project hygiene', () => {
  it('documents the variable in .env.example with an empty value', () => {
    const example = fs.readFileSync(path.join(REPO_ROOT, '.env.example'), 'utf8');
    const match = /^[ \t]*HUGGINGFACE_API_KEY[ \t]*=[ \t]*(.*)$/m.exec(example);
    assert.ok(match, '.env.example must document HUGGINGFACE_API_KEY');
    assert.equal(match[1].trim(), '', 'the committed example must not contain a real key');
  });

  it('keeps .env in .gitignore', () => {
    const ignore = fs.readFileSync(path.join(REPO_ROOT, '.gitignore'), 'utf8');
    assert.ok(/^\.env$/m.test(ignore), '.env must be ignored');
    assert.ok(/^!\.env\.example$/m.test(ignore), '.env.example must stay committable');
  });
});
