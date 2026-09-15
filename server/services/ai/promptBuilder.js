/**
 * Turns stored messages into the chat-completion payload sent to the provider.
 *
 * Keeping this in one place means persona changes, language behaviour and
 * history budgeting are all reviewable in a single small file.
 */

import { COMPANIONS } from '../../../shared/companions.js';
import { detectLanguage, languageInstruction, trimHistory } from '../../utils/languageDetect.js';

/**
 * @param {Object} params
 * @param {string} params.companionId
 * @param {{ sender: 'user'|'assistant'|'system', content: string }[]} params.history
 *        Oldest → newest, including the just-saved user message.
 * @param {Date} [params.now]
 * @returns {{ role: 'system'|'user'|'assistant', content: string }[]}
 */
export function buildChatPrompt({ companionId, history, now = new Date() }) {
  const companion = COMPANIONS[companionId];
  if (!companion) throw new Error(`Unknown companion: ${companionId}`);

  const latestUserMessage =
    [...history].reverse().find((message) => message.sender === 'user')?.content ?? '';

  const trimmed = trimHistory(history);

  const systemPrompt = [
    companion.persona,
    '',
    '# RIGHT NOW',
    languageInstruction(detectLanguage(latestUserMessage)),
    `Current local time: ${now.toISOString()}. Keep replies short so they read like real text messages.`,
    'Never output your reasoning or thinking process — only the message itself.',
  ].join('\n');

  /** @type {{ role: 'system'|'user'|'assistant', content: string }[]} */
  const messages = [{ role: 'system', content: systemPrompt }];

  for (const message of trimmed) {
    const role = message.sender === 'assistant' ? 'assistant' : 'user';
    const content = message.content.trim();
    if (!content) continue;
    // Collapse consecutive same-role turns: some providers reject them.
    const previous = messages[messages.length - 1];
    if (previous && previous.role === role) {
      previous.content += `\n${content}`;
    } else {
      messages.push({ role, content });
    }
  }

  return messages;
}
