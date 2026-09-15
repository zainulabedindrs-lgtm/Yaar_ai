#!/usr/bin/env node
/**
 * Verifies the configured AI provider end to end.
 *
 *   npm run check:ai
 *   npm run check:ai -- "kya kar rahe ho?"
 *   npm run check:ai -- "Namaste, kaise ho?" --companion boyfriend
 *
 * It prints the provider, model, latency, and the reply — the fastest way to
 * confirm that `HF_API_KEY` and `HF_MODEL` are right before shipping.
 */

import process from 'node:process';

import { config, isAiConfigured } from '../server/config.js';
import { buildChatPrompt } from '../server/services/ai/promptBuilder.js';
import { getChatProvider } from '../server/services/ai/providers.js';
import { detectLanguage } from '../server/utils/languageDetect.js';

const args = process.argv.slice(2);
const companionFlagIndex = args.indexOf('--companion');
const companionId =
  companionFlagIndex !== -1 && args[companionFlagIndex + 1] === 'boyfriend' ? 'boyfriend' : 'girlfriend';
const text =
  args
    .filter((arg, index) => !arg.startsWith('--') && index !== companionFlagIndex + 1)
    .join(' ')
    .trim() || 'Hey, I had a long day today.';

const provider = getChatProvider();

console.log('Yaar AI check');
console.log('─────────────');
console.log(`provider   : ${provider.id} (${provider.label})`);
console.log(`base url   : ${config.ai.huggingface.baseUrl}`);
console.log(`models     : ${provider.models.join(' → ')}`);
console.log(`streaming  : ${config.ai.streaming}`);
console.log(`configured : ${isAiConfigured()}`);
console.log(`input      : "${text}"`);
console.log(`lang hint  : ${detectLanguage(text)}`);
console.log('');

if (!isAiConfigured()) {
  console.error(
    'AI provider is NOT configured. Add HF_API_KEY to your .env (see .env.example) and retry.',
  );
  process.exit(1);
}

const prompt = buildChatPrompt({
  companionId,
  history: [{ sender: 'user', content: text }],
});

const startedAt = Date.now();
let streamed = '';

try {
  const result = await provider.chat({
    messages: prompt,
    stream: config.ai.streaming,
    onDelta: (delta) => {
      streamed += delta;
      process.stdout.write(delta);
    },
  });

  if (config.ai.streaming) process.stdout.write('\n\n');
  console.log(`model used : ${result.model}`);
  console.log(`latency    : ${Date.now() - startedAt} ms`);
  console.log(`reply      : ${result.text || streamed}`);
  console.log('\n✅ AI provider is working.');
} catch (error) {
  console.error(`\n❌ AI request failed: ${error?.code || error?.name} — ${error?.message}`);
  console.error('   Check HF_API_KEY, HF_MODEL and your network connection.');
  process.exit(1);
}
