#!/usr/bin/env node
/**
 * Live end-to-end test against the REAL AI provider.
 *
 *   npm run test:live -- "mera aaj birthday hai" "mujhe aaj bohat gussa aa raha hai" "what are you doing?"
 *   npm run test:live                # uses the three default messages above
 *
 * This is the only script that talks to Hugging Face over the internet. It:
 *
 *   1. refuses to run unless AI_PROVIDER=huggingface (never the stand-in),
 *   2. refuses to run without a key, and says where to put it (never prints it),
 *   3. checks that the router is actually reachable (a TLS reset / blocked
 *      egress is reported as such instead of a confusing timeout),
 *   4. boots the real app in-process with your `.env` and a throwaway database,
 *   5. sends each message through the exact HTTP/SSE path the UI uses,
 *   6. captures the server's own evidence line for every call
 *      (`ai reply generated` → provider, model, servedBy, tokens, ms),
 *   7. re-reads the conversation from the history endpoint — the same call the
 *      chat screen makes on refresh — to prove the reply was persisted, and
 *   8. fails if any reply is empty or if two replies are identical.
 *
 * The key is read from the environment by the server (server/config.js) and is
 * never printed, logged or echoed by this script.
 */

import process from 'node:process';
import { randomUUID } from 'node:crypto';

const DEFAULT_MESSAGES = [
  'mera aaj birthday hai',
  'mujhe aaj bohat gussa aa raha hai',
  'what are you doing?',
];

const cliMessages = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));
const messages = cliMessages.length > 0 ? cliMessages : DEFAULT_MESSAGES;

const line = (char = '─') => console.log(char.repeat(72));

// ---------------------------------------------------------------------------
// 1. Read the configuration the server will use (module import, no key echoed)
// ---------------------------------------------------------------------------
// Evidence is captured from the server's own `ai reply generated` log line, so
// info level is forced here (after any user value is remembered for display).
// Nothing from those lines is printed verbatim — only the fields we surface.
const userLogLevel = process.env.LOG_LEVEL;
process.env.LOG_LEVEL = 'info';

const { config } = await import('../server/config.js');
const key = config.ai.huggingface.apiKey;

const problems = [];
if (config.ai.provider !== 'huggingface') {
  problems.push(
    `AI_PROVIDER is "${config.ai.provider}" but this test only runs against the real provider.\n` +
      '    Fix: set AI_PROVIDER=huggingface in .env (the stand-in must never serve the real chat).',
  );
}
if (!key) {
  problems.push(
    'HUGGINGFACE_API_KEY is empty.\n' +
      '    Fix: put your token in .env (git-ignored) — the line reads\n' +
      '         HUGGINGFACE_API_KEY=<your token>\n' +
      '    or set it as an environment variable in your hosting dashboard.\n' +
      '    Do NOT paste the token into chat, an issue, or a committed file.',
  );
}
if (config.ai.demoProvider) {
  problems.push('The bundled canned-reply stand-in is configured; refusing to run.');
}

console.log('Yaar — live provider test');
line('=');
console.log(`provider     : ${config.ai.provider}`);
console.log(`base url     : ${config.ai.huggingface.baseUrl}`);
console.log(`model        : ${config.ai.huggingface.models[0]}`);
console.log(`fallbacks    : ${config.ai.huggingface.models.slice(1).join(', ') || 'none'}`);
console.log(`api key      : ${key ? `set (length ${key.length}, not printed)` : 'MISSING'}`);
console.log(`messages     : ${messages.length}`);
console.log(`log level    : ${userLogLevel ?? '(default)'} → info while testing (evidence capture)`);
line('=');

