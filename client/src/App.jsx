import { lazy, Suspense } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';

import AppShell from './components/AppShell.jsx';
import ErrorBoundary from './components/ErrorBoundary.jsx';
import { LoadingState } from './components/States.jsx';
import { ROUTES } from './config/appConfig.js';
import { SessionProvider } from './hooks/useSession.jsx';
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

export default function App() {
  return (
    <ErrorBoundary>
      <SessionProvider>
        <Suspense fallback={<LoadingState />}>
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
              <Route path="/chat" element={<Navigate to={ROUTES.home} replace />} />
              <Route path="*" element={<NotFoundPage />} />
            </Route>
          </Routes>
        </Suspense>
      </SessionProvider>
    </ErrorBoundary>
  );
}
