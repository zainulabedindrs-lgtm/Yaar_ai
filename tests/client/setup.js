/**
 * Vitest setup for the client suite (jsdom).
 */

import '@testing-library/jest-dom/vitest';

// jsdom does not implement matchMedia, which the composer uses to detect a
// touch device. Default to a desktop pointer; individual tests override it.
if (!window.matchMedia) {
  window.matchMedia = (query) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => false,
  });
}

// jsdom has no ResizeObserver either.
if (!globalThis.ResizeObserver) {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  };
}

// scrollTo is not implemented in jsdom.
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function scrollTo(options) {
    if (typeof options === 'object' && options && typeof options.top === 'number') {
      this.scrollTop = options.top;
    }
  };
}