if (problems.length > 0) {
  console.log('\nCannot run:');
  for (const problem of problems) console.log(`  ✗ ${problem}`);
  console.log('\nNothing was sent.');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// 2. Preflight: is the provider reachable from here at all?
// ---------------------------------------------------------------------------
console.log('\n1. provider reachability');
const modelsUrl = `${config.ai.huggingface.baseUrl.replace(/\/+$/, '')}/models`;
let reachable = false;
try {
  const response = await fetch(modelsUrl, {
    headers: { authorization: `Bearer ${key}` },
    signal: AbortSignal.timeout(20_000),
  });
  reachable = response.ok;
  console.log(`   GET ${modelsUrl} → HTTP ${response.status}`);
  if (!response.ok) {
    const body = await response.text().catch(() => '');
    console.log(`   response: ${body.slice(0, 200)}`);
  }
} catch (error) {
  console.log(`   ✗ request failed: ${error?.cause?.code ?? error?.name} — ${error?.message}`);
  console.log('   The network refused the connection; the API may be blocked by a firewall/proxy.');
}

if (!reachable) {
  console.log('\nStopping: Hugging Face is not reachable from this environment.');
  console.log('Run this same command where the app will actually live (your machine or your host):');
  console.log('   npm run test:live\n');
  await shutdown(1);
}

// ---------------------------------------------------------------------------
// 3. Boot the real app with a throwaway database
// ---------------------------------------------------------------------------
process.env.DATABASE_PATH = ':memory:';

const { createApp } = await import('../server/app.js');
const { closeDatabase } = await import('../server/db/database.js');

const app = createApp({ clientDistPath: null });
const server = await new Promise((resolve) => {
  const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
});
const baseUrl = `http://127.0.0.1:${server.address().port}/api`;

/**
 * Captures the server's own evidence lines (`ai reply generated`,
 * `ai attempt failed`) instead of printing them, while letting every other
 * line — including this script's own output — through untouched.
 */
const evidence = [];
const originalLog = console.log;
const originalWarn = console.warn;
const EVIDENCE_EVENTS = new Set(['ai reply generated', 'ai attempt failed']);

const capture = (original) =>
  (...args) => {
    const text = args.map(String).join(' ');
    try {
      const parsed = JSON.parse(text);
      if (EVIDENCE_EVENTS.has(parsed.event)) {
        evidence.push(parsed);
        return;
      }
    } catch {
      // not a structured log line — fall through
    }
    original(...args);
  };

console.log = capture(originalLog);
console.warn = capture(originalWarn);

// ---------------------------------------------------------------------------
// 4. Run the conversation through the UI's own transport (HTTP + SSE)
// ---------------------------------------------------------------------------
const deviceId = `live-test-${randomUUID().slice(0, 8)}`;
const headers = { 'content-type': 'application/json', 'x-yaar-device-id': deviceId };

async function sendStreamed(content) {
  const response = await fetch(`${baseUrl}/chat/girlfriend/messages`, {
    method: 'POST',
    headers: { ...headers, accept: 'text/event-stream' },
    body: JSON.stringify({ content, clientMessageId: randomUUID(), stream: true }),
  });

  if (!response.ok) {
    const body = await response.json().catch(() => null);
    return { status: response.status, text: '', error: body?.error ?? { code: 'unknown_error' } };
  }

  // Parse SSE exactly like client/src/api/chatStream.js does.
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let text = '';
  let done = null;
  let error = null;

  for (;;) {
    const { done: finished, value } = await reader.read();
    if (finished) break;
    buffer += decoder.decode(value, { stream: true });
    let separator;
    while ((separator = buffer.search(/\r?\n\r?\n/)) !== -1) {
      const raw = buffer.slice(0, separator);
      buffer = buffer.slice(separator).replace(/^\r?\n\r?\n/, '');
      if (!raw.trim() || raw.startsWith(':')) continue;
      const eventMatch = /event:\s*(\w+)/.exec(raw);
      const dataMatch = /data:\s*([\s\S]+)/.exec(raw);
      if (!dataMatch) continue;
      let payload;
      try {
        payload = JSON.parse(dataMatch[1]);
      } catch {
        continue;
      }
      if (eventMatch?.[1] === 'delta') text += payload.text ?? '';
      if (eventMatch?.[1] === 'done') done = payload;
      if (eventMatch?.[1] === 'error') error = payload.error;
    }
  }

  return { status: response.status, text, done, error };
}

const results = [];
for (const [index, message] of messages.entries()) {
  const before = evidence.length;
  const result = await sendStreamed(message);
  const calls = evidence.slice(before);

  results.push({ message, ...result, calls });

  console.log(`\n2.${index + 1} message ${index + 1}: ${JSON.stringify(message)}`);
  if (result.error) {
    console.log(`   ✗ ${result.error.code}: ${result.error.message}`);
    continue;
  }
  console.log(`   reply (${result.text.length} chars): ${JSON.stringify(result.text.trim())}`);
  for (const call of calls) {
    console.log(
      `   upstream: ${call.provider} | model=${call.model}` +
        `${call.servedBy ? ` | servedBy=${call.servedBy}` : ''}` +
        `${call.tokens ? ` | tokens=${call.tokens}` : ''}` +
        `${call.ms !== undefined ? ` | ${call.ms}ms` : ''}`,
    );
  }
}

// ---------------------------------------------------------------------------
// 5. The reply must also reach the chat screen (history endpoint)
// ---------------------------------------------------------------------------
console.log('\n3. persistence (what the chat UI loads on refresh)');
const historyResponse = await fetch(`${baseUrl}/conversations/girlfriend/messages`, { headers });
const history = await historyResponse.json().catch(() => ({ messages: [] }));
const stored = (history.messages ?? []).filter((message) => message.sender === 'assistant');

for (const result of results) {
  const wanted = result.text.trim();
  const persisted = Boolean(wanted) && stored.some((message) => message.content.trim() === wanted);
  console.log(`   ${persisted ? '✓' : '✗'} stored: ${JSON.stringify(wanted.slice(0, 60))}`);
  result.persisted = persisted;
}

console.log = originalLog;
console.warn = originalWarn;

// ---------------------------------------------------------------------------
// 6. Verdict
// ---------------------------------------------------------------------------
console.log('\n4. verdict');
const replies = results.map((result) => result.text.trim());
const allAnswered = results.every((result) => result.text.trim().length > 0 && !result.error);
const allDistinct = new Set(replies).size === replies.length;
const allPersisted = results.every((result) => result.persisted);
const upstreamCalled = results.every((result) => result.calls.length > 0);

const checks = [
  [`all ${messages.length} messages answered`, allAnswered],
  ['every reply is different (no canned repetition)', allDistinct],
  ['every call reached the provider', upstreamCalled],
  ['every reply persisted for the chat UI', allPersisted],
];

line();
for (const [label, passed] of checks) console.log(`  ${passed ? '✓' : '✗'} ${label}`);
line();

if (allAnswered) {
  console.log('\nreplies side by side:');
  for (const [index, result] of results.entries()) {
    console.log(`  ${index + 1}. ${JSON.stringify(result.message)}`);
    console.log(`     → ${JSON.stringify(result.text.trim())}`);
  }
}

if (!allDistinct) {
  console.log('\nNote: identical replies from a real model usually mean the provider ignored the');
  console.log('input. Re-run with LOG_LEVEL=debug, and check HF_MODEL / HF_INFERENCE_PROVIDER.');
}

const ok = checks.every(([, passed]) => passed);
await shutdown(ok ? 0 : 1);

/** Closes the server + database and exits with the given code. */
async function shutdown(code) {
  try {
    await new Promise((resolve) => server?.close(resolve));
    closeDatabase?.();
  } catch {
    // best effort
  }
  process.exit(code);
}
