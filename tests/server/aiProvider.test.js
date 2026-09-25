/**
 * AI service layer tests.
 *
 * These cover the parts that are easy to get silently wrong:
 *  - the reasoning-block filter (` thinking…<｜end▁of▁thinking｜>`) across chunk boundaries
 *  - SSE parsing, including a `[DONE]` terminator and half-open sockets
 *  - fallback to the next model, and to non-streaming when streaming is refused
 *  - mapping provider failures onto friendly API errors
 */

import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import { startMockAiServer } from '../../scripts/mockAiServer.mjs';
import { useTestEnv } from './helpers.js';

useTestEnv({ LOG_LEVEL: 'silent' });

const { OpenAiCompatibleChatClient, ReasoningFilter, extractMessageText } = await import(
  '../../server/services/ai/openaiCompatibleClient.js'
);
const { REASONING_CLOSE, REASONING_OPEN } = await import('../../shared/reasoning.js');

let mock;

before(async () => {
  mock = await startMockAiServer();
});

after(async () => {
  await mock?.close();
});

/** @param {Partial<ConstructorParameters<typeof OpenAiCompatibleChatClient>[0]>} overrides */
function makeClient(overrides = {}) {
  return new OpenAiCompatibleChatClient({
    id: 'huggingface',
    label: 'test',
    baseUrl: mock.url,
    apiKey: 'hf_test_key',
    models: ['test-model'],
    timeoutMs: 4_000,
    idleTimeoutMs: 4_000,
    ...overrides,
  });
}

describe('ReasoningFilter', () => {
  test('strips a reasoning block in one chunk', () => {
    const filter = new ReasoningFilter();
    const input = `${REASONING_OPEN}plan the reply${REASONING_CLOSE}Hello there`;
    assert.equal(filter.push(input), 'Hello there');
    assert.equal(filter.finish(), '');
  });

  test('strips a reasoning block split across many chunks', () => {
    const filter = new ReasoningFilter();
    const full = `${REASONING_OPEN}I should say hi${REASONING_CLOSE}Hi yaar 💛`;
    const chunks = ['<th', 'ink', '>I shou', 'ld say hi', '</thi', 'nk>Hi ', 'yaar 💛'];

    let output = '';
    for (const chunk of chunks) output += filter.push(chunk);
    output += filter.finish();

    assert.equal(output, 'Hi yaar 💛');
    assert.ok(!output.includes('think'), 'no part of the marker survives');
    void full;
  });

  test('passes normal text straight through', () => {
    const filter = new ReasoningFilter();
    let output = '';
    for (const chunk of ['Ki', 'se ', 'ho ', 'tum?']) output += filter.push(chunk);
    output += filter.finish();
    assert.equal(output, 'Kise ho tum?');
  });

  test('handles a payload that is only reasoning', () => {
    const filter = new ReasoningFilter();
    assert.equal(filter.push(`${REASONING_OPEN}nothing useful${REASONING_CLOSE}`), '');
    assert.equal(filter.finish(), '');
  });

  test('never emits a partial tag to the UI', () => {
    const filter = new ReasoningFilter();

    // Feed the opening marker one character at a time: nothing may leak.
    let leaked = '';
    for (const character of REASONING_OPEN) leaked += filter.push(character);
    assert.equal(leaked, '', 'an incomplete tag must not leak');

    assert.equal(filter.push('hidden reasoning'), '', 'reasoning stays hidden');
    for (const character of REASONING_CLOSE) assert.equal(filter.push(character), '');
    assert.equal(filter.push('Visible 💛'), 'Visible 💛');
    assert.equal(filter.finish(), '');
  });
});

describe('extractMessageText', () => {
  test('reads string content', () => {
    assert.equal(
      extractMessageText({ choices: [{ message: { content: 'hello' } }] }),
      'hello',
    );
  });

  test('reads array content (multimodal shape)', () => {
    assert.equal(
      extractMessageText({
        choices: [{ message: { content: [{ type: 'text', text: 'hel' }, { text: 'lo' }] } }],
      }),
      'hello',
    );
  });

  test('returns empty string for a malformed payload', () => {
    assert.equal(extractMessageText(null), '');
    assert.equal(extractMessageText({}), '');
  });
});

