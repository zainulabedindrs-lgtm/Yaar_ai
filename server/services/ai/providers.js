/**
 * AI provider factory.
 *
 * Everything AI-related sits behind `getChatProvider()`, so replacing Hugging
 * Face with another backend (or a self-hosted model) means adding one factory
 * branch here — the chat service, the routes and the UI stay untouched.
 */

import { config } from '../../config.js';
import { OpenAiCompatibleChatClient } from './openaiCompatibleClient.js';

/** @type {OpenAiCompatibleChatClient | null} */
let cachedProvider = null;
let cachedSignature = '';

function signature() {
  const { ai } = config;
  return JSON.stringify({
    provider: ai.provider,
    hfKey: ai.huggingface.apiKey ? 'set' : 'unset',
    hfBase: ai.huggingface.baseUrl,
    hfModels: ai.huggingface.models,
    pin: ai.huggingface.providerPin,
    oaiBase: ai.openaiCompatible.baseUrl,
    oaiModel: ai.openaiCompatible.model,
    oaiKey: ai.openaiCompatible.apiKey ? 'set' : 'unset',
    blBase: ai.bazaarlink.baseUrl,
    blModel: ai.bazaarlink.model,
    blFallbacks: ai.bazaarlink.fallbackModels,
    blKey: ai.bazaarlink.apiKey ? 'set' : 'unset',
    temperature: ai.temperature,
    topP: ai.topP,
    maxTokens: ai.maxTokens,
    timeoutMs: ai.timeoutMs,
    idleTimeoutMs: ai.idleTimeoutMs,
  });
}

/**
 * The active chat provider (cached until the configuration changes, which only
 * happens in tests).
 * @returns {OpenAiCompatibleChatClient}
 */
export function getChatProvider() {
  const nextSignature = signature();
  if (cachedProvider && nextSignature === cachedSignature) return cachedProvider;

  cachedProvider = createChatProvider();
  cachedSignature = nextSignature;
  return cachedProvider;
}

/** @returns {OpenAiCompatibleChatClient} */
export function createChatProvider() {
  const { ai } = config;

  if (ai.provider === 'bazaarlink') {
    // BazaarLink speaks the OpenAI Chat Completions API, so it is the OpenAI
    // client pointed at a different base URL (the same thing the official
    // `openai` SDK does with `baseURL`): POST {baseUrl}/chat/completions with
    // `Authorization: Bearer <BAZAARLINK_API_KEY>`.
    return new OpenAiCompatibleChatClient({
      id: 'bazaarlink',
      label: 'BazaarLink',
      baseUrl: ai.bazaarlink.baseUrl,
      apiKey: ai.bazaarlink.apiKey,
      models: [ai.bazaarlink.model, ...ai.bazaarlink.fallbackModels].filter(
        (model, index, all) => all.indexOf(model) === index,
      ),
      requiresKey: true,
      temperature: ai.temperature,
      topP: ai.topP,
      maxTokens: ai.maxTokens,
      timeoutMs: ai.timeoutMs,
      idleTimeoutMs: ai.idleTimeoutMs,
    });
  }

  if (ai.provider === 'openai-compatible') {
    return new OpenAiCompatibleChatClient({
      id: 'openai-compatible',
      label: 'OpenAI-compatible endpoint',
      baseUrl: ai.openaiCompatible.baseUrl,
      apiKey: ai.openaiCompatible.apiKey,
      models: [ai.openaiCompatible.model],
      requiresKey: false,
      temperature: ai.temperature,
      topP: ai.topP,
      maxTokens: ai.maxTokens,
      timeoutMs: ai.timeoutMs,
      idleTimeoutMs: ai.idleTimeoutMs,
    });
  }

  return new OpenAiCompatibleChatClient({
    id: 'huggingface',
    label: 'Hugging Face Inference Providers',
    baseUrl: ai.huggingface.baseUrl,
    apiKey: ai.huggingface.apiKey,
    models: ai.huggingface.models,
    providerPin: ai.huggingface.providerPin,
    temperature: ai.temperature,
    topP: ai.topP,
    maxTokens: ai.maxTokens,
    timeoutMs: ai.timeoutMs,
    idleTimeoutMs: ai.idleTimeoutMs,
  });
}

/** Test helper: forget the cached provider. */
export function resetChatProvider() {
  cachedProvider = null;
  cachedSignature = '';
}
