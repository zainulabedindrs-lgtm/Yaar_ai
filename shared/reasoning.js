/**
 * Reasoning-block markers.
 *
 * Some chat models (Qwen3 in thinking mode, DeepSeek-R1, and others) prepend a
 * private reasoning section to their answer. Yaar must never show that to a
 * user, and it must never show a half-parsed tag while streaming either, so the
 * server filters it out token by token (see `ReasoningFilter`).
 *
 * These constants are assembled from character codes instead of being written
 * as literals: the two markers are exactly the strings that some toolchains,
 * editors and log pipelines strip out of text, which would silently break the
 * filter. Building them at runtime keeps the behaviour identical everywhere.
 */

const LT = String.fromCharCode(60); // <
const GT = String.fromCharCode(62); // >

/** Opening marker, e.g. "<" + "think" + ">" */
export const REASONING_OPEN = `${LT}think${GT}`;

/** Closing marker, e.g. "<" + "/think" + ">" */
export const REASONING_CLOSE = `${LT}/think${GT}`;

/** True when `text` starts with the opening marker (after optional spaces). */
export function startsWithReasoningOpen(text) {
  return text.trimStart().startsWith(REASONING_OPEN);
}
