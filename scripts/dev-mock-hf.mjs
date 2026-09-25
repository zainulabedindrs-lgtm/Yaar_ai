#!/usr/bin/env node
/**
 * Local stand-in for the Hugging Face Inference Providers router.
 *
 *   npm run dev:mock-ai        # listens on http://127.0.0.1:8099/v1
 *
 * Why it exists
 * -------------
 * Offline development and the automated tests must not depend on a paid API or
 * on internet access. The mock implements the SAME OpenAI-compatible contract
 * that `https://router.huggingface.co/v1` exposes — including SSE streaming,
 * reasoning blocks and OpenAI-style error payloads — so the production AI code
 * path (server/services/ai/openaiCompatibleClient.js) is exercised end to end.
 *
 * It is NEVER used by the shipped app: Yaar only talks to it if you deliberately
 * set `AI_PROVIDER=openai-compatible` and point the base URL here.
 *
 * Failure modes (`?fail=`) are documented in scripts/mockAiServer.mjs and are
 * what the error-handling tests use.
 *
 * Point Yaar at it with:
 *   AI_PROVIDER=openai-compatible
 *   OPENAI_COMPATIBLE_BASE_URL=http://127.0.0.1:8099/v1
 *   OPENAI_COMPATIBLE_MODEL=yaar-mock
 */

import process from 'node:process';

import { startMockAiServer } from './mockAiServer.mjs';

const port = Number(process.env.MOCK_AI_PORT || 8099);
const host = process.env.MOCK_AI_HOST || '0.0.0.0';

const { url, close } = await startMockAiServer({ port, host });

console.log(`[mock-ai] OpenAI-compatible mock listening on ${url}`);
console.log('[mock-ai] fix a failure mode by appending ?fail= to the base URL, e.g.');
console.log(`[mock-ai]   OPENAI_COMPATIBLE_BASE_URL=${url}?fail=ratelimit`);
console.log('[mock-ai] modes: fail | timeout | empty | ratelimit | auth | model');

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, async () => {
    await close();
    process.exit(0);
  });
}
