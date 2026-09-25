/**
 * Yaar API client — one function per backend endpoint.
 *
 * Components/hooks never build URLs themselves; everything goes through here so
 * a future API change is a single-file edit.
 */

import { apiRequest } from './httpClient.js';
import { regenerateStream, sendMessageStream } from './chatStream.js';

export const yaarApi = {
  /** Boot payload: identity, usage, companions, conversations, AI status. */
  getSession: (options) => apiRequest('/session', options),

  /** Optional display name shown in Settings. */
  updateProfile: (payload, options) =>
    apiRequest('/session', { method: 'PATCH', body: payload, ...options }),

  /** Deletes this anonymous user and all of their messages. */
  deleteAccount: (options) => apiRequest('/session', { method: 'DELETE', ...options }),

  getUsage: (options) => apiRequest('/usage', options),

  getCompanions: (options) => apiRequest('/companions', options),

  getMessages: (companionId, { limit = 200, before } = {}, options) => {
    const params = new URLSearchParams({ limit: String(limit) });
    if (before) params.set('before', String(before));
    return apiRequest(`/conversations/${companionId}/messages?${params}`, options);
  },

  clearMessages: (companionId, options) =>
    apiRequest(`/conversations/${companionId}/messages`, { method: 'DELETE', ...options }),

  /** Non-streaming send (used as a fallback and by tests). */
  sendMessage: (companionId, payload, options) =>
    apiRequest(`/chat/${companionId}/messages`, { method: 'POST', body: payload, ...options }),

  /** Streaming send (default path). */
  sendMessageStream,

  /** Ask for another reply when the AI produced nothing (no usage consumed). */
  regenerateStream,

  /** Dev-only helper; the server returns 404 in production. */
  resetUsage: (options) => apiRequest('/chat/dev/reset-usage', { method: 'POST', ...options }),

  health: (options) => apiRequest('/health', options),
};

export default yaarApi;
