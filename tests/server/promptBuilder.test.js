/**
 * Prompt assembly + language detection.
 *
 * The language rules in the brief ("reply in whatever language the user writes")
 * are implemented as a short instruction line inside the system prompt. These
 * tests pin that behaviour down so a future edit cannot quietly break it.
 */

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { useTestEnv } from './helpers.js';

useTestEnv({ LOG_LEVEL: 'silent' });

const { buildChatPrompt } = await import('../../server/services/ai/promptBuilder.js');
const { detectLanguage, trimHistory, languageInstruction } = await import(
  '../../server/utils/languageDetect.js'
);
const { COMPANIONS } = await import('../../shared/companions.js');

describe('language detection', () => {
  test('detects Urdu script', () => {
    assert.equal(detectLanguage('آج میرا دن بہت لمبا تھا'), 'urdu');
  });

  test('detects Hindi (Devanagari)', () => {
    assert.equal(detectLanguage('आज मेरा दिन बहुत लंबा था'), 'hindi');
  });

  test('detects Roman Urdu/Hindi written in Latin letters', () => {
    assert.equal(detectLanguage('aaj bohat lamba din tha yaar'), 'roman-urdu-hindi');
    assert.equal(detectLanguage('kya kar rahe ho'), 'roman-urdu-hindi');
  });

  test('detects plain English', () => {
    assert.equal(detectLanguage('I had a really long day at work today'), 'english');
  });

  test('detects mixed script messages', () => {
    assert.equal(detectLanguage('aaj mera din bura tha آج'), 'mixed');
  });

  test('handles empty input', () => {
    assert.equal(detectLanguage(''), 'unknown');
    assert.equal(detectLanguage('   '), 'unknown');
  });

  test('every language gets its own instruction line', () => {
    assert.match(languageInstruction('urdu'), /Urdu/);
    assert.match(languageInstruction('hindi'), /Devanagari|Hindi/);
    assert.match(languageInstruction('roman-urdu-hindi'), /Roman Urdu/);
    assert.match(languageInstruction('english'), /English/);
    assert.match(languageInstruction('mixed'), /mix/i);
    assert.match(languageInstruction('unknown'), /same language/i);
  });
});

describe('trimHistory', () => {
  test('keeps the newest messages and stays inside the budget', () => {
    const history = Array.from({ length: 80 }, (_, index) => ({
      sender: index % 2 === 0 ? 'user' : 'assistant',
      content: `message number ${index}`,
    }));

    const trimmed = trimHistory(history);
    assert.ok(trimmed.length <= 24);
    assert.match(trimmed.at(-1).content, /79$/);
  });

  test('truncates a single enormous message', () => {
    const trimmed = trimHistory([{ sender: 'user', content: 'x'.repeat(5000) }]);
    assert.equal(trimmed[0].content.length, 1200);
  });
});

describe('buildChatPrompt', () => {
  test('starts with the companion persona and a language instruction', () => {
    const prompt = buildChatPrompt({
      companionId: 'girlfriend',
      history: [{ sender: 'user', content: 'kya kar rahe ho?' }],
    });

    assert.equal(prompt[0].role, 'system');
    assert.match(prompt[0].content, /Ayesha/);
    assert.match(prompt[0].content, /Roman Urdu/);
    assert.equal(prompt.at(-1).role, 'user');
    assert.equal(prompt.at(-1).content, 'kya kar rahe ho?');
  });

  test('the boyfriend persona is a different voice', () => {
    const girlfriend = buildChatPrompt({
      companionId: 'girlfriend',
      history: [{ sender: 'user', content: 'hi' }],
    })[0].content;
    const boyfriend = buildChatPrompt({
      companionId: 'boyfriend',
      history: [{ sender: 'user', content: 'hi' }],
    })[0].content;

    assert.match(boyfriend, /Hamza/);
    assert.notEqual(girlfriend, boyfriend);
  });

  test('tells the model never to reveal reasoning', () => {
    const prompt = buildChatPrompt({
      companionId: 'girlfriend',
      history: [{ sender: 'user', content: 'hi' }],
    });
    assert.match(prompt[0].content, /Never output your reasoning/i);
  });

  test('collapses consecutive same-role messages (some providers reject them)', () => {
    const prompt = buildChatPrompt({
      companionId: 'girlfriend',
      history: [
        { sender: 'user', content: 'first' },
        { sender: 'user', content: 'second' },
        { sender: 'assistant', content: 'reply' },
      ],
    });

    const roles = prompt.map((message) => message.role);
    for (let index = 1; index < roles.length; index += 1) {
      assert.notEqual(roles[index], roles[index - 1], 'no two consecutive messages share a role');
    }
  });

  test('unknown companions throw instead of silently using a default persona', () => {
    assert.throws(() => buildChatPrompt({ companionId: 'nobody', history: [] }), /Unknown companion/);
  });

  test('every companion defines the required metadata', () => {
    for (const [id, companion] of Object.entries(COMPANIONS)) {
      assert.equal(companion.id, id);
      assert.ok(companion.displayName);
      assert.ok(companion.label);
      assert.ok(companion.greeting);
      assert.ok(companion.avatar);
      assert.ok(companion.persona.length > 500, 'persona should be a real prompt');
      assert.match(companion.persona, /Never pretend to be a human/i);
    }
  });
});
