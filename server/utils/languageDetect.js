/**
 * Lightweight, dependency-free language/script detection.
 *
 * We never ask the user to pick a language. Instead we look at the message they
 * just sent and tell the model, in one short line, which language/script to
 * answer in. This makes the "reply in the user's language" rule reliable even
 * with smaller multilingual models.
 */

const ARABIC_SCRIPT = /[\u0600-\u06FF\u0750-\u077F\uFB50-\uFDFF\uFE70-\uFEFF]/;
const DEVANAGARI_SCRIPT = /[\u0900-\u097F\uA8E0-\uA8FF]/;
const LATIN_SCRIPT = /[A-Za-z]/;

/**
 * Words that strongly suggest Roman Urdu / Roman Hindi when written in Latin
 * letters. Overlap between the two is huge, which is fine: the instruction we
 * send is the same for both.
 */
const ROMAN_HINDI_URDU_WORDS = new Set([
  'acha', 'achha', 'ap', 'aap', 'abhi', 'aaj', 'aur', 'bas', 'bahut', 'bohat', 'bohot', 'bhai',
  'behen', 'bhi', 'chalo', 'chal', 'dil', 'dost', 'ghar', 'haan', 'han', 'hai', 'hain', 'ho',
  'hoon', 'hun', 'hu', 'kaam', 'kaise', 'kaisa', 'kaisi', 'kar', 'karo', 'kar', 'kya', 'kyun',
  'kyunke', 'kuch', 'kal', 'khana', 'khush', 'lag', 'lagta', 'matlab', 'mera', 'meri', 'mujhe',
  'nahi', 'nahin', 'na', 'phir', 'pyar', 'pyaar', 'raha', 'rahi', 'sab', 'sona', 'theek', 'thik',
  'tum', 'tumhe', 'tumhara', 'tumhari', 'tumhare', 'udaas', 'yaar', 'yar', 'zindagi', 'ji', 'ne',
  'se', 'ko', 'me', 'mein', 'par', 'tha', 'thi', 'the', 'gaya', 'gayi', 'rahe', 'raha', 'batao',
  'bata', 'sunao', 'suna', 'kabhi', 'ab', 'wala', 'wali', 'ka', 'ki', 'ke', 'achhi', 'acha',
]);

/**
 * @typedef {'urdu'|'hindi'|'roman-urdu-hindi'|'english'|'mixed'|'unknown'} LanguageHint
 */

/**
 * @param {string} text
 * @returns {LanguageHint}
 */
export function detectLanguage(text) {
  if (!text || !text.trim()) return 'unknown';

  const hasArabic = ARABIC_SCRIPT.test(text);
  const hasDevanagari = DEVANAGARI_SCRIPT.test(text);
  const hasLatin = LATIN_SCRIPT.test(text);

  if (hasArabic && hasLatin) return 'mixed';
  if (hasDevanagari && hasLatin) return 'mixed';
  if (hasArabic) return 'urdu';
  if (hasDevanagari) return 'hindi';
  if (hasLatin) return looksRomanUrduHindi(text) ? 'roman-urdu-hindi' : 'english';
  return 'unknown';
}

/** @param {string} text */
function looksRomanUrduHindi(text) {
  const words = text
    .toLowerCase()
    .replace(/[^a-z\s]/g, ' ')
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return false;
  const hits = words.filter((word) => ROMAN_HINDI_URDU_WORDS.has(word)).length;
  // One strong marker is enough in short messages, otherwise require ~20%.
  return hits >= 1 && (words.length <= 4 || hits / words.length >= 0.2);
}

/**
 * One short instruction line appended to the system prompt.
 * @param {LanguageHint} hint
 * @returns {string}
 */
export function languageInstruction(hint) {
  switch (hint) {
    case 'urdu':
      return "The user's newest message is in Urdu script. Reply in Urdu (اردو script), in the same casual tone.";
    case 'hindi':
      return "The user's newest message is in Hindi (Devanagari). Reply in Hindi (देवनागरी), same casual tone.";
    case 'roman-urdu-hindi':
      return "The user's newest message is Roman Urdu/Roman Hindi (Latin letters, e.g. 'kya kar rahe ho'). Reply in that same Roman Urdu/Roman Hindi style — not in Urdu/Hindi script and not in formal English.";
    case 'english':
      return "The user's newest message is in English. Reply in English, casually.";
    case 'mixed':
      return 'The user mixes English with Urdu/Hindi in the same message. Mirror that mix naturally, the same way they write.';
    default:
      return 'Reply in the same language and script the user just used.';
  }
}

/** How many messages of history to send, and how much text per message. */
export const HISTORY_WINDOW_MESSAGES = 24;
export const HISTORY_MAX_CHARS_PER_MESSAGE = 1_200;
export const HISTORY_MAX_TOTAL_CHARS = 9_000;

/**
 * Trims conversation history to fit comfortably in a small model's context.
 * @param {{ sender: string, content: string }[]} messages oldest → newest
 */
export function trimHistory(messages) {
  const window = messages.slice(-HISTORY_WINDOW_MESSAGES);
  let total = 0;
  /** @type {{ sender: string, content: string }[]} */
  const kept = [];

  for (let index = window.length - 1; index >= 0; index -= 1) {
    const message = window[index];
    const content = message.content.slice(0, HISTORY_MAX_CHARS_PER_MESSAGE);
    if (total + content.length > HISTORY_MAX_TOTAL_CHARS && kept.length > 0) break;
    total += content.length;
    kept.unshift({ sender: message.sender, content });
  }

  return kept;
}
