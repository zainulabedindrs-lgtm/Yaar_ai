import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

/**
 * Client unit tests run in jsdom.
 *
 * Server tests use Node's built-in test runner instead (`npm run test:server`)
 * because they need a real SQLite file, a real HTTP server and the mock AI
 * provider.
 *
 * The aliases mirror `vite.config.js` so components resolve `@shared/*` the same
 * way in tests as they do in the app.
 */
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./client/src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    include: ['client/src/**/*.test.{js,jsx}', 'tests/client/**/*.test.{js,jsx}'],
    setupFiles: ['./tests/client/setup.js'],
    css: false,
    restoreMocks: true,
  },
});
