/**
 * BazaarLink provider: an OpenAI-compatible endpoint selected with
 * AI_PROVIDER=bazaarlink. A local recording server stands in for
 * https://api.bazaarlink.ai/v1 so the exact outgoing request can be checked.
 */

import assert from 'node:assert/strict';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';

import { createClient, loadServer, startTestServer, useTestEnv } from './helpers.js';

const FAKE_KEY = 'bl-test-key-not-real-0123456789';

/** @type {Array<{ path: string, headers: http.IncomingHttpHeaders, body: any }>} */
const requests = [];
const upstream = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => (raw += chunk));
  req.on('end', () => {
    const body = raw ? JSON.parse(raw) : {};
    requests.push({ path: req.url ?? '', headers: req.headers, body });
    if (req.headers.authorization !== `Bearer ${FAKE_KEY}`) {
      res.writeHead(401, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'bad key' } }));
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'salam from bazaarlink' } }] }));
  });
});
await new Promise((resolve) => upstream.listen(0, '127.0.0.1', resolve));
const upstreamUrl = `http://127.0.0.1:${upstream.address().port}/v1`;

useTestEnv({
  AI_PROVIDER: 'bazaarlink',
  BAZAARLINK_API_KEY: FAKE_KEY,
  BAZAARLINK_BASE_URL: upstreamUrl,
  BAZAARLINK_MODEL: undefined, // exercise the default model
  AI_STREAMING: 'false',
});

let server;
let client;

before(async () => {
  server = await startTestServer();
  client = createClient(server.baseUrl, { deviceId: 'bazaarlinkdevice01' });
});

after(async () => {
  await server?.close();
  await new Promise((resolve) => upstream.close(resolve));
  const { closeDatabase } = await import('../../server/db/database.js');
  await closeDatabase();
});

describe('BazaarLink provider', () => {
  test('is selected by AI_PROVIDER=bazaarlink with the documented defaults', async () => {
    const { createChatProvider } = await import('../../server/services/ai/providers.js');
    const { BAZAARLINK_DEFAULT_BASE_URL } = await import('../../server/config.js');
    const provider = createChatProvider();
    assert.equal(provider.id, 'bazaarlink');
    assert.equal(provider.defaultModel, 'deepseek-v4-flash');
    assert.equal(provider.isConfigured, true);
    assert.equal(BAZAARLINK_DEFAULT_BASE_URL, 'https://api.bazaarlink.ai/v1');
  });

  test('health reports bazaarlink as configured', async () => {
    const { status, body } = await client.request('/health');
    assert.equal(status, 200);
    assert.equal(body.ai.provider, 'bazaarlink');
    assert.equal(body.ai.model, 'deepseek-v4-flash');
    assert.equal(body.ai.configured, true);
    assert.equal(body.ai.local, false);
  });

  test('sends an OpenAI chat/completions request with a Bearer key', async () => {
    const { status, body } = await client.request('/chat/girlfriend/messages', {
      method: 'POST',
      body: { content: 'kya haal hai?', stream: false },
    });
    assert.equal(status, 200, JSON.stringify(body));
    assert.equal(body.assistantMessage.content, 'salam from bazaarlink');

    const sent = requests.at(-1);
    assert.equal(sent.path, '/v1/chat/completions');
    assert.equal(sent.headers.authorization, `Bearer ${FAKE_KEY}`);
    assert.equal(sent.body.model, 'deepseek-v4-flash');
    assert.equal(sent.body.messages.at(-1).content, 'kya haal hai?');
    assert.equal(sent.body.messages[0].role, 'system');
  });

  test('without a key the provider reports not configured (no request sent)', async () => {
    const { config } = await loadServer();
    const { getChatProvider } = await import('../../server/services/ai/providers.js');
    const saved = config.ai.bazaarlink.apiKey;
    config.ai.bazaarlink.apiKey = '';
    try {
      const before = requests.length;
      const provider = getChatProvider();
      assert.equal(provider.isConfigured, false);
      await assert.rejects(() => provider.chat({ messages: [{ role: 'user', content: 'x' }] }), {
        code: 'ai_not_configured',
      });
      assert.equal(requests.length, before);
    } finally {
      config.ai.bazaarlink.apiKey = saved;
    }
  });
});
