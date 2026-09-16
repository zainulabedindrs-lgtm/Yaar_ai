/**
 * What the app actually sends to the AI provider.
 *
 * This suite exists because of a real bug report: the chat "repeated the same
 * reply" no matter what the user typed. That turned out to be the bundled
 * canned-reply stand-in answering instead of a model — but it is exactly the
 * kind of bug that hides in the seams, so these tests pin the contract of the
 * outgoing request:
 *
 *   1. the user's message reaches the provider verbatim;
 *   2. the conversation history reaches the provider on the next turn;
 *   3. every message produces a DIFFERENT upstream payload;
 *   4. the app never substitutes canned text of its own when the provider fails.
 *
 * A recording HTTP server stands in for the provider and captures the exact
 * request bodies, so no internet and no API key are required.
 */

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import http from 'node:http';
import { after, before, describe, test } from 'node:test';

import { createClient, loadServer, startTestServer, useTestEnv } from './helpers.js';

/**
 * A stand-in provider that records every request body it receives.
 * It answers like a model would (`reply-1`, `reply-2`, …) so the app's history
 * handling can be observed, and it can be told to fail on demand.
 */
async function startRecordingProvider() {
  /** @type {Array<{path: string, body: any}>} */
  const requests = [];
  /** When true every attempt fails, exercising the full fallback chain. */
  let failing = false;

  const server = http.createServer((req, res) => {
    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });
    req.on('end', () => {
      let body = {};
      try {
        body = raw ? JSON.parse(raw) : {};
      } catch {
        body = { malformed: raw };
      }
      requests.push({ path: req.url ?? '', body });

      if (failing) {
        res.writeHead(503, { 'content-type': 'application/json' });
        res.end(JSON.stringify({ error: { message: 'stand-in provider offline' } }));
        return;
      }

      const reply = `reply-${requests.length}`;
      if (body.stream) {
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\n`);
        res.write('data: [DONE]\n\n');
        res.end();
        return;
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          choices: [{ message: { role: 'assistant', content: reply } }],
          usage: { prompt_tokens: 12, completion_tokens: 4, total_tokens: 16 },
        }),
      );
    });
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));

  return {
    url: `http://127.0.0.1:${server.address().port}/v1`,
    requests,
    startFailing: () => {
      failing = true;
    },
    stopFailing: () => {
      failing = false;
    },
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

useTestEnv({
  AI_PROVIDER: 'openai-compatible',
  AI_STREAMING: 'true',
  DAILY_MESSAGE_LIMIT: '20',
  LOG_LEVEL: 'silent',
});

let provider;
let server;
let client;

before(async () => {
  provider = await startRecordingProvider();
  process.env.OPENAI_COMPATIBLE_BASE_URL = provider.url;
  process.env.OPENAI_COMPATIBLE_MODEL = 'recorder-model';

  const { config } = await loadServer();
  config.ai.openaiCompatible.baseUrl = provider.url;

  server = await startTestServer();
  client = createClient(server.baseUrl, { deviceId: 'provider-request-device-1' });
});

after(async () => {
  await server?.close();
  await provider?.close();
});

const TEST_MESSAGES = [
  'mera aaj birthday hai',
  'mujhe aaj bohat gussa aa raha hai',
  'what are you doing?',
];

/** Sends one message through the JSON path and returns the response. */
async function send(content) {
  return client.request('/chat/girlfriend/messages', {
    method: 'POST',
    body: { content, clientMessageId: randomUUID(), stream: false },
  });
}

/** All `role: user` contents inside a captured payload. */
const userContents = (body) =>
  (body.messages ?? []).filter((message) => message.role === 'user').map((message) => message.content);

describe('outgoing provider requests', () => {
  test("the user's exact message is sent to the provider", async () => {
    const response = await send(TEST_MESSAGES[0]);
    assert.equal(response.status, 200, JSON.stringify(response.body?.error));

    const last = provider.requests.at(-1).body;
    assert.ok(
      userContents(last).includes(TEST_MESSAGES[0]),
      `expected "${TEST_MESSAGES[0]}" in the upstream payload, got ${JSON.stringify(userContents(last))}`,
    );
  });

  test('the request carries the companion persona as a system prompt', async () => {
    const last = provider.requests.at(-1).body;
    const system = (last.messages ?? []).find((message) => message.role === 'system');
    assert.ok(system, 'a system prompt must be sent');
    assert.match(system.content, /Ayesha/);
    assert.match(system.content, /girlfriend/i);
    assert.match(system.content, /Urdu|language/i, 'language mirroring instructions must be present');
  });

  test('conversation history is sent on the next turn', async () => {
    const response = await send(TEST_MESSAGES[1]);
    assert.equal(response.status, 200);

    const payload = provider.requests.at(-1).body;
    const sent = userContents(payload);

    // The new message…
    assert.ok(sent.includes(TEST_MESSAGES[1]));
    // …and the previous exchange (earlier user message + the reply it received).
    assert.ok(
      sent.includes(TEST_MESSAGES[0]),
      'the previous user message must be part of the history sent upstream',
    );

    const assistantContents = (payload.messages ?? [])
      .filter((message) => message.role === 'assistant')
      .map((message) => message.content);
    assert.ok(assistantContents.length > 0, 'earlier assistant replies must be part of the history');
    assert.ok(
      assistantContents.some((content) => /^reply-\d+$/.test(content) || content.includes('aagaye')),
      `expected stored assistant history upstream, got ${JSON.stringify(assistantContents)}`,
    );
  });

  test('three different messages produce three different upstream payloads', async () => {
    const before = provider.requests.length;
    for (const message of TEST_MESSAGES) {
      const response = await send(message);
      assert.equal(response.status, 200, JSON.stringify(response.body?.error));
    }

    const payloads = provider.requests.slice(before).map((entry) => JSON.stringify(entry.body));
    assert.equal(payloads.length, TEST_MESSAGES.length);

    // No two requests are identical, and each carries its own message.
    assert.equal(new Set(payloads).size, payloads.length, 'each message must produce its own request');
    for (const [index, message] of TEST_MESSAGES.entries()) {
      assert.ok(
        payloads[index].includes(message),
        `request ${index + 1} must contain "${message}"`,
      );
    }
  });

  test('the app invents no assistant text of its own', async () => {
    // Everything sent as an assistant turn must have come from the provider
    // (or be the seeded greeting) — never a canned reply written in the app.
    for (const entry of provider.requests) {
      for (const message of entry.body.messages ?? []) {
        if (message.role !== 'assistant') continue;
        assert.ok(
          /^reply-\d+$/.test(message.content) || /aagaye|kahan ho tum/.test(message.content),
          `unexpected assistant text reached the provider: ${JSON.stringify(message.content)}`,
        );
      }
    }
  });

  test('a provider failure surfaces as an error — not as a canned reply', async () => {
    // Every attempt fails (the client tries streaming, then non-streaming, per
    // model), so the turn cannot be completed.
    provider.startFailing();
    const response = await send('are you there?');
    provider.stopFailing();

    assert.equal(response.status, 502, JSON.stringify(response.body));
    assert.equal(response.body.error.code, 'ai_unavailable');
    assert.equal(response.body.assistantMessage, undefined, 'no assistant text may be fabricated');
    assert.ok(
      !JSON.stringify(response.body).includes('Achha achha'),
      'the canned stand-in string must never appear in an API response',
    );

    // The user's message is still stored, so a retry can pick it up.
    const history = await client.request('/conversations/girlfriend/messages');
    assert.ok(history.body.messages.some((message) => message.content === 'are you there?'));
  });
});

describe('provider honesty flags', () => {
  test('/api/health reports whether the endpoint is local and whether it is the stand-in', async () => {
    const response = await client.request('/health');
    assert.equal(response.body.ai.provider, 'openai-compatible');
    assert.equal(response.body.ai.model, 'recorder-model');
    // The recorder runs on 127.0.0.1, so it is correctly reported as local…
    assert.equal(response.body.ai.local, true);
    // …but it is not the bundled stand-in (different model name).
    assert.equal(response.body.ai.demo, false);
  });
});