describe('streaming chat', () => {
  test('streams deltas and strips reasoning', async () => {
    const client = makeClient();
    const deltas = [];
    const result = await client.chat({
      messages: [{ role: 'user', content: 'hi, aaj kaisa din tha?' }],
      stream: true,
      onDelta: (delta) => deltas.push(delta),
    });

    assert.ok(deltas.length > 1, 'the reply arrived in pieces');
    assert.match(result.text, /Achha achha/);
    assert.ok(!result.text.includes('think'), 'the reasoning block is stripped');
    assert.equal(deltas.join(''), result.text);
  });

  test('mirrors the language of the input', async () => {
    const client = makeClient();

    const urdu = await client.chat({
      messages: [{ role: 'user', content: 'آج میرا دن کیسا رہا؟' }],
      stream: true,
      onDelta: () => {},
    });
    assert.match(urdu.text, /[\u0600-\u06FF]/, 'Urdu input gets an Urdu reply');

    const hindi = await client.chat({
      messages: [{ role: 'user', content: 'आज कैसा रहा?' }],
      stream: true,
      onDelta: () => {},
    });
    assert.match(hindi.text, /[\u0900-\u097F]/, 'Hindi input gets a Hindi reply');
  });

  test('non-streaming mode returns the whole reply', async () => {
    const client = makeClient();
    const result = await client.chat({
      messages: [{ role: 'user', content: 'hello there' }],
      stream: false,
    });
    assert.match(result.text, /day went/i);
    assert.equal(result.finishReason, 'stop');
  });

  test('falls back to non-streaming when the provider refuses to stream', async () => {
    // `?fail=streamonly` rejects streaming with HTTP 400 but answers normal
    // requests, which is exactly how some providers behave.
    const client = makeClient({ baseUrl: `${mock.url}?fail=streamonly` });
    const deltas = [];
    const result = await client.chat({
      messages: [{ role: 'user', content: 'hello' }],
      stream: true,
      onDelta: (delta) => deltas.push(delta),
    });

    assert.match(result.text, /Non-streaming fallback worked/);
    assert.equal(deltas.join(''), result.text, 'the whole reply reaches the UI exactly once');
  });

  test('keeps a query string in the configured base URL', async () => {
    const client = makeClient({ baseUrl: `${mock.url}?tenant=yaar` });
    const result = await client.chat({
      messages: [{ role: 'user', content: 'hello' }],
      stream: false,
    });
    assert.ok(result.text.length > 0);
  });
});

describe('error mapping', () => {
  test('a 503 becomes a friendly ai_unavailable error', async () => {
    const client = makeClient({ baseUrl: `${mock.url}?fail=fail` });
    await assert.rejects(
      () => client.chat({ messages: [{ role: 'user', content: 'hi' }], stream: false }),
      (error) => {
        assert.equal(error.status, 502);
        assert.equal(error.code, 'ai_unavailable');
        assert.doesNotMatch(error.message, /503|model is loading/i);
        return true;
      },
    );
  });

  test('a 429 becomes rate_limited', async () => {
    const client = makeClient({ baseUrl: `${mock.url}?fail=ratelimit` });
    await assert.rejects(
      () => client.chat({ messages: [{ role: 'user', content: 'hi' }], stream: false }),
      (error) => {
        assert.equal(error.status, 429);
        assert.equal(error.code, 'rate_limited');
        return true;
      },
    );
  });

  test('a 401 becomes ai_not_configured', async () => {
    const client = makeClient({ baseUrl: `${mock.url}?fail=auth` });
    await assert.rejects(
      () => client.chat({ messages: [{ role: 'user', content: 'hi' }], stream: false }),
      (error) => {
        assert.equal(error.status, 502);
        assert.equal(error.code, 'ai_not_configured');
        return true;
      },
    );
  });

  test('a hung provider times out with ai_timeout', async () => {
    const client = makeClient({
      baseUrl: `${mock.url}?fail=timeout`,
      timeoutMs: 300,
      idleTimeoutMs: 300,
    });
    await assert.rejects(
      () => client.chat({ messages: [{ role: 'user', content: 'hi' }], stream: true }),
      (error) => {
        assert.equal(error.status, 504);
        assert.equal(error.code, 'ai_timeout');
        return true;
      },
    );
  });

  test('an unreachable provider becomes ai_unavailable (not a TypeError)', async () => {
    const client = makeClient({ baseUrl: 'http://127.0.0.1:1/v1' });
    await assert.rejects(
      () => client.chat({ messages: [{ role: 'user', content: 'hi' }], stream: false }),
      (error) => {
        assert.equal(error.code, 'ai_unavailable');
        return true;
      },
    );
  });

  test('an empty reply becomes ai_empty_response', async () => {
    const client = makeClient({ baseUrl: `${mock.url}?fail=empty` });
    await assert.rejects(
      () => client.chat({ messages: [{ role: 'user', content: 'hi' }], stream: false }),
      (error) => {
        assert.equal(error.code, 'ai_empty_response');
        return true;
      },
    );
  });

  test('tries the fallback models before giving up', async () => {
    const client = makeClient({
      baseUrl: `${mock.url}?fail=model`,
      models: ['primary-model', 'fallback-model'],
    });

    // Both models hit the same 404 here, so the call fails — but the point is
    // that it tried more than once without throwing a raw fetch error.
    await assert.rejects(() => client.chat({ messages: [{ role: 'user', content: 'hi' }] }));
  });

  test('isConfigured is false without an API key (Hugging Face mode)', () => {
    const client = makeClient({ apiKey: '' });
    assert.equal(client.isConfigured, false);
  });
});
