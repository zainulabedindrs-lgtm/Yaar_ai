/**
 * OpenAI-compatible mock provider, usable as a library or as a CLI server.
 *
 * The CLI wrapper lives in `scripts/dev-mock-hf.mjs`; the automated tests import
 * `startMockAiServer()` directly so they can run the full chat pipeline without
 * touching the internet or a real API key.
 *
 * It speaks the same contract as `https://router.huggingface.co/v1`:
 * `POST /v1/chat/completions` with `stream: true|false` and OpenAI-style error
 * objects. Failures are selectable with `?fail=`, which is how the error paths
 * in `openaiCompatibleClient.js` are tested.
 */

import http from 'node:http';

import { REASONING_CLOSE, REASONING_OPEN } from '../shared/reasoning.js';

const ARABIC = /[\u0600-\u06FF]/;
const DEVANAGARI = /[\u0900-\u097F]/;
const ROMAN_MARKERS =
  /\b(kya|kaise|kaisa|hai|hain|ho|hun|nahi|theek|thik|acha|achha|yaar|tum|aap|mera|meri|mujhe|batao|karo|bahut|bohat|aaj|kal|abhi|dil|khush|udaas)\b/i;

/** Builds a language-mirroring reply, the way the real model should behave. */
export function craftReply(userText, persona = 'girlfriend') {
  if (ARABIC.test(userText)) {
    return 'یہ تو بہت اچھی بات ہے 💛 میں یہیں ہوں، آگے بتاؤ کیا ہوا؟';
  }
  if (DEVANAGARI.test(userText)) {
    return 'अरे वाह 💛 मैं यहीं हूँ, आगे बताओ क्या हुआ?';
  }
  if (ROMAN_MARKERS.test(userText)) {
    return 'Achha achha, sunao zara 💛 din kaisa gaya tumhara?';
  }
  return 'That sounds like a lot 💛 Tell me more about how your day went?';
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let data = '';
    req.on('data', (chunk) => {
      data += chunk;
      if (data.length > 2_000_000) {
        reject(new Error('payload too large'));
        req.destroy();
      }
    });
    req.on('end', () => resolve(data));
    req.on('error', reject);
  });
}

/**
 * @param {{ port?: number, host?: string }} [options]
 * @returns {Promise<{ url: string, port: number, close: () => Promise<void>, server: http.Server }>}
 */
export async function startMockAiServer({ port = 0, host = '127.0.0.1' } = {}) {
  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, `http://${req.headers.host}`);

    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ ok: true, mock: true }));
      return;
    }

    if (url.pathname !== '/v1/chat/completions' || req.method !== 'POST') {
      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Not found', type: 'invalid_request_error' } }));
      return;
    }

    const failure = url.searchParams.get('fail');
    if (failure === 'timeout') return; // hold the socket open; the client gives up

    // Refuse to stream, but answer non-streaming requests normally. This is how
    // the "provider cannot stream" fallback is exercised.
    if (failure === 'streamonly') {
      const requestedStream = /"stream"\s*:\s*true/.test(await readBody(req));
      if (requestedStream) {
        res.writeHead(400, { 'content-type': 'application/json' });
        res.end(
          JSON.stringify({ error: { message: 'Streaming is not supported', type: 'invalid_request_error' } }),
        );
        return;
      }
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'mock',
          object: 'chat.completion',
          model: 'mock-model',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: 'Non-streaming fallback worked 💛' },
              finish_reason: 'stop',
            },
          ],
        }),
      );
      return;
    }

    if (failure && failure !== 'empty') {
      const table = {
        ratelimit: [429, 'Rate limit exceeded'],
        auth: [401, 'Invalid credentials'],
        fail: [503, 'Model is loading'],
        model: [404, 'Model not found'],
      };
      const [status, message] = table[failure] ?? [500, 'Unknown failure'];
      res.writeHead(status, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message, type: failure } }));
      return;
    }

    let body = {};
    try {
      body = JSON.parse((await readBody(req)) || '{}');
    } catch {
      res.writeHead(400, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: { message: 'Bad JSON', type: 'invalid_request_error' } }));
      return;
    }

    const messages = Array.isArray(body.messages) ? body.messages : [];
    const system = messages.find((message) => message.role === 'system')?.content ?? '';
    const persona = /Hamza/.test(system) ? 'boyfriend' : 'girlfriend';
    const lastUser = [...messages].reverse().find((message) => message.role === 'user');
    const userText = typeof lastUser?.content === 'string' ? lastUser.content : '';

    const reply = failure === 'empty' ? '' : craftReply(userText, persona);
    // Leaks a reasoning block on purpose: the client must strip it. In "empty"
    // mode the answer really is empty, reasoning included.
    const full =
      failure === 'empty'
        ? ''
        : `${REASONING_OPEN}The user wrote something; reply warmly.${REASONING_CLOSE}${reply}`;
    const model = body.model || 'mock-model';

    if (body.stream) {
      res.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });

      const chunks = full.match(/[\s\S]{1,9}/g) ?? [];
      let index = 0;
      const timer = setInterval(() => {
        if (index >= chunks.length) {
          clearInterval(timer);
          res.write(
            `data: ${JSON.stringify({
              id: 'mock',
              object: 'chat.completion.chunk',
              model,
              choices: [{ index: 0, delta: {}, finish_reason: 'stop' }],
            })}\n\n`,
          );
          res.write('data: [DONE]\n\n');
          res.end();
          return;
        }
        res.write(
          `data: ${JSON.stringify({
            id: 'mock',
            object: 'chat.completion.chunk',
            model,
            choices: [{ index: 0, delta: { content: chunks[index] }, finish_reason: null }],
          })}\n\n`,
        );
        index += 1;
      }, 15);

      req.on('close', () => clearInterval(timer));
      return;
    }

    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(
      JSON.stringify({
        id: 'mock',
        object: 'chat.completion',
        model,
        usage: { prompt_tokens: 10, completion_tokens: 12, total_tokens: 22 },
        choices: [
          { index: 0, message: { role: 'assistant', content: full }, finish_reason: 'stop' },
        ],
      }),
    );
  });

  await new Promise((resolve) => server.listen(port, host, resolve));
  const actualPort = server.address().port;

  return {
    server,
    port: actualPort,
    url: `http://${host}:${actualPort}/v1`,
    close: () =>
      new Promise((resolve) => {
        server.close(() => resolve());
      }),
  };
}
