import { useState } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router-dom';

import Brand from '../components/Brand.jsx';
import { LoadingState } from '../components/States.jsx';
import { ROUTES } from '../config/appConfig.js';
import { useAuth } from '../hooks/useAuth.jsx';
import { useSession } from '../hooks/useSession.jsx';

const MIN_PASSWORD = 6;

/**
 * Sign up / log in / log out with Supabase email + password.
 *
 * After signing in the user is sent back to where they came from
 * (`location.state.from`) or home.
 */
export function AuthPage() {
  const auth = useAuth();
  const session = useSession();
  const navigate = useNavigate();
  const location = useLocation();
  const from = location.state?.from || ROUTES.home;

  const [mode, setMode] = useState(/** @type {'login'|'signup'} */ ('login'));
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  if (!auth.enabled) {
    return (
      <div className="container">
        <div className="page fade-rise">
          <div className="page__header">
            <h1 className="page__title">Accounts</h1>
            <p className="page__lead">
              Accounts are not enabled on this server — you can keep chatting without one.
            </p>
          </div>
          <Link className="button button--primary" to={ROUTES.home}>
            Back to Yaar
          </Link>
        </div>
      </div>
    );
  }

  if (auth.status === 'loading') {
    return (
      <div className="container">
        <LoadingState label="Checking your account…" />
      </div>
    );
  }

  if (auth.user) {
    // Just signed in from this page → continue to where the user was going.
    if (busy) return <Navigate to={from} replace />;
    return (
      <div className="container">
        <div className="page fade-rise auth">
          <div className="page__header">
            <h1 className="page__title">Your account</h1>
            <p className="page__lead">
              Signed in as <strong>{auth.user.email}</strong>
            </p>
          </div>
          <div className="auth__actions">
            <Link className="button button--primary button--block" to={ROUTES.home}>
              Continue chatting
            </Link>
            <button
              type="button"
              className="button button--ghost button--block"
              onClick={async () => {
                await auth.signOut();
                navigate(ROUTES.auth, { replace: true });
              }}
            >
              Log out
            </button>
          </div>
        </div>
      </div>
    );
  }

  const isSignup = mode === 'signup';
  const canSkip = session.status !== 'unauthenticated';

  const handleSubmit = async (event) => {
    event.preventDefault();
    setError('');
    setNotice('');
    const cleanEmail = email.trim();
    if (!/^\S+@\S+\.\S+$/.test(cleanEmail)) {
      setError('Please enter a valid email address.');
      return;
    }
    if (password.length < MIN_PASSWORD) {
      setError(`Your password needs at least ${MIN_PASSWORD} characters.`);
      return;
    }

    setBusy(true);
    try {
      if (isSignup) {
        const { needsConfirmation } = await auth.signUp(cleanEmail, password);
        if (needsConfirmation) {
          setBusy(false);
          setMode('login');
          setPassword('');
          setNotice('Almost there! Check your email and tap the confirmation link, then log in.');
        }
      } else {
        await auth.signIn(cleanEmail, password);
      }
    } catch (caught) {
      setError(caught?.message || 'Something went wrong. Please try again.');
      setBusy(false);
    }
  };

  return (
    <div className="container">
      <div className="page fade-rise auth">
        <div className="auth__brand">
          <Brand />
        </div>
        <div className="page__header">
          <h1 className="page__title">{isSignup ? 'Create your account' : 'Welcome back'}</h1>
          <p className="page__lead">
            {isSignup
              ? 'Keep your chats safe and pick up on any device.'
              : 'Log in to continue your conversations.'}
          </p>
        </div>

        <div className="auth__tabs" role="tablist" aria-label="Account">
          {[
            ['login', 'Log in'],
            ['signup', 'Sign up'],
          ].map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={mode === id}
              className={`button button--sm ${mode === id ? 'button--primary' : 'button--ghost'}`}
              onClick={() => {
                setMode(/** @type {'login'|'signup'} */ (id));
                setError('');
              }}
            >
              {label}
            </button>
          ))}
        </div>

        <form className="card auth__form" onSubmit={handleSubmit} noValidate>
          <label className="auth__field">
            <span>Email</span>
            <input
              type="email"
              autoComplete="email"
              inputMode="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              required
            />
          </label>
          <label className="auth__field">
            <span>Password</span>
            <input
              type="password"
              autoComplete={isSignup ? 'new-password' : 'current-password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder={isSignup ? `At least ${MIN_PASSWORD} characters` : 'Your password'}
              minLength={MIN_PASSWORD}
              required
            />
          </label>

          {error ? (
            <div className="banner banner--error" role="alert">
              {error}
            </div>
          ) : null}
          {notice ? (
            <div className="banner banner--info" role="status">
              {notice}
            </div>
          ) : null}

          <button type="submit" className="button button--primary button--block" disabled={busy}>
            {busy ? 'Please wait…' : isSignup ? 'Create account' : 'Log in'}
          </button>
        </form>

        {canSkip ? (
          <p className="auth__skip">
            <Link to={ROUTES.home}>Continue without an account</Link>
          </p>
        ) : null}
      </div>
    </div>
  );
}

export default AuthPage;
