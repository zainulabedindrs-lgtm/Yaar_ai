import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router-dom';

import AppShell from './components/AppShell.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { LoadingState } from './components/States.jsx';
import { ROUTES } from './config/appConfig.js';
import { AuthProvider } from './hooks/useAuth.jsx';
import { SessionProvider, useSession } from './hooks/useSession.jsx';
import HomePage from './pages/HomePage.jsx';

/**
 * Routes.
 *
 * Home is bundled eagerly (it is the first screen); every other page is
 * lazy-loaded so the initial download stays small on mobile networks.
 */
const ChatPage = lazy(() => import('./pages/ChatPage.jsx'));
const SettingsPage = lazy(() => import('./pages/SettingsPage.jsx'));
const AboutPage = lazy(() => import('./pages/AboutPage.jsx'));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage.jsx'));
const TermsPage = lazy(() => import('./pages/TermsPage.jsx'));
const NotFoundPage = lazy(() => import('./pages/NotFoundPage.jsx'));
const AuthPage = lazy(() => import('./pages/AuthPage.jsx'));

/** Pages that stay reachable without signing in (even when AUTH_REQUIRED). */
const PUBLIC_PATHS = [ROUTES.auth, ROUTES.about, ROUTES.privacy, ROUTES.terms];

/**
 * When the server says a login is required (401 on the boot request), send
 * the user to the sign-in page and bring them back afterwards.
 */
function AuthGate({ children }) {
  const { status } = useSession();
  const location = useLocation();
  if (status === 'unauthenticated' && !PUBLIC_PATHS.includes(location.pathname)) {
    return <Navigate to={ROUTES.auth} replace state={{ from: location.pathname }} />;
  }
  return children;
}

export default function App() {
  return (
    <ErrorBoundary>
      <AuthProvider>
      <SessionProvider>
        <Suspense fallback={<LoadingState />}>
          <AuthGate>
          <Routes>
            {/* Chat owns the full viewport (its own header + composer). */}
            <Route element={<AppShell hideNav />}>
              <Route path={ROUTES.chat(':companionId')} element={<ChatPage />} />
            </Route>

            {/* Everything else keeps the bottom navigation. */}
            <Route element={<AppShell />}>
              <Route path={ROUTES.home} element={<HomePage />} />
              <Route path={ROUTES.settings} element={<SettingsPage />} />
              <Route path={ROUTES.about} element={<AboutPage />} />
              <Route path={ROUTES.privacy} element={<PrivacyPage />} />
              <Route path={ROUTES.terms} element={<TermsPage />} />
              <Route path={ROUTES.auth} element={<AuthPage />} />
              <Route path="/chat" element={<Navigate to={ROUTES.home} replace />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
          </AuthGate>
        </Suspense>
      </SessionProvider>
      </AuthProvider>
    </ErrorBoundary>
  );
}
