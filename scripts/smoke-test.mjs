#!/usr/bin/env node
/**
 * Yaar end-to-end smoke test.
 *
 *   npm run smoke
 *
 * Starts the REAL server (Express + SQLite, in a temporary database), a mock AI
 * provider that speaks the same OpenAI-compatible contract as Hugging Face, and
 * then drives the app over HTTP exactly like the browser does:
 *
 *   1. session bootstrap                 → identity, usage, companions, AI status
 *   2. new chat                          → the companion greeting is seeded
 *   3. streaming send (English)          → meta → deltas → done
 *   4. language mirroring                → Urdu, Hindi, Roman Urdu, mixed
 *   5. refresh persistence               → same device, new client, same history
 *   6. 20 messages                       → all accepted, replies stored
 *   7. message 21                        → 429 daily_limit_reached, nothing lost
 *   8. AI outage                         → friendly error + message refunded
 *   9. privacy                           → another device sees nothing
 *  10. clearing a conversation           → greeting re-seeded, counter untouched
 *
 * Exit code 0 = everything passed. This is the script to run before a release,
 * and it is also the fastest way for a new developer (or agent) to see the whole
 * product working without an API key.
 */

import process from 'node:process';

import { startMockAiServer } from './mockAiServer.mjs';

// Keep the test database out of the real one.
process.env.NODE_ENV = 'test';
process.env.DATABASE_PATH = process.env.SMOKE_DATABASE_PATH || ':memory:';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'smoke-test-secret-not-for-production';
process.env.AI_PROVIDER = 'openai-compatible';
process.env.AI_STREAMING = 'true';
process.env.DAILY_MESSAGE_LIMIT = process.env.DAILY_MESSAGE_LIMIT || '20';
process.env.LOG_LEVEL = process.env.SMOKE_VERBOSE ? 'debug' : 'warn';

const mock = await startMockAiServer({ host: '127.0.0.1' });
process.env.OPENAI_COMPATIBLE_BASE_URL = mock.url;
process.env.OPENAI_COMPATIBLE_MODEL = 'yaar-smoke-model';

const { createApp } = await import('../server/app.js');
const { config } = await import('../server/config.js');
config.ai.openaiCompatible.baseUrl = mock.url;

const app = createApp({ clientDistPath: null });
const server = await new Promise((resolve) => {
  const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
});
const BASE = `http://127.0.0.1:${server.address().port}/api`;

const LIMIT = Number(process.env.DAILY_MESSAGE_LIMIT || 20);

let passed = 0;
let failed = 0;
const failures = [];

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    failures.push(label);
    console.log(`  ✗ ${label}${detail ? ` — ${detail}` : ''}`);
  }
}

function section(title) {
  console.log(`\n${title}`);
}

