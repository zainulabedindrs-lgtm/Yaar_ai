/**
 * Shared constants + error codes used by the API and the client.
 * Keeping them in one place means the UI never has to guess at strings.
 */

/** Machine-readable API error codes. */
export const ERROR_CODES = {
  VALIDATION: 'validation_error',
  EMPTY_MESSAGE: 'empty_message',
  MESSAGE_TOO_LONG: 'message_too_long',
  LIMIT_REACHED: 'daily_limit_reached',
  RATE_LIMITED: 'rate_limited',
  AI_UNAVAILABLE: 'ai_unavailable',
  AI_TIMEOUT: 'ai_timeout',
  AI_EMPTY: 'ai_empty_response',
  AI_NOT_CONFIGURED: 'ai_not_configured',
  NETWORK: 'network_error',
  SERVER: 'server_error',
  UNKNOWN_COMPANION: 'unknown_companion',
  UNKNOWN_CONVERSATION: 'unknown_conversation',
  NOT_FOUND: 'not_found',
  SESSION_EXPIRED: 'session_expired',
  CANCELLED: 'cancelled',
};

/**
 * Friendly, human copy for every error code. The client falls back to these so
 * users never see a stack trace or a raw provider message.
 */
export const ERROR_MESSAGES = {
  [ERROR_CODES.VALIDATION]: "Hmm, that didn't look right. Try sending it again?",
  [ERROR_CODES.EMPTY_MESSAGE]: 'Type something first 💛',
  [ERROR_CODES.MESSAGE_TOO_LONG]: 'That message is a bit too long — try splitting it up?',
  [ERROR_CODES.LIMIT_REACHED]:
    "That's all 20 messages for now 💛\nCome back after 24 hours and we'll continue our conversation.",
  [ERROR_CODES.RATE_LIMITED]: 'Slow down a little 😅 Try again in a few seconds.',
  [ERROR_CODES.AI_UNAVAILABLE]:
    "I couldn't reply just now — something on my side hiccuped. Try again in a moment?",
  [ERROR_CODES.AI_TIMEOUT]: 'That took too long on my side. Send it again and I will answer properly?',
  [ERROR_CODES.AI_EMPTY]: "I lost my words for a second there. Can you send that again?",
  [ERROR_CODES.AI_NOT_CONFIGURED]:
    'Yaar is not connected to an AI yet. Add your Hugging Face token to the server .env file.',
  [ERROR_CODES.NETWORK]: "You look offline. Check your connection and try again?",
  [ERROR_CODES.SERVER]: 'Something went wrong on my side. Please try again in a moment.',
  [ERROR_CODES.UNKNOWN_COMPANION]: 'That companion does not exist. Pick one from the home screen.',
  [ERROR_CODES.UNKNOWN_CONVERSATION]: 'I could not find that conversation. Starting a fresh one.',
  [ERROR_CODES.NOT_FOUND]: 'Not found.',
  [ERROR_CODES.SESSION_EXPIRED]: 'Your session expired. Reconnecting…',
  [ERROR_CODES.CANCELLED]: 'Stopped.',
};

/** Maximum length of a single user message. */
export const MAX_MESSAGE_LENGTH = 2000;

/** Where the last opened companion is remembered on the device. */
export const LAST_COMPANION_STORAGE_KEY = 'yaar.lastCompanion';
export const DEVICE_ID_STORAGE_KEY = 'yaar.deviceId';
export const DEVICE_ID_HEADER = 'x-yaar-device-id';

/** @param {string} code */
export function friendlyMessageFor(code) {
  return ERROR_MESSAGES[code] || ERROR_MESSAGES[ERROR_CODES.SERVER];
}
