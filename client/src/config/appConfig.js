/**
 * Client configuration.
 *
 * Only `VITE_*` variables are visible in the browser bundle — never put a
 * secret here. The Hugging Face key lives in the server environment.
 */

const env = import.meta.env ?? {};

/** Optional absolute API origin (needed for the Capacitor/Android build). */
export const API_BASE_URL = (env.VITE_API_BASE_URL ?? '').replace(/\/+$/, '');

export const APP_NAME = env.VITE_APP_NAME ?? 'Yaar';
export const APP_VERSION = env.VITE_APP_VERSION ?? '1.0.0';

/** Client-side timeout for ordinary JSON calls (ms). */
export const REQUEST_TIMEOUT_MS = 20_000;

/** The AI call itself may legitimately take a while (streaming). */
export const CHAT_TIMEOUT_MS = 90_000;

export const DEFAULT_COMPANION_ID = env.VITE_DEFAULT_COMPANION ?? 'girlfriend';

/** Routes used by the router (kept in one place for easy extension). */
export const ROUTES = {
  home: '/',
  chat: (companionId) => `/chat/${companionId}`,
  settings: '/settings',
  about: '/about',
  privacy: '/privacy',
  terms: '/terms',
};
