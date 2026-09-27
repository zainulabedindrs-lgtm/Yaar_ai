# Deploying Yaar on Vercel + Supabase

```
Browser ── static files (dist/, Vercel CDN)
   │
   ├── supabase-js ──► Supabase Auth  (email + password sign-up / log-in)
   │
   └── /api/*  (Authorization: Bearer <Supabase access token>)
          │
          ▼
   api/index.js  (Vercel serverless function = the Express app from server/app.js)
          ├── verifies the JWT (JWKS / legacy secret) → user id  — never trusts a client id
          ├── Supabase Postgres (DATABASE_URL)       — users, conversations, messages, usage
          └── BazaarLink (OpenAI-compatible)         — AI replies
```

## 1. Supabase

1. **Auth → Providers → Email**: keep it enabled. Pick whether new users must confirm
   their email ("Confirm email"); the sign-up screen handles both.
2. **Auth → URL Configuration**: set *Site URL* to your Vercel URL
   (e.g. `https://yaar.vercel.app`) so confirmation links come back to the app.
3. **Connect → Transaction pooler**: copy the connection string (port **6543**) → `DATABASE_URL`.
   Tables are created automatically on the first request. You can also run
   `server/db/schema.sql` in the SQL editor first. Row Level Security is turned on with no
   policies, so the tables can't be reached through the public Data API with the anon key.

## 2. Vercel environment variables

Project → Settings → Environment Variables (Production and Preview). The **VITE_** values are
built into the frontend, so **redeploy** after you change them.

| Variable | Value | Secret? |
|---|---|---|
| `NODE_ENV` | `production` | |
| `SESSION_SECRET` | long random string (`openssl rand -hex 48`) | **yes** |
| `AI_PROVIDER` | `bazaarlink` | |
| `BAZAARLINK_API_KEY` | your BazaarLink key | **yes** |
| `BAZAARLINK_BASE_URL` | `https://api.bazaarlink.ai/v1` (optional, this is the default) | |
| `BAZAARLINK_MODEL` | `deepseek-v4-flash` (optional, this is the default) | |
| `DATABASE_URL` | Supabase transaction-pooler URI (with your DB password) | **yes** |
| `SUPABASE_URL` | `https://<project-ref>.supabase.co` | |
| `SUPABASE_PUBLISHABLE_KEY` | publishable key (`sb_publishable_…`) **or** legacy anon key (you can also name it `SUPABASE_ANON_KEY`) | public |
| `SUPABASE_SECRET_KEY` | secret key (`sb_secret_…`) **or** legacy service_role key. Only used to delete accounts | **yes** |
| `VITE_SUPABASE_URL` | same as `SUPABASE_URL` | public |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | same as `SUPABASE_PUBLISHABLE_KEY` | public |
| `AUTH_REQUIRED` | `true` to require a login, `false` to keep anonymous chat | |
| `ALLOW_ANONYMOUS` | `true` / `false` (`false` also requires a login) | |
| `FRAME_ANCESTORS` | `'self'` | |

Optional: `SUPABASE_JWT_SECRET` (legacy projects: verify HS256 tokens without a network call),
`DATABASE_POOL_MAX` (default 1 on Vercel), `BAZAARLINK_MODEL_FALLBACKS`.

⚠️ Never give the secret key, `DATABASE_URL` or `BAZAARLINK_API_KEY` a `VITE_` prefix:
every `VITE_` value ends up in the public JavaScript. `npm run check:secrets` fails if client
code reads a secret-looking `VITE_` variable.

## 3. What `vercel.json` does

* Builds the client with `npm run build` and serves `dist/` from the CDN.
* Rewrites `/api/*` to the single function `api/index.js`. Express still sees the original
  path, so every route works unchanged. SSE streaming is supported, and `maxDuration` is 60 s.
* Rewrites every other non-file path to `index.html` so SPA routes like `/chat/girlfriend`
  and `/auth` load on refresh.

## 4. Login policy

| `AUTH_REQUIRED` | `ALLOW_ANONYMOUS` | Behaviour |
|---|---|---|
| `false` | `true` | Accounts optional. Anonymous device sessions work, and signing in keeps chats across devices. |
| `true` | any | Chat, history, usage and settings return **401** without a valid login. The app sends users to `/auth`. |
| `false` | `false` | Same as above. |

`/api/health`, `/api/companions` and `/api/auth/config` are always public.

An anonymous session and an account are separate users. Signing in does not merge the
anonymous chat history into the account.

## 5. Local development

Leave `DATABASE_URL` empty and the server uses an embedded Postgres (PGlite) in `./data/pglite`,
so there is nothing to install. To try auth locally, put the Supabase and VITE_Supabase values
in `.env` and run `npm run dev`.

To run the server tests against a real (throwaway!) Postgres:
`TEST_DATABASE_URL=postgres://… npm run test:server`.
