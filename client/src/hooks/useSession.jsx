import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';

import { ERROR_CODES } from '@shared/errors';

import { ApiClientError } from '../api/httpClient.js';
import { yaarApi } from '../api/yaarApi.js';

/**
 * Session provider — the single source of truth for everything the app knows
 * about the current anonymous user: usage counter, companions, conversations
 * and AI status. Loaded with ONE request on boot (`GET /api/session`).
 */

const SessionContext = createContext(null);

/** @typedef {'loading'|'ready'|'error'} SessionStatus */

export function SessionProvider({ children }) {
  const [status, setStatus] = useState(/** @type {SessionStatus} */ ('loading'));
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const mounted = useRef(true);

  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const load = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setStatus('loading');
    try {
      const payload = await yaarApi.getSession();
      if (!mounted.current) return;
      setData(payload);
      setError(null);
      setStatus('ready');
    } catch (caught) {
      if (!mounted.current) return;
      const apiError =
        caught instanceof ApiClientError ? caught : new ApiClientError(ERROR_CODES.SERVER);
      setError(apiError);
      setStatus('error');
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  /** Updates just the usage slice (called after every accepted message). */
  const setUsage = useCallback((usage) => {
    if (!usage) return;
    setData((current) => (current ? { ...current, usage } : current));
  }, []);

  const updateProfile = useCallback(async (displayName) => {
    const payload = await yaarApi.updateProfile({ displayName });
    if (mounted.current) setData(payload);
    return payload;
  }, []);

  const deleteAccount = useCallback(async () => {
    await yaarApi.deleteAccount();
    if (mounted.current) {
      setData(null);
      setStatus('loading');
    }
  }, []);

  const value = useMemo(
    () => ({
      status,
      data,
      error,
      usage: data?.usage ?? null,
      companions: data?.companions ?? [],
      conversations: data?.conversations ?? [],
      ai: data?.ai ?? null,
      user: data?.user ?? null,
      app: data?.app ?? null,
      setUsage,
      reload: load,
      updateProfile,
      deleteAccount,
    }),
    [status, data, error, load, setUsage, updateProfile, deleteAccount],
  );

  return <SessionContext.Provider value={value}>{children}</SessionContext.Provider>;
}

export function useSession() {
  const context = useContext(SessionContext);
  if (!context) throw new Error('useSession must be used inside <SessionProvider>');
  return context;
}

/** Convenience: the companion metadata list, or an empty array while loading. */
export function useCompanions() {
  return useSession().companions;
}

/** Finds a companion by id from the boot payload. */
export function useCompanion(companionId) {
  const companions = useCompanions();
  return companions.find((companion) => companion.id === companionId) ?? null;
}
