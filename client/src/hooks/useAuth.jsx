import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';

import { setAccessToken } from '../api/authToken.js';
import { getSupabase, isSupabaseConfigured } from '../lib/supabaseClient.js';

/**
 * Supabase email/password authentication.
 *
 *   const { enabled, status, user, signIn, signUp, signOut } = useAuth();
 *
 * `status` is 'loading' until the stored session (if any) has been restored,
 * then 'ready'. Whenever the session changes (sign-in, token refresh,
 * sign-out) the access token used by the API client is updated.
 *
 * When the build has no Supabase config, `enabled` is false and the app runs
 * anonymously exactly as before.
 */

const AuthContext = createContext(null);

/** @typedef {{ id: string, email: string | null }} AuthUser */

export function AuthProvider({ children }) {
  const [status, setStatus] = useState(isSupabaseConfigured ? 'loading' : 'ready');
  /** @type {[AuthUser | null, Function]} */
  const [user, setUser] = useState(null);

  useEffect(() => {
    if (!isSupabaseConfigured) return undefined;
    let active = true;
    let subscription = null;

    const apply = (session) => {
      setAccessToken(session?.access_token ?? null);
      const next = session?.user ? { id: session.user.id, email: session.user.email ?? null } : null;
      // Keep the same object while the account is unchanged so token refreshes
      // do not re-trigger a session reload.
      setUser((current) => (current?.id === next?.id ? current : next));
    };

    getSupabase()
      .then(async (supabase) => {
        if (!active || !supabase) return;
        const { data } = await supabase.auth.getSession();
        if (!active) return;
        apply(data.session);
        setStatus('ready');
        subscription = supabase.auth.onAuthStateChange((_event, session) => apply(session)).data
          .subscription;
      })
      .catch(() => {
        if (active) setStatus('ready');
      });

    return () => {
      active = false;
      subscription?.unsubscribe();
    };
  }, []);

  const signIn = useCallback(async (email, password) => {
    const supabase = await getSupabase();
    if (!supabase) throw new Error('Sign-in is not enabled.');
    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) throw new Error(friendlyAuthError(error));
  }, []);

  /** @returns {Promise<{ needsConfirmation: boolean }>} */
  const signUp = useCallback(async (email, password) => {
    const supabase = await getSupabase();
    if (!supabase) throw new Error('Sign-up is not enabled.');
    const { data, error } = await supabase.auth.signUp({
      email,
      password,
      options: { emailRedirectTo: window.location.origin },
    });
    if (error) throw new Error(friendlyAuthError(error));
    return { needsConfirmation: !data.session };
  }, []);

  const signOut = useCallback(async () => {
    const supabase = await getSupabase();
    setAccessToken(null);
    setUser(null);
    await supabase?.auth.signOut().catch(() => {});
  }, []);

  const value = useMemo(
    () => ({ enabled: isSupabaseConfigured, status, user, signIn, signUp, signOut }),
    [status, user, signIn, signUp, signOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Works outside the provider too (returns the "auth disabled" shape). */
export function useAuth() {
  return (
    useContext(AuthContext) ?? {
      enabled: false,
      status: 'ready',
      user: null,
      signIn: async () => {},
      signUp: async () => ({ needsConfirmation: false }),
      signOut: async () => {},
    }
  );
}

/** Maps Supabase error messages onto short, friendly copy. */
export function friendlyAuthError(error) {
  const message = String(error?.message ?? '').toLowerCase();
  if (message.includes('invalid login')) return 'That email and password do not match.';
  if (message.includes('email not confirmed')) return 'Please confirm your email first — check your inbox.';
  if (message.includes('already registered')) return 'An account with this email already exists. Try logging in.';
  if (message.includes('password')) return error.message;
  if (message.includes('rate limit')) return 'Too many attempts. Please wait a minute and try again.';
  return error?.message || 'Something went wrong. Please try again.';
}
