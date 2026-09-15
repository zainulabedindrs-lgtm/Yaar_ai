/**
 * Stable anonymous device id.
 *
 * The id is generated once per device/browser and sent with every API request
 * as `x-yaar-device-id`. The server hashes it into the user id, which is what
 * makes the 20-message daily limit survive page refreshes, reloads and clearing
 * cookies (a plain cookie would not survive inside WebViews / third-party
 * iframes). Clearing site data is the only way to get a "new" identity — the
 * same as any anonymous app before real authentication.
 */

import { DEVICE_ID_STORAGE_KEY } from '@shared/errors';

import { readStorage, writeStorage } from './storage.js';

let cached = null;

/** @returns {string} */
export function getDeviceId() {
  if (cached) return cached;

  const existing = readStorage(DEVICE_ID_STORAGE_KEY, '');
  if (isValid(existing)) {
    cached = existing;
    return cached;
  }

  const generated = generateDeviceId();
  writeStorage(DEVICE_ID_STORAGE_KEY, generated);
  cached = generated;
  return cached;
}

/** Test helper. */
export function resetDeviceIdCache() {
  cached = null;
}

function isValid(value) {
  return typeof value === 'string' && /^[A-Za-z0-9_-]{8,128}$/.test(value);
}

function generateDeviceId() {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj?.randomUUID) {
    return cryptoObj.randomUUID().replace(/-/g, '');
  }
  if (cryptoObj?.getRandomValues) {
    const bytes = cryptoObj.getRandomValues(new Uint8Array(16));
    return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  }
  // Last resort (very old browsers): time + random. Still unique enough.
  return `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 12)}`;
}
