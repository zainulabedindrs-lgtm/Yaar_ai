/**
 * Safe localStorage wrappers.
 *
 * Safari private mode, disabled storage and sandboxed iframes all throw on
 * `localStorage`, and a chat app must never crash over a cache miss.
 */

/** @type {Storage | null} */
let memoryFallback = null;

function backingStore() {
  try {
    if (typeof window === 'undefined' || !window.localStorage) throw new Error('no storage');
    const probeKey = '__yaar_probe__';
    window.localStorage.setItem(probeKey, '1');
    window.localStorage.removeItem(probeKey);
    return window.localStorage;
  } catch {
    if (!memoryFallback) {
      /** @type {Record<string,string>} */
      const data = {};
      memoryFallback = {
        get length() {
          return Object.keys(data).length;
        },
        clear: () => Object.keys(data).forEach((key) => delete data[key]),
        getItem: (key) => (key in data ? data[key] : null),
        key: (index) => Object.keys(data)[index] ?? null,
        removeItem: (key) => {
          delete data[key];
        },
        setItem: (key, value) => {
          data[key] = String(value);
        },
      };
    }
    return memoryFallback;
  }
}

/** @param {string} key @param {string} [fallback] */
export function readStorage(key, fallback = '') {
  try {
    const value = backingStore().getItem(key);
    return value === null ? fallback : value;
  } catch {
    return fallback;
  }
}

/** @param {string} key @param {string} value */
export function writeStorage(key, value) {
  try {
    backingStore().setItem(key, value);
    return true;
  } catch {
    return false;
  }
}

/** @param {string} key */
export function removeStorage(key) {
  try {
    backingStore().removeItem(key);
  } catch {
    /* ignore */
  }
}
