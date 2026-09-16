#!/usr/bin/env node
/**
 * Inspect the exact payload the chat sends to the AI provider.
 *
 *   npm run inspect:request -- "mera aaj birthday hai"
 *   npm run inspect:request -- "mera aaj birthday hai" "what are you doing?"
 *
 * It boots the REAL app (same routes, same chat service, same prompt builder)
 * with a recording endpoint in place of the model, sends the messages you pass,
 * and prints:
 *
 *   • which provider/model would receive the request (from your .env),
 *   • the full message list sent upstream (system persona + history + your text),
 *   • a check that each message produced its own request.
 *
 * Nothing leaves your machine and no API key is required, which makes this the
 * fastest way to answer "is the app sending my message, or a canned reply?".
 * The conversation is written to a throwaway in-memory database.
 */

import http from 'node:http';
import process from 'node:process';

const messages = process.argv.slice(2).filter((argument) => !argument.startsWith('--'));
if (messages.length === 0) {
  console.error('Usage: npm run inspect:request -- "your message" ["another message"]');
  process.exit(1);
}

// --- a provider that records instead of answering ---------------------------
const recorded = [];
const recorder = http.createServer((req, res) => {
  let raw = '';
  req.on('data', (chunk) => {
    raw += chunk;
  });
  req.on('end', () => {
    let body = {};
    try {
      body = raw ? JSON.parse(raw) : {};
    } catch {
      body = {};
    }
    recorded.push(body);

    const reply = `[inspection reply ${recorded.length}]`;
    if (body.stream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: reply } }] })}\n\n`);
      res.write('data: [DONE]\n\n');
      res.end();
      return;
    }
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: reply } }] }));
  });
});
await new Promise((resolve) => recorder.listen(0, '127.0.0.1', resolve));

// --- run the real app against the recorder ----------------------------------
// Set BEFORE importing any server module: config is read at import time.
process.env.AI_PROVIDER = 'openai-compatible';
process.env.OPENAI_COMPATIBLE_BASE_URL = `http://127.0.0.1:${recorder.address().port}/v1`;
process.env.OPENAI_COMPATIBLE_MODEL = 'inspection-recorder';
process.env.DATABASE_PATH = ':memory:';
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'inspection-only-secret';
process.env.LOG_LEVEL = 'warn';

const { createApp } = await import('../server/app.js');
const { closeDatabase } = await import('../server/db/database.js');

const app = createApp({ clientDistPath: null });
const server = await new Promise((resolve) => {
  const instance = app.listen(0, '127.0.0.1', () => resolve(instance));
});
const baseUrl = `http://127.0.0.1:${server.address().port}/api`;
const headers = {
  'content-type': 'application/json',
  'x-yaar-device-id': 'inspection-device-0001',
};

console.log('Yaar — outgoing provider request inspector');
console.log('==========================================');
console.log(`messages to send : ${messages.length}`);
console.log('');

let index = 0;
for (const message of messages) {
  index += 1;
  const before = recorded.length;

  const response = await fetch(`${baseUrl}/chat/girlfriend/messages`, {
    method: 'POST',
    headers,
    body: JSON.stringify({
      content: message,
      clientMessageId: `inspect-${String(index).padStart(4, '0')}-4f2a-4c9b-9d3e-0000000000${index}`,
      stream: false,
    }),
  });
  const payload = await response.json().catch(() => null);

  const captured = recorded.slice(before);
  const last = captured.at(-1) ?? {};

  console.log(`── message ${index}: ${JSON.stringify(message)}`);
  console.log(`   HTTP ${response.status}  |  upstream requests: ${captured.length}`);
  console.log(`   user text present in payload: ${JSON.stringify(last.messages ?? []).includes(message) ? 'yes' : 'NO'}`);
  console.log(`   history turns sent: ${(last.messages ?? []).length}`);
  console.log(`   reply returned to the app: ${JSON.stringify(payload?.assistantMessage?.content ?? payload?.error?.code ?? null)}`);
  console.log('   payload sent upstream:');
  for (const entry of last.messages ?? []) {
    const content = String(entry.content).replace(/\s+/g, ' ');
    const shown = content.length > 150 ? `${content.slice(0, 150)}…` : content;
    console.log(`     [${entry.role}] ${shown}`);
  }
  console.log('');
}

const allDifferent = new Set(recorded.map((body) => JSON.stringify(body))).size === recorded.length;
console.log('───────────────────────────────────────────');
console.log(`payloads captured     : ${recorded.length}`);
console.log(`all payloads distinct : ${allDifferent ? 'yes' : 'NO — requests are being reused'}`);
console.log('───────────────────────────────────────────');

await new Promise((resolve) => server.close(resolve));
await new Promise((resolve) => recorder.close(resolve));
closeDatabase();
process.exit(allDifferent ? 0 : 1);
