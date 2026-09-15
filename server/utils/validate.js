/**
 * Input validation + sanitisation.
 *
 * Shared by the routes (zod schemas) and by the session middleware (cookie and
 * device-id checks). User text is only ever stored as plain text and rendered
 * as text by React, so the main job here is length limits, control-character
 * stripping and normalisation.
 */

import { MAX_MESSAGE_LENGTH } from '../../shared/errors.js';

/** Device ids are opaque client-generated tokens. */
const DEVICE_ID_PATTERN = /^[A-Za-z0-9_-]{8,128}$/;

/** @param {unknown} value */
export function isValidDeviceId(value) {
  return typeof value === 'string' && DEVICE_ID_PATTERN.test(value);
}

/** Companion ids are known values; this guards the route params. */
export function isValidCompanionId(value) {
  return value === 'girlfriend' || value === 'boyfriend';
}

/**
 * Cleans a user message:
 *  - Unicode NFC normalisation (so Urdu/Hindi text is consistent)
 *  - control characters removed (except newlines/tabs)
 *  - CRLF unified, 3+ blank lines collapsed to one
 *  - trimmed
 * @param {unknown} raw
 * @returns {string}
 */
export function sanitiseMessage(raw) {
  if (typeof raw !== 'string') return '';
  return raw
    .normalize('NFC')
    .replace(/\r\n?/g, '\n')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * @param {unknown} raw
 * @returns {{ ok: true, value: string } | { ok: false, code: 'empty'|'too_long' }}
 */
export function validateMessage(raw) {
  const value = sanitiseMessage(raw);
  if (!value) return { ok: false, code: 'empty' };
  if (value.length > MAX_MESSAGE_LENGTH) return { ok: false, code: 'too_long' };
  return { ok: true, value };
}

/**
 * Optional display name for the settings screen.
 * @param {unknown} raw
 * @returns {string|null}
 */
export function sanitiseDisplayName(raw) {
  if (typeof raw !== 'string') return null;
  const clean = raw.normalize('NFC').replace(/[\u0000-\u001F\u007F]/g, '').trim().slice(0, 40);
  return clean || null;
}
