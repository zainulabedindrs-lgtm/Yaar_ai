/**
 * Supabase Auth in the client: sign-in page, token forwarding and the
 * AUTH_REQUIRED redirect. supabase-js is mocked — no network.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const authMock = {
  listeners: [],
  session: null,
  getSession: vi.fn(async () => ({ data: { session: authMock.session } })),
  onAuthStateChange: vi.fn((callback) => {
    authMock.listeners.push(callback);
    return { data: { subscription: { unsubscribe: vi.fn() } } };
  }),
  signInWithPassword: vi.fn(async ({ email }) => {
    const session = { access_token: 'jwt-for-' + email, user: { id: 'user-1', email } };
    authMock.session = session;
    authMock.listeners.forEach((listener) => listener('SIGNED_IN', session));
    return { data: { session }, error: null };
  }),
  signUp: vi.fn(async () => ({ data: { session: null, user: { id: 'user-2' } }, error: null })),
  signOut: vi.fn(async () => {
    authMock.session = null;
    authMock.listeners.forEach((listener) => listener('SIGNED_OUT', null));
    return { error: null };
  }),
};

vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({ auth: authMock })),
}));

const SESSION = {
  user: { ref: 'abc123def456', displayName: null, createdAt: Date.now(), isAnonymous: false },
  usage: { limit: 20, used: 0, remaining: 20, windowHours: 24, resetAt: Date.now() + 1e7, msUntilReset: 1e7, exhausted: false },
  companions: [],
  conversations: [],
  ai: { provider: 'bazaarlink', label: 'BazaarLink', model: 'deepseek-v4-flash', configured: true },
  app: { name: 'Yaar', version: '1.0.0', dailyMessageLimit: 20, usageWindowHours: 24 },
};

function json(body, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );
}

/** Fake server: /api/session needs a bearer token (AUTH_REQUIRED=true). */
function installFetch() {
  const calls = [];
  const fetchMock = vi.fn((url, init = {}) => {
    calls.push({ url: String(url), headers: init.headers ?? {} });
    if (String(url).endsWith('/api/session')) {
      if (!init.headers?.authorization) {
        return json({ error: { code: 'unauthorized', message: 'Please sign in to continue.' } }, 401);
      }
      return json(SESSION);
    }
    return json({ error: { code: 'not_found' } }, 404);
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

async function renderApp(path) {
  const { default: App } = await import('../../client/src/App.jsx');
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  vi.resetModules();
  vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
  vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'sb_publishable_test');
  authMock.listeners = [];
  authMock.session = null;
  window.localStorage.clear();
});

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe('auth', () => {
  it('redirects to the sign-in page when the server requires a login', async () => {
    installFetch();
    await renderApp('/settings');
    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
    // Login is mandatory → no "continue without an account" escape hatch.
    expect(screen.queryByText(/continue without an account/i)).not.toBeInTheDocument();
  });

  it('logs in with email + password and sends the token as a Bearer header', async () => {
    const calls = installFetch();
    const user = userEvent.setup();
    await renderApp('/auth');

    await user.type(await screen.findByLabelText(/email/i), 'zain@example.com');
    await user.type(screen.getByLabelText(/password/i), 'secret123');
    await user.click(screen.getByRole('button', { name: /^log in$/i }));

    expect(authMock.signInWithPassword).toHaveBeenCalledWith({
      email: 'zain@example.com',
      password: 'secret123',
    });

    await waitFor(() => {
      const authed = calls.filter(
        (call) => call.url.endsWith('/api/session') && call.headers.authorization,
      );
      expect(authed.length).toBeGreaterThan(0);
      expect(authed.at(-1).headers.authorization).toBe('Bearer jwt-for-zain@example.com');
    });
    // No user id is ever sent by the client — only the token.
    for (const call of calls) {
      expect(JSON.stringify(call.headers)).not.toMatch(/user-?id/i);
    }
  });

  it('validates the form before calling Supabase', async () => {
    installFetch();
    const user = userEvent.setup();
    await renderApp('/auth');
    await user.type(await screen.findByLabelText(/email/i), 'not-an-email');
    await user.type(screen.getByLabelText(/password/i), 'secret123');
    await user.click(screen.getByRole('button', { name: /^log in$/i }));
    expect(await screen.findByRole('alert')).toHaveTextContent(/valid email/i);
    expect(authMock.signInWithPassword).not.toHaveBeenCalled();
  });

  it('sign-up asks the user to confirm their email when Supabase requires it', async () => {
    installFetch();
    const user = userEvent.setup();
    await renderApp('/auth');
    await user.click(await screen.findByRole('tab', { name: /sign up/i }));
    await user.type(screen.getByLabelText(/email/i), 'new@example.com');
    await user.type(screen.getByLabelText(/password/i), 'secret123');
    await user.click(screen.getByRole('button', { name: /create account/i }));
    expect(authMock.signUp).toHaveBeenCalled();
    expect(await screen.findByRole('status')).toHaveTextContent(/check your email/i);
  });

  it('shows the account and logs out', async () => {
    authMock.session = { access_token: 'jwt-existing', user: { id: 'user-1', email: 'me@example.com' } };
    installFetch();
    const user = userEvent.setup();
    await renderApp('/auth');
    expect(await screen.findByText('me@example.com')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: /log out/i }));
    expect(authMock.signOut).toHaveBeenCalled();
    expect(await screen.findByRole('heading', { name: /welcome back/i })).toBeInTheDocument();
  });
});