/** Minimal browser-like client: keeps cookies and sends the device id. */
function createClient(deviceId) {
  const cookies = new Map();

  const headers = (extra = {}) => ({
    'x-yaar-device-id': deviceId,
    ...(cookies.size ? { cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
    ...extra,
  });

  async function request(path, { method = 'GET', body, base = BASE } = {}) {
    const response = await fetch(`${base}${path}`, {
      method,
      headers: headers(body === undefined ? {} : { 'content-type': 'application/json' }),
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: 'manual',
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
    return { status: response.status, body: json };
  }

  async function stream(path, body) {
    const response = await fetch(`${BASE}${path}`, {
      method: 'POST',
      headers: headers({ 'content-type': 'application/json', accept: 'text/event-stream' }),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      return { status: response.status, frames: [], body: await response.json().catch(() => null) };
    }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    const frames = [];
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
  const data = [];
  for (const line of raw.split(/\r?\n/)) {
    if (line.startsWith('event:')) event = line.slice(6).trim();
    else if (line.startsWith('data:')) data.push(line.slice(5).trim());
  }
  try {
    return { event, data: JSON.parse(data.join('\n')) };
  } catch {
    return { event, data: null };
  }
}

const streamedText = (frames) =>
  frames.filter((f) => f.event === 'delta').map((f) => f.data?.text ?? '').join('');

const main = async () => {
  console.log('Yaar smoke test');
  console.log('===============');
  console.log(`api      : ${BASE}`);
  console.log(`provider : mock OpenAI-compatible at ${mock.url}`);
  console.log(`limit    : ${LIMIT} messages / 24h`);

  const alice = createClient('smoke-device-alice-0001');
  const bob = createClient('smoke-device-bob-0002');

  section('1. session bootstrap');
  const session = await alice.request('/session');
  check('GET /api/session → 200', session.status === 200, `got ${session.status}`);
  check('anonymous identity issued', Boolean(session.body?.user?.ref));
  check('usage starts at zero', session.body?.usage?.used === 0);
  check('limit is 20', session.body?.usage?.limit === LIMIT);
  check('two companions offered', session.body?.companions?.length === 2);
  check(
    'companion prompts are not exposed',
    session.body?.companions?.every((c) => c.persona === undefined),
  );
  check('AI status is reported as configured', session.body?.ai?.configured === true);

  section('2. opening a new chat');
  const history = await alice.request('/conversations/girlfriend/messages');
  check('conversation created', history.status === 200);
  check('greeting is seeded', history.body?.messages?.[0]?.sender === 'assistant');
  check('greeting does not consume a message', history.body?.usage?.used === 0);

  section('3. streaming a reply (English)');
  const turn = await alice.stream('/chat/girlfriend/messages', {
    content: 'Hey, I had a really long day at work',
    clientMessageId: 'smoke-message-0001',
  });
  const meta = turn.frames.find((f) => f.event === 'meta');
  const done = turn.frames.find((f) => f.event === 'done');
  check('stream opens with meta', Boolean(meta));
  check('meta reports usage 1', meta?.data?.usage?.used === 1);
  check('reply streams in deltas', streamedText(turn.frames).length > 10);
  check('stream closes with done', Boolean(done));
  check('model reasoning is stripped', !streamedText(turn.frames).includes('think'));
  check('reply is persisted', Boolean(done?.data?.assistantMessage?.content));
  check('reply did not consume a message', done?.data?.usage?.used === 1);

  section('4. language mirroring');
  const languageCases = [
    { text: 'آج میرا دن بہت لمبا تھا', label: 'Urdu → Urdu', match: /[\u0600-\u06FF]/ },
    { text: 'आज मेरा दिन लंबा था', label: 'Hindi → Hindi', match: /[\u0900-\u097F]/ },
    { text: 'aaj buhat lamba din tha yaar', label: 'Roman Urdu → Roman Urdu', match: /Achha|sunao/i },
    { text: 'long day today', label: 'English → English', match: /day went|That sounds/i },
  ];
  for (const [index, testCase] of languageCases.entries()) {
    const response = await alice.request('/chat/girlfriend/messages', {
      method: 'POST',
      body: {
        content: testCase.text,
        clientMessageId: `smoke-lang-${index}`,
        stream: false,
      },
    });
    check(testCase.label, testCase.match.test(response.body?.assistantMessage?.content ?? ''));
  }

  section('5. refresh persistence');
  const refreshed = createClient('smoke-device-alice-0001'); // same device, no cookies
  const afterRefresh = await refreshed.request('/conversations/girlfriend/messages');
  check('history survives a reload', (afterRefresh.body?.messages?.length ?? 0) >= 7);
  check(
    'usage survives a reload',
    afterRefresh.body?.usage?.used === (await alice.request('/usage')).body?.usage?.used,
  );

  section(`6. filling the daily allowance (${LIMIT} messages)`);
  const filler = createClient('smoke-device-limit-0003');
  let lastUsage = 0;
  let fillOk = true;
  for (let index = 1; index <= LIMIT; index += 1) {
    const response = await filler.request('/chat/girlfriend/messages', {
      method: 'POST',
      body: { content: `message ${index}`, clientMessageId: `smoke-fill-${index}`, stream: false },
    });
    if (response.status !== 200 || response.body?.usage?.used !== index) {
      fillOk = false;
      console.log(`    ...failed on message ${index}: ${response.status} ${JSON.stringify(response.body?.error)}`);
      break;
    }
    lastUsage = response.body.usage.used;
  }
  check(`all ${LIMIT} messages accepted, counter increments 1→${LIMIT}`, fillOk && lastUsage === LIMIT);

  section('7. message 21 is rejected');
  const rejected = await filler.request('/chat/girlfriend/messages', {
    method: 'POST',
    body: { content: 'message 21', clientMessageId: 'smoke-fill-21', stream: false },
  });
  check('HTTP 429', rejected.status === 429, `got ${rejected.status}`);
  check('error code is daily_limit_reached', rejected.body?.error?.code === 'daily_limit_reached');
  check(
    'message explains the 24 hour wait',
    /24 hours/.test(rejected.body?.error?.message ?? ''),
  );
  check('usage details are returned', rejected.body?.error?.details?.usage?.used === LIMIT);
  check('reset time is in the future', rejected.body?.error?.details?.usage?.resetAt > Date.now());

  const afterLimit = await filler.request('/conversations/girlfriend/messages');
  check('conversation is not deleted at the limit', (afterLimit.body?.messages?.length ?? 0) >= LIMIT * 2);
  check('rejected message was not stored', !JSON.stringify(afterLimit.body?.messages).includes('message 21'));

  section('8. AI outage is friendly and refunded');
  const outage = createClient('smoke-device-outage-0004');
  const originalBase = config.ai.openaiCompatible.baseUrl;
  config.ai.openaiCompatible.baseUrl = `${mock.url}?fail=fail`;
  const beforeOutage = (await outage.request('/usage')).body.usage.used;
  const failedResponse = await outage.request('/chat/girlfriend/messages', {
    method: 'POST',
    body: { content: 'anyone home?', clientMessageId: 'smoke-outage-0001', stream: false },
  });
  config.ai.openaiCompatible.baseUrl = originalBase;

  check('upstream failure → 502', failedResponse.status === 502, `got ${failedResponse.status}`);
  check('friendly code', failedResponse.body?.error?.code === 'ai_unavailable');
  check(
    'no stack traces in the message',
    !/at Object|stack|\.js:\d/.test(failedResponse.body?.error?.message ?? ''),
  );
  check(
    'message was refunded',
    failedResponse.body?.error?.details?.usage?.used === beforeOutage,
    `used ${failedResponse.body?.error?.details?.usage?.used} vs ${beforeOutage}`,
  );

  section('9. privacy between users');
  const bobHistory = await bob.request('/conversations/girlfriend/messages');
  check('other user only sees their own greeting', bobHistory.body?.messages?.length === 1);
  check('other user has their own counter', bobHistory.body?.usage?.used === 0);

  section('10. clearing a conversation');
  const cleared = await filler.request('/conversations/girlfriend/messages', { method: 'DELETE' });
  check('clear succeeds', cleared.status === 200);
  check('messages removed', cleared.body?.cleared >= LIMIT * 2);
  check('greeting re-seeded', cleared.body?.messages?.length === 1);
  const usageAfterClear = await filler.request('/usage');
  check('usage counter is unaffected by clearing', usageAfterClear.body?.usage?.used === LIMIT);

  console.log('\n───────────────');
  console.log(`passed: ${passed}   failed: ${failed}`);
  if (failed > 0) console.log(`failures:\n - ${failures.join('\n - ')}`);
  console.log('───────────────');

  return failed === 0 ? 0 : 1;
};

let exitCode = 1;
try {
  exitCode = await main();
} catch (error) {
  console.error('\nsmoke test crashed:', error);
  exitCode = 1;
} finally {
  await new Promise((resolve) => server.close(resolve));
  await mock.close();
  // The SQLite handle keeps the process alive if it is not closed.
  const { closeDatabase } = await import('../server/db/database.js');
  closeDatabase();
}

process.exit(exitCode);
