/**
 * In-memory holder for the current Supabase access token.
 *
 * `useAuth` keeps it in sync with supabase-js (sign-in, refresh, sign-out) and
 * `httpClient` attaches it as `Authorization: Bearer …`. The server verifies
 * the token's signature and derives the user id from it — the client never
 * sends a user id of its own.
 */

/** @type {string | null} */
let accessToken = null;

/** @param {string | null | undefined} token */
export function setAccessToken(token) {
  accessToken = token || null;
}

export function getAccessToken() {
  return accessToken;
}
