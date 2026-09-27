/**
 * Browser Supabase client (Auth only).
 *
 * Built from PUBLIC values only: VITE_SUPABASE_URL + VITE_SUPABASE_PUBLISHABLE_KEY
 * (the legacy name VITE_SUPABASE_ANON_KEY is accepted too). The secret /
 * service-role key must NEVER be given a VITE_ name — it would ship to browsers.
 *
 * supabase-js is loaded lazily so anonymous-only deployments never download it.
 */

const env = import.meta.env ?? {};

export const SUPABASE_URL = (env.VITE_SUPABASE_URL ?? '').replace(/\/+$/, '');
export const SUPABASE_PUBLISHABLE_KEY =
  env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_ANON_KEY ?? '';

/** True when the build was given a Supabase project. */
export const isSupabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY);

/** @type {Promise<import('@supabase/supabase-js').SupabaseClient> | null} */
let clientPromise = null;

/** @returns {Promise<import('@supabase/supabase-js').SupabaseClient | null>} */
export function getSupabase() {
  if (!isSupabaseConfigured) return Promise.resolve(null);
  if (!clientPromise) {
    clientPromise = import('@supabase/supabase-js').then(({ createClient }) =>
      createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
        auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true },
      }),
    );
  }
  return clientPromise;
}
