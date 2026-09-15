import { fileURLToPath } from 'node:url';

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const repoRoot = fileURLToPath(new URL('.', import.meta.url));

const API_PORT = process.env.PORT || '8787';
const API_TARGET = process.env.YAAR_API_TARGET || `http://127.0.0.1:${API_PORT}`;

/**
 * Vite config for the Yaar web client.
 *
 * - `root: 'client'` keeps the app source separate from the server.
 * - `envDir: '..'` means the single repo-root `.env` feeds both sides.
 * - `/api` is proxied to the Express server in development, so the browser only
 *   ever talks to one origin (no CORS, cookies work, and the HF key stays on
 *   the server).
 * - In production `vite build` writes straight into `./dist`, which
 *   `server/app.js` serves as static files.
 */
export default defineConfig({
  root: 'client',
  envDir: '..',
  publicDir: 'public',
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./client/src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  server: {
    // The shared/ folder lives outside `root`, so allow Vite to read it.
    fs: { allow: [repoRoot] },
    host: '0.0.0.0',
    port: Number(process.env.VITE_PORT || 5173),
    strictPort: true,
    // The Arena preview proxy and phone-on-LAN testing both use hostnames that
    // Vite's default allowlist would reject.
    allowedHosts: true,
    cors: { origin: true, credentials: true },
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: false,
        // SSE needs the socket to stay open and unbuffered.
        configure(proxy) {
          proxy.on('proxyReq', (proxyReq) => {
            proxyReq.setHeader('connection', 'keep-alive');
          });
        },
      },
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
    target: 'es2020',
    cssCodeSplit: false,
    sourcemap: false,
    reportCompressedSize: false,
    chunkSizeWarningLimit: 800,
    rollupOptions: {
      output: {
        // Split the framework out of the app code so a UI change does not
        // invalidate the cached vendor bundle. (Vite 8 / rolldown expects a
        // function here.)
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined;
          if (id.includes('react-router')) return 'router';
          if (id.includes('/react-dom/') || id.includes('/react/') || id.includes('scheduler')) {
            return 'react';
          }
          return undefined;
        },
      },
    },
  },
});
