/**
 * End-to-end HTTP tests for the whole chat pipeline:
 *
 *   browser → Express route → usage limit → SQLite → AI provider (mock) → SSE
 *
 * The mock provider speaks the same OpenAI-compatible contract as the Hugging
 * Face router, so these tests cover the real production code path with no
 * internet access and no API key.
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { startMockAiServer } from '../../scripts/mockAiServer.mjs';
import { createClient, loadServer, startTestServer, streamedText, useTestEnv } from './helpers.js';

useTestEnv({
  DAILY_MESSAGE_LIMIT: '20',
  AI_STREAMING: 'true',
});

let mockAi;
let server;
let client;

before(async () => {
  mockAi = await startMockAiServer();
  // The provider reads the base URL from the environment at import time, which
  // happened in useTestEnv(); point it at the mock's actual port instead.
  process.env.OPENAI_COMPATIBLE_BASE_URL = mockAi.url;
  const { config } = await loadServer();
  config.ai.openaiCompatible.baseUrl = mockAi.url;

  server = await startTestServer();
  client = createClient(server.baseUrl);
});

after(async () => {
  await server?.close();
  await mockAi?.close();
});

describe('boot payload', () => {
  test('GET /api/session returns everything the app needs in one call', async () => {
    const { status, body } = await client.request('/session');
    assert.equal(status, 200);
    assert.ok(body.user.ref, 'a session reference is exposed');
    assert.equal(body.usage.limit, 20);
    assert.equal(body.usage.used, 0);
    assert.equal(body.companions.length, 2);
    assert.deepEqual(
      body.companions.map((companion) => companion.id),
      ['girlfriend', 'boyfriend'],
    );
    assert.ok(body.ai.provider, 'AI status is reported');
    assert.equal(body.app.dailyMessageLimit, 20);
  });

  test('companion payloads never leak the system prompt', async () => {
    const { body } = await client.request('/companions');
    for (const companion of body.companions) {
      assert.equal(companion.persona, undefined, 'persona must stay server-side');
      assert.ok(companion.displayName);
      assert.ok(companion.avatar.startsWith('/avatars/'));
    }
  });

  test('health endpoint reports the database and the AI provider', async () => {
    const { status, body } = await client.request('/health');
    assert.equal(status, 200);
    assert.equal(body.ok, true);
    assert.ok(body.database.messages >= 0);
    assert.equal(body.ai.provider, 'openai-compatible');
  });
});

describe('sending messages', () => {
  test('a brand new conversation is seeded with the companion greeting', async () => {
    const { status, body } = await client.request('/conversations/girlfriend/messages');
    assert.equal(status, 200);
    assert.equal(body.messages.length, 1);
    assert.equal(body.messages[0].sender, 'assistant');
    assert.match(body.messages[0].content, /tum|Hii|tell me/i);
    assert.equal(body.usage.used, 0, 'greetings never count against the limit');
  });

  test('streaming send returns meta → deltas → done and persists both messages', async () => {
    const { status, frames } = await client.stream('/chat/girlfriend/messages', {
      body: { content: 'Hey, I had a long day', clientMessageId: 'flow-message-0001' },
    });

    assert.equal(status, 200);
    const meta = frames.find((frame) => frame.event === 'meta');
    const done = frames.find((frame) => frame.event === 'done');
    assert.ok(meta, 'meta frame arrives first');
    assert.equal(meta.data.usage.used, 1);
    assert.equal(meta.data.userMessage.content, 'Hey, I had a long day');
    assert.ok(done, 'done frame closes the stream');
    assert.equal(done.data.usage.used, 1, 'the reply itself does not consume a message');
    assert.match(done.data.assistantMessage.content, /day|here|💛/i);

    const text = streamedText(frames);
    assert.ok(text.length > 0, 'the reply was streamed');
    assert.ok(!text.includes('think'), 'reasoning blocks are stripped before the UI');

    // Persisted for the next visit.
    const { body } = await client.request('/conversations/girlfriend/messages');
    assert.equal(body.messages.length, 3);
    assert.equal(body.messages.at(-1).content, done.data.assistantMessage.content);
  });

  test('non-streaming mode returns a complete JSON reply', async () => {
    const before = (await client.request('/usage')).body.usage.used;

    const { status, body } = await client.request('/chat/boyfriend/messages', {
      method: 'POST',
      body: { content: 'Hi yaar, kya haal hai?', clientMessageId: 'flow-message-0002', stream: false },
    });

    assert.equal(status, 200);
    assert.equal(body.assistantMessage.sender, 'assistant');
    assert.match(body.assistantMessage.content, /Achha|sunao/i, 'Roman Urdu reply for Roman Urdu input');
    assert.equal(
      body.usage.used,
      before + 1,
      'one message = exactly one credit, even though the reply is stored too',
    );
  });

  test('Urdu, Hindi and mixed input are answered in the same language', async () => {
    const cases = [
      { text: 'آج میرا دن بہت لمبا تھا', expect: /یہ تو بہت اچھی بات/ },
      { text: 'आज मेरा दिन लंबा था', expect: /अरे वाह/ },
      { text: 'aaj buhat lamba din tha yaar', expect: /Achha achha/ },
    ];

    for (const [index, testCase] of cases.entries()) {
      const { body } = await client.request('/chat/girlfriend/messages', {
        method: 'POST',
        body: {
          content: testCase.text,
          clientMessageId: `flow-code-switch-${index}`,
          stream: false,
        },
      });
      assert.match(body.assistantMessage.content, testCase.expect);
    }
  });

  test('a single send consumes exactly one credit (regression: double counting)', async () => {
    const fresh = createClient(server.baseUrl, { deviceId: 'countingdevice001' });
    const before = (await fresh.request('/usage')).body.usage.used;

    const streamed = await fresh.stream('/chat/girlfriend/messages', {
      body: { content: 'count me once', clientMessageId: 'flow-count-0001' },
    });
    const done = streamed.frames.find((frame) => frame.event === 'done');
    assert.equal(done.data.usage.used, before + 1, 'streaming send costs one credit');

    const json = await fresh.request('/chat/girlfriend/messages', {
      method: 'POST',
      body: { content: 'and me once', clientMessageId: 'flow-count-0002', stream: false },
    });
    assert.equal(json.body.usage.used, before + 2, 'JSON send costs one credit');

    const after = (await fresh.request('/usage')).body.usage.used;
    assert.equal(after, before + 2);
  });

  test('empty and whitespace-only messages are rejected without consuming a message', async () => {
    const before = (await client.request('/usage')).body.usage.used;

    for (const content of ['', '   ', '\n\n']) {
      const { status, body } = await client.request('/chat/girlfriend/messages', {
        method: 'POST',
        body: { content },
      });
      assert.equal(status, 400);
      assert.equal(body.error.code, 'empty_message');
    }

    const after = (await client.request('/usage')).body.usage.used;
    assert.equal(after, before);
  });

  test('an unknown companion is a clean 404', async () => {
    const { status, body } = await client.request('/chat/crush/messages', {
      method: 'POST',
      body: { content: 'hello' },
    });
    assert.equal(status, 404);
    assert.equal(body.error.code, 'unknown_companion');
  });

  test('a retried send with the same clientMessageId does not double count', async () => {
    const before = (await client.request('/usage')).body.usage.used;

    const first = await client.request('/chat/girlfriend/messages', {
      method: 'POST',
      body: { content: 'did that send?', clientMessageId: 'flow-retry-0001', stream: false },
    });
    const second = await client.request('/chat/girlfriend/messages', {
      method: 'POST',
      body: { content: 'did that send?', clientMessageId: 'flow-retry-0001', stream: false },
    });

    assert.equal(first.body.usage.used, before + 1);
    assert.equal(second.body.duplicate, true);
    assert.equal(second.body.usage.used, before + 1, 'the retry is free');
    assert.equal(second.body.assistantMessage.id, first.body.assistantMessage.id);
  });
});

describe('ask again (regenerate)', () => {
  test('produces a reply for a user message that never got one, for free', async () => {
    // Create a conversation that ends with a user message by using a failing AI.
    process.env.OPENAI_COMPATIBLE_BASE_URL = mockAi.url;
    const { config } = await loadServer();

    const originalBase = config.ai.openaiCompatible.baseUrl;
    config.ai.openaiCompatible.baseUrl = `${mockAi.url}?fail=fail`;

    const failed = await client.request('/chat/boyfriend/messages', {
      method: 'POST',
      body: { content: 'are you there?', clientMessageId: 'flow-regenerate-0001', stream: false },
    });
    assert.equal(failed.status, 502);

    const usageAfterFailure = (await client.request('/usage')).body.usage.used;

    // The AI is healthy again.
    config.ai.openaiCompatible.baseUrl = originalBase;

    const { status, frames } = await client.stream('/chat/boyfriend/regenerate', { body: {} });
    assert.equal(status, 200);
    const done = frames.find((frame) => frame.event === 'done');
    assert.ok(done?.data?.assistantMessage?.content, 'a reply was produced');

    const usageAfterRetry = (await client.request('/usage')).body.usage.used;
    assert.equal(usageAfterRetry, usageAfterFailure, 'regenerating never consumes a message');
  });

  test('rejects regenerate when there is nothing to answer', async () => {
    // The girlfriend conversation currently ends with an assistant message.
    const { status } = await client.stream('/chat/girlfriend/regenerate', { body: {} });
    assert.equal(status, 400);
  });
});

describe('AI failures are friendly and refunded', () => {
  test('provider outage → 502 ai_unavailable, credit refunded, no stack trace', async () => {
    const { config } = await loadServer();
    const original = config.ai.openaiCompatible.baseUrl;
    config.ai.openaiCompatible.baseUrl = `${mockAi.url}?fail=fail`;

    const before = (await client.request('/usage')).body.usage.used;

    const { body } = await client.request('/chat/boyfriend/messages', {
      method: 'POST',
      body: { content: 'anyone home?', clientMessageId: 'flow-fail-0001', stream: false },
    });

    assert.equal(body.error.code, 'ai_unavailable');
    assert.doesNotMatch(body.error.message, /stack|at Object|\/home\//i);
    assert.equal(body.error.details.usage.used, before, 'the failed message was refunded');

    config.ai.openaiCompatible.baseUrl = original;
  });

  test('provider rate limit → 429 rate_limited with the same friendly copy', async () => {
    const { config } = await loadServer();
    const original = config.ai.openaiCompatible.baseUrl;
    config.ai.openaiCompatible.baseUrl = `${mockAi.url}?fail=ratelimit`;

    const { body } = await client.request('/chat/boyfriend/messages', {
      method: 'POST',
      body: { content: 'too fast?', clientMessageId: 'flow-429-0001', stream: false },
    });
    assert.equal(body.error.code, 'rate_limited');
    assert.match(body.error.message, /busy|slow|again/i);

    config.ai.openaiCompatible.baseUrl = original;
  });

  test('bad credentials → ai_not_configured with a setup hint', async () => {
    const { config } = await loadServer();
    const original = config.ai.openaiCompatible.baseUrl;
    config.ai.openaiCompatible.baseUrl = `${mockAi.url}?fail=auth`;

    const { body } = await client.request('/chat/boyfriend/messages', {
      method: 'POST',
      body: { content: 'hello?', clientMessageId: 'flow-auth-0001', stream: false },
    });
    assert.equal(body.error.code, 'ai_not_configured');

    config.ai.openaiCompatible.baseUrl = original;
  });

  test('a stream that fails before any token emits an error frame and refunds', async () => {
    const { config } = await loadServer();
    const original = config.ai.openaiCompatible.baseUrl;
    config.ai.openaiCompatible.baseUrl = `${mockAi.url}?fail=fail`;

    const before = (await client.request('/usage')).body.usage.used;

    const { frames } = await client.stream('/chat/boyfriend/messages', {
      body: { content: 'stream please', clientMessageId: 'flow-streamfail-0001' },
    });

    const errorFrame = frames.find((frame) => frame.event === 'error');
    assert.ok(errorFrame, 'an error frame is emitted');
    assert.equal(errorFrame.data.error.code, 'ai_unavailable');
    assert.equal(errorFrame.data.error.details.usage.used, before);
    assert.equal(frames.some((frame) => frame.event === 'done'), false);

    config.ai.openaiCompatible.baseUrl = original;
  });
});

describe('history, privacy and limits over HTTP', () => {
  test('history is paginated and never leaks another session', async () => {
    const other = createClient(server.baseUrl, { deviceId: 'otherdevice0099' });
    await other.request('/conversations/girlfriend/messages');

    const mine = await client.request('/conversations/girlfriend/messages?limit=2');
    assert.equal(mine.body.messages.length, 2);
    assert.equal(mine.body.hasMore, true);

    const theirs = await other.request('/conversations/girlfriend/messages');
    assert.equal(theirs.body.messages.length, 1, 'only their own greeting');
    assert.notEqual(
      theirs.body.conversation.id,
      mine.body.conversation.id,
      'conversations are per user',
    );
  });

  test('clearing a conversation keeps the conversation but empties it', async () => {
    const { status, body } = await client.request('/conversations/boyfriend/messages', {
      method: 'DELETE',
    });
    assert.equal(status, 200);
    assert.ok(body.cleared > 0);
    assert.equal(body.messages.length, 1, 'the greeting is re-seeded');
    assert.equal(body.messages[0].sender, 'assistant');

    const usage = (await client.request('/usage')).body.usage;
    assert.ok(usage.used > 0, 'clearing messages does not reset the daily counter');
  });

  test('message 21 over HTTP is rejected with usage details', async () => {
    const fresh = createClient(server.baseUrl, { deviceId: 'limitdevice0001' });

    for (let index = 1; index <= 20; index += 1) {
      const { body } = await fresh.request('/chat/girlfriend/messages', {
        method: 'POST',
        body: { content: `message ${index}`, stream: false },
      });
      assert.ok(body.assistantMessage, `message ${index} should get a reply`);
    }

    const { status, body } = await fresh.request('/chat/girlfriend/messages', {
      method: 'POST',
      body: { content: 'message 21', stream: false },
    });

    assert.equal(status, 429);
    assert.equal(body.error.code, 'daily_limit_reached');
    assert.match(body.error.message, /20|24 hours/);
    assert.equal(body.error.details.usage.used, 20);
    assert.equal(body.error.details.usage.remaining, 0);
    assert.ok(body.error.details.usage.resetAt > Date.now());

    // The conversation is still readable after the limit is hit.
    const history = await fresh.request('/conversations/girlfriend/messages');
    assert.equal(history.status, 200);
    assert.ok(history.body.messages.length >= 41, 'nothing was deleted');
  });

  test('the same device keeps its counter across a "page refresh"', async () => {
    const first = createClient(server.baseUrl, { deviceId: 'refreshdevice001' });
    await first.request('/chat/girlfriend/messages', {
      method: 'POST',
      body: { content: 'before refresh', stream: false },
    });

    // A brand new client with the same device id = same user, even without a cookie.
    const second = createClient(server.baseUrl, { deviceId: 'refreshdevice001' });
    const { body } = await second.request('/usage');
    assert.equal(body.usage.used, 1);
  });

  test('deleting the session removes the messages', async () => {
    const doomed = createClient(server.baseUrl, { deviceId: 'deleteddevice001' });
    await doomed.request('/chat/girlfriend/messages', {
      method: 'POST',
      body: { content: 'delete me later', stream: false },
    });

    const { status } = await doomed.request('/session', { method: 'DELETE' });
    assert.equal(status, 200);

    const { body } = await doomed.request('/conversations/girlfriend/messages');
    assert.equal(body.messages.length, 1, 'a fresh session with only the greeting');
    assert.equal(body.usage.used, 0);
  });

  test('unknown API routes return JSON, not HTML', async () => {
    const { status, body } = await client.request('/nope');
    assert.equal(status, 404);
    assert.equal(body.error.code, 'not_found');
  });
});
