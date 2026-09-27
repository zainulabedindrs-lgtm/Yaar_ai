/**
 * Vercel serverless entry point.
 *
 * Vercel serves the Vite build (dist/) from its CDN and routes every /api/*
 * request here (see vercel.json). The exported Express app is exactly the one
 * `npm start` runs — same routes, middleware, auth and database code.
 *
 * The app is created once per function instance and reused across warm
 * invocations, so the Postgres pool and cached Supabase JWKS survive between
 * requests.
 */

import { createApp } from '../server/app.js';

// Static files are served by Vercel's CDN, not by the function.
const app = createApp({ clientDistPath: null });

export default app;
