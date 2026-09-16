# Yaar — AI companion app 💛

> **Someone to talk to, anytime.**

Yaar is a mobile-first AI companion chat app for people who feel bored, lonely or simply want
someone to talk to. The user picks a companion — **Your Girlfriend (Ayesha)** or
**Your Boyfriend (Hamza)** — and has a real, streamed AI conversation that automatically follows
their language: English, **اردو**, **हिन्दी**, Roman Urdu/Hindi, or any natural mix of them.

It is a complete, production-shaped application: a React client, an Express API, a SQLite
database, a provider-agnostic AI service layer built for **Hugging Face Inference Providers**, a
server-enforced **20 messages / 24 hours** limit, persistent chat history, and a test suite that
covers the chat pipeline end to end.

---

## Table of contents

1. [What Yaar is](#1-what-yaar-is)
2. [Feature list](#2-feature-list)
3. [Screens](#3-screens)
4. [Project structure](#4-project-structure)
5. [Architecture](#5-architecture)
6. [Prerequisites](#6-prerequisites)
7. [Installation & running locally](#7-installation--running-locally)
8. [Environment variables](#8-environment-variables)
9. [Hugging Face setup](#9-hugging-face-setup)
10. [How the AI integration works](#10-how-the-ai-integration-works)
11. [How the 20-message limit works](#11-how-the-20-message-limit-works)
12. [How conversation persistence works](#12-how-conversation-persistence-works)
13. [Database schema](#13-database-schema)
14. [API reference](#14-api-reference)
15. [The chat composer (word wrapping)](#15-the-chat-composer-word-wrapping)
16. [Responsive & mobile behaviour](#16-responsive--mobile-behaviour)
17. [Testing](#17-testing)
18. [Production build & deployment](#18-production-build--deployment)
19. [Android / Play Store packaging](#19-android--play-store-packaging)
20. [Security notes](#20-security-notes)
21. [Troubleshooting](#21-troubleshooting)
22. [Roadmap / what is left before store submission](#22-roadmap--what-is-left-before-store-submission)
23. [For the next developer or AI agent](#23-for-the-next-developer-or-ai-agent)

---

## 1. What Yaar is

* **Two companions, two voices.** Ayesha (girlfriend) and Hamza (boyfriend) each have their own
  persona prompt, avatar, accent colour, greeting and conversation. They text like people: short
  messages, questions back, light teasing, real reactions — never customer-support paragraphs.
* **Language mirroring without a setting.** The server detects the script/language of the newest
  user message and adds a one-line instruction to the system prompt, so replies match the user
  (including Roman Urdu and mixed language messages).
* **A real AI, not a demo.** No canned responses anywhere in the codebase. Every reply comes from
  the configured model (default `Qwen/Qwen3-8B` on Hugging Face), streamed token by token.
* **Honest by design.** The personas never pretend to be human if sincerely asked, never use guilt
  or "you only need me" pressure, and hand off to real help when the conversation turns serious.
* **Server-enforced limits.** 20 user messages per rolling 24 hours, tracked in SQLite against an
  anonymous session — not in `localStorage`.

## 2. Feature list

| Area | What is implemented |
| --- | --- |
| Companion modes | Girlfriend (Ayesha) & boyfriend (Hamza): distinct personas, avatars, accent themes, greetings and traits |
| AI | Hugging Face Inference Providers (OpenAI-compatible router), streaming SSE replies, model fallback list, reasoning-block stripping, configurable temperature/top-p/max tokens |
| Language | Automatic Urdu/Hindi/English/Roman-Urdu detection, mixed-language mirroring, RTL-correct rendering |
| Chat UI | Header with avatar + presence, day separators, user/assistant bubbles, typing indicator, timestamps, stop button, auto-scroll with "jump to latest", optimistic sending |
| Input | Auto-growing composer, word-safe wrapping, IME-safe Enter handling, `dir="auto"`, character counter, limit state |
| Usage limit | 20 user messages / rolling 24 h, server-side, atomic with message insert, refund on AI failure, live counter, friendly limit card with countdown, per-companion conversations sharing one budget |
| History | SQLite persistence, survives reload/restart, paginated history API, clear-conversation action (with confirmation), never deleted at the limit |
| Home | Brand hero, tagline, usage meter, two premium companion cards with Continue-chat state |
| Settings | Companion switcher, live usage + reset time, language behaviour, session info, privacy summary, clear chat, delete all data (both confirmed), version, AI model, legal links |
| About / Privacy / Terms | Written to match what the code actually does |
| Errors | Offline, timeout, rate limit, provider outage, empty reply, empty message, limit reached, session expiry — all with friendly copy, never a stack trace |
| Security | No key in the client, `.env` git-ignored, `.env.example` committed, CSP + hardening headers, input sanitisation, per-user ownership checks, rate limiting |
| Testing | 138 automated tests (68 server + 70 client) plus a 41-check end-to-end smoke script |
| Mobile | Mobile-first CSS (360 → desktop), safe-area insets, keyboard-safe composer, PWA manifest + icon set, Capacitor config for Android packaging |

## 3. Screens

| Route | Screen | Notes |
| --- | --- | --- |
| `/` | Home | Hero, tagline, usage meter, two companion cards |
| `/chat/:companionId` | Chat | `girlfriend` or `boyfriend`; full-height header + composer |
| `/settings` | Settings / profile | Everything about the session and its data |
| `/about` | About | What Yaar is, honest notes, safety guidance |
| `/privacy` | Privacy | Exactly what is stored, sent and deletable |
| `/terms` | Terms | Plain-language usage rules |
| `*` | Not found | Friendly, with a way back home |

Browser back/forward works normally (real history entries, `BrowserRouter`). The chat route is
deliberately not a bottom-nav tab — it is reached from Home, and the bottom nav has Home / Settings
/ About / Chat.

## 4. Project structure

```
Yaar_ai/
├── client/                         # React + Vite web client (the app UI)
│   ├── index.html                  # App shell, meta tags, manifest + icon links
│   ├── public/
│   │   ├── avatars/                # ayesha.webp/png, hamza.webp/png
│   │   ├── icons/                  # favicon.svg, PWA + Play Store icon sizes
│   │   └── manifest.webmanifest
│   └── src/
│       ├── api/                    # httpClient, chatStream (SSE), yaarApi endpoints
│       ├── components/             # Avatar, ChatComposer, MessageBubble/List, UsageMeter,
│       │                           # CompanionCard, BottomNav, ErrorBanner, LimitNotice,
│       │                           # ConfirmDialog, AppShell, States, icons…
│       ├── config/appConfig.js     # VITE_* config, routes
│       ├── hooks/                  # useSession, useChat, useAutoScroll, useCountdown,
│       │                           # useOnlineStatus, useVisualViewport, useIsTouchDevice
│       ├── pages/                  # Home, Chat, Settings, About, Privacy, Terms, NotFound
│       ├── styles/                 # tokens.css, base.css, app.css (design system)
│       ├── utils/                  # device id, storage, formatting
│       ├── App.jsx                 # routes + lazy loading + error boundary
│       └── main.jsx
├── server/                         # Express API (ESM, no build step)
│   ├── index.js                    # entry point (HTTP server, graceful shutdown)
│   ├── app.js                      # express app factory, headers, static client, SPA fallback
│   ├── config.js                   # all environment configuration
│   ├── appMetadata.js              # version / limits / legal paths
│   ├── db/
│   │   ├── database.js             # connection + migrations
│   │   ├── schema.sql              # users, conversations, messages, usage_limits
│   │   └── repositories/           # users, conversations, messages, usage
│   ├── http/sse.js                 # Server-Sent Events helper (+ heartbeat)
│   ├── middleware/                 # session (anonymous identity), rateLimit, errorHandler
│   ├── routes/                     # session, conversations, chat, meta
│   ├── services/
│   │   ├── ai/
│   │   │   ├── openaiCompatibleClient.js  # HTTP, SSE parsing, reasoning filter, error mapping
│   │   │   ├── promptBuilder.js           # persona + history + language instruction
│   │   │   └── providers.js               # provider factory (swap HF for anything)
│   │   ├── chatService.js          # turn orchestration (usage + persistence + AI)
│   │   └── usageService.js         # the 20/24h rule
│   ├── utils/                      # logger, errors, ids, validate, languageDetect, asyncHandler
│   └── validation/schemas.js       # zod request schemas
├── shared/                         # code imported by BOTH client and server
│   ├── companions.js               # personas, display metadata, greetings
│   ├── errors.js                   # error codes + friendly copy + limits
│   └── reasoning.js                # model reasoning markers
├── scripts/
│   ├── dev.mjs                     # `npm run dev` (API + Vite together)
│   ├── mockAiServer.mjs            # OpenAI-compatible mock provider (tests + offline dev)
│   ├── dev-mock-hf.mjs             # `npm run dev:mock-ai`
│   ├── smoke-test.mjs              # `npm run smoke` end-to-end verification
│   ├── check-ai.mjs                # `npm run check:ai` provider sanity check
│   ├── db-reset.mjs                # `npm run db:reset`
│   └── generate-icons.mjs          # `npm run icons` (regenerates the icon set)
├── tests/
│   ├── server/                     # usage limit, chat flow, AI provider, prompt builder
│   └── client/                     # composer, API client, SSE, UI states, formatting, app flow
├── docs/
│   └── PLAY_STORE.md               # store checklist, privacy/rating notes, signing steps
├── capacitor.config.json           # Android/iOS wrapper configuration
├── vite.config.js                  # client build + dev proxy (/api → server)
├── vitest.config.js                # client test runner
├── .env.example                    # every environment variable, documented
└── .gitignore                      # secrets, build output, local data
```

## 5. Architecture

```
  Browser (React)
    │  1. GET  /api/session                    → identity, usage, companions, conversations
    │  2. POST /api/chat/:companion/messages   → SSE stream of the reply
    ▼
  Express API  ───────────────────────────────────────────────┐
    │  session middleware: device id + cookie → user id        │
    │  chatService.beginTurn()  ── one transaction:            │
    │      usageService.consumeMessage()  (429 when exhausted) │
    │      INSERT user message                                 │
    ▼                                                          │
  SQLite (better-sqlite3)                                      │
    users / conversations / messages / usage_limits            │
    ▲                                                          │
    │  chatService.saveAssistantReply()                        │
    │                                                          │
  AI service layer ─────────────────────────────────────────────┘
    providers.js → openaiCompatibleClient.js
        POST https://router.huggingface.co/v1/chat/completions  (stream: true)
        ← SSE deltas → ReasoningFilter → SSE deltas → browser
```

Key design rules:

* **The client never talks to the AI provider.** There is no API key in the bundle; `connect-src`
  in the CSP is limited to the app origin.
* **The server is the only source of truth for usage.** The UI mirrors the counter; it never
  decides whether a message is allowed.
* **The AI provider is behind one interface** (`getChatProvider()`), so swapping Hugging Face for
  another backend touches a single factory function.
* **One database transaction per user message**, so a crash can never charge a message that was
  not stored.

## 6. Prerequisites

* **Node.js ≥ 20.11** (Node 22 LTS recommended; `node --version`)
* **npm ≥ 10** (or pnpm/yarn — the lockfile is npm's)
* A **Hugging Face account + access token** with the *Inference Providers* permission
  (free tier available) for real AI replies — see [§9](#9-hugging-face-setup)
* Nothing else: the database is SQLite and is created automatically.

## 7. Installation & running locally

```bash
# 1. clone / open the project
cd Yaar_ai

# 2. install dependencies (client, server and test tooling)
npm install

# 3. create your environment file (git-ignored — see §8 for the full walkthrough)
cp .env.example .env
#    → open .env and paste your Hugging Face token into HUGGINGFACE_API_KEY

# 4. run the app (API + Vite dev server, both watching)
npm run dev
#    client: http://localhost:5173     API: http://localhost:8787
```

Open <http://localhost:5173>, pick a companion, and say hello. Vite proxies `/api/*` to the API
server, so there is no CORS configuration and the browser only ever sees one origin.

### Other useful commands

```bash
npm run dev:mock-ai    # offline stand-in for the Hugging Face router (port 8099)
npm run dev:api        # only the API server
npm run check:ai       # send one real prompt to the configured provider and print the reply
npm run test           # 138 automated tests (server + client)
npm run smoke          # 41-check end-to-end run against a temporary database
npm run check:secrets  # scan tracked files + the built bundle for leaked credentials
npm run verify         # secrets scan + tests + production build + smoke test
npm run build          # production client build → ./dist
npm start              # production server: serves ./dist + the API on :8787
npm run db:reset       # delete the local SQLite database
npm run icons          # regenerate the icon set (needs `npm i --no-save sharp`)
```

### Developing without a Hugging Face key

The sandbox-friendly path: run the mock provider and point Yaar at it.

```bash
npm run dev:mock-ai            # terminal 1 → http://127.0.0.1:8099/v1
```

```ini
# .env
AI_PROVIDER=openai-compatible
OPENAI_COMPATIBLE_BASE_URL=http://127.0.0.1:8099/v1
OPENAI_COMPATIBLE_MODEL=yaar-mock-model
```

The mock implements the same contract as the real router (SSE, OpenAI-style errors, reasoning
blocks) and can simulate failures via `?fail=`: `fail`, `timeout`, `empty`, `ratelimit`, `auth`,
`model`, `streamonly`. **It is never used by the shipped app** — it exists so tests and offline
development are possible. The reply is generated locally, not by an AI model.

## 8. Environment variables

Everything lives in `.env` (git-ignored). `.env.example` documents every key; the essential ones:

| Variable | Default | Purpose |
| --- | --- | --- |
| `PORT` | `8787` | API/server port |
| `HOST` | `0.0.0.0` | Bind address (keep `0.0.0.0` in containers) |
| `NODE_ENV` | `development` | `production` enables strict secrets + secure cookies |
| `AI_PROVIDER` | `huggingface` | `huggingface` or `openai-compatible` |
| `HF_API_KEY` | — | Legacy alias for `HUGGINGFACE_API_KEY`; still read if the new name is unset |
| `HF_BASE_URL` | `https://router.huggingface.co/v1` | Inference Providers router |
| `HF_MODEL` | `Qwen/Qwen3-8B` | Primary model |
| `HF_MODEL_FALLBACKS` | `meta-llama/Llama-3.1-8B-Instruct,openai/gpt-oss-20b` | Tried in order if the primary fails |
| `HF_INFERENCE_PROVIDER` | — | Optional provider pin (`together`, `cerebras`, `fastest`, …) |
| `HF_TEMPERATURE` / `HF_TOP_P` / `HF_MAX_TOKENS` | `0.85` / `0.95` / `400` | Sampling |
| `HF_TIMEOUT_MS` / `HF_IDLE_TIMEOUT_MS` | `45000` / `20000` | Whole-reply and between-chunks timeouts |
| `AI_STREAMING` | `true` | Stream replies token by token |
| `DATABASE_PATH` | `./data/yaar.sqlite` | SQLite file (`:memory:` for ephemeral runs) |
| `DAILY_MESSAGE_LIMIT` | `20` | User messages per window |
| `USAGE_WINDOW_HOURS` | `24` | Window length |
| `REFUND_FAILED_MESSAGES` | `true` | Give the message back when the AI fails |
| `SESSION_SECRET` | dev default | **Secret.** Required in production; sign cookies + hash device ids |
| `FRAME_ANCESTORS` | `*` | CSP `frame-ancestors`; set `'self'` on a public deployment |
| `TRUST_PROXY` | `0` | Set `1` behind nginx/Fly/Render so rate limiting sees real IPs |
| `CHAT_RATE_LIMIT_PER_MINUTE` | `30` | Abuse protection for the chat endpoint |
| `VITE_APP_VERSION` | `1.0.0` | Displayed in Settings/About |
| `VITE_API_BASE_URL` | *(empty)* | Only for the Android/WebView build (absolute API origin) |

Generate a production secret with:

```bash
node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"
```

### 8.1 Creating your local `.env` and adding the Hugging Face key

`.env` is **git-ignored** and is the only place the key should ever live. Nothing is read from it
by the browser — `client/` never sees it, and the built bundle is scanned for tokens by
`npm run check:secrets`.

```bash
# 1. from the repository root, copy the template
cp .env.example .env

# 2. open .env in your editor and find the Hugging Face block
#       HUGGINGFACE_API_KEY=
#    paste your token immediately after the "=" with no quotes and no spaces:
#       HUGGINGFACE_API_KEY=<your token, starts with hf_>

# 3. make sure the app is using the real provider (not the offline mock)
#       AI_PROVIDER=huggingface

# 4. confirm nothing sensitive is staged for commit, then verify the key works
npm run check:secrets
npm run check:ai -- "kya kar rahe ho?"
```

The last command prints the provider, the model, the latency and a real reply. If it reports
“AI provider is NOT configured”, the key is missing, misspelled or empty in `.env`.

**Where the key must never appear**

| Don't put the key in | Why |
| --- | --- |
| `.env.example` | It is committed to GitHub and read by everyone |
| Anywhere in `client/` (components, hooks, config) | It would be bundled into browser JavaScript — `VITE_*` variables are public |
| Committed source files, tests, fixtures, screenshots, commit messages | Git history is forever, even after a delete |
| `localStorage`, `sessionStorage`, cookies or a URL query string | Visible in the browser and in logs |
| Chat transcripts, tickets or screenshots | Treat any pasted key as compromised |

**How the key is used, and how it stays server-side**

```
.env (git-ignored)  →  server/config.js  →  server/services/ai/providers.js
                                           →  Authorization: Bearer <key>
                                              (outgoing HTTPS request to Hugging Face)
browser  →  /api/chat/... (your own server)  →  no key, ever
```

* `server/config.js` reads `process.env.HUGGINGFACE_API_KEY` **once, at import time**, on the server only.
* The token is attached to the outgoing provider request as a bearer header; it is never included in
  an API response, a log line or an error message (the logger redacts both secret-named fields and
  anything that looks like an `hf_…` / `sk-…` / `Bearer …` value).
* The browser only ever talks to your own origin: the client-side CSP is `connect-src 'self'`.
* `npm run check:secrets` (part of `npm run verify`) fails the build if a token-shaped value appears
  in a tracked file or in `dist/`, if `.env.example` holds a real value, if `.env` is not ignored, or
  if client code references a server-only variable.

**If a key ever leaks** (pasted into a chat, committed, shared in a screenshot): revoke it at
<https://huggingface.co/settings/tokens>, create a new one, update `.env`, restart the server, and
run `npm run check:secrets` again. Rotating takes a minute; leaving a live key exposed does not.

## 9. Hugging Face setup

1. Create a free account at <https://huggingface.co/join>.
2. Open <https://huggingface.co/settings/tokens> → **Create new token** →
   *Fine-grained* → enable **“Make calls to Inference Providers”** (read access is enough).
3. Copy the token (`hf_…`) into `.env`:

   ```ini
   # .env  (git-ignored)
   AI_PROVIDER=huggingface
   HUGGINGFACE_API_KEY=hf_your_token_here
   HF_MODEL=Qwen/Qwen3-8B
   ```

   Pasting the token on the same line as `HUGGINGFACE_API_KEY=`, with no quotes and no spaces, is
   all that is required — see §8.1 for the full walkthrough.

4. Verify:

   ```bash
   npm run check:ai -- "kya kar rahe ho?"
   ```

   You should see the provider, model, latency and a Roman-Urdu reply.

### Choosing a model

| Model | Why |
| --- | --- |
| `Qwen/Qwen3-8B` | **Default.** Strong multilingual (English/Urdu/Hindi), fast, cheap on the free tier |
| `meta-llama/Llama-3.3-70B-Instruct` | Higher quality conversations, slower/pricier |
| `openai/gpt-oss-20b` | Good general chat, widely available on the router |
| `CohereForAI/aya-expanse-8b` | Specifically strong for Urdu/Hindi |

Notes:

* Some models require accepting a licence on their model page first; that is why
  `HF_MODEL_FALLBACKS` exists.
* Adding `:provider` to the model id (or setting `HF_INFERENCE_PROVIDER`) pins the inference
  provider, e.g. `Qwen/Qwen3-8B:together`.
* The model can be changed at any time without touching app code — it is configuration only.

## 10. How the AI integration works

```
browser ──POST /api/chat/:companion/messages──▶ Express
                                                 │  session → user id
                                                 │  beginTurn(): usage + INSERT (1 transaction)
                                                 │  promptBuilder.buildChatPrompt()
                                                 ▼
                                       openaiCompatibleClient.chat({ stream: true })
                                                 │  POST https://router.huggingface.co/v1/chat/completions
                                                 │  Authorization: Bearer $HUGGINGFACE_API_KEY   (server only)
                                                 ▼
                                       SSE deltas ─▶ ReasoningFilter ─▶ SSE deltas ─▶ browser bubbles
                                                 │
                                                 └─ reply persisted → `done` event with usage
```

* **Provider-agnostic layer** — `server/services/ai/providers.js` returns a chat client;
  `chatRoutes`/`chatService` never mention Hugging Face. Switching to Azure/OpenAI/self-hosted
  vLLM is one configuration change (`AI_PROVIDER=openai-compatible` + base URL).
* **Prompt assembly** — `promptBuilder.js` sends `[system persona + language instruction + time,
  …last ~24 messages]` with consecutive same-role messages merged (some providers reject them).
* **Reasoning stripping** — models such as Qwen3 can emit a private reasoning block before the
  answer. `ReasoningFilter` removes it token-by-token, including tags split across chunks, so the
  user never sees it. (`shared/reasoning.js` explains why the markers are built from character
  codes.)
* **Resilience** — up to 2 attempts per model (streaming → non-streaming) × the model list;
  per-reply timeout *and* idle timeout; every failure maps to a user-safe `ApiError` code.
* **Failures never cost a message** — if no text was produced, `usageService.refundMessage()`
  returns the message to the user's allowance.

## 11. How the 20-message limit works

**Rule:** each user may send exactly **20 user messages per rolling 24-hour window**. AI replies
are never counted.

* **Where it lives** — `server/services/usageService.js` + the `usage_limits` table. The window
  starts when the first message of a window is sent and expires 24 h later; the next message after
  that starts a fresh window automatically.
* **Atomic with the message** — `chatService.beginTurn()` runs inside a single SQLite transaction:
  `consumeMessage()` increments the counter, then the user message is inserted. If either step
  fails, nothing changes, so a crash can never charge a message that was not stored.
* **Enforced before the AI is called** — message 21 is rejected with HTTP **429** and
  `code: daily_limit_reached`, plus `details.usage` (used/limit/remaining/resetAt). The AI is never
  contacted, so a blocked message costs nothing.
* **Identity that survives refreshing** — the client generates a random device id once
  (`localStorage`) and sends it as `x-yaar-device-id`; the server hashes it with
  `SESSION_SECRET` into the user id and also issues a signed cookie. Because the id is
  deterministic, the counter survives page reloads, cleared cookies, private-mode sessions and the
  Android WebView. Clearing site data is the only way to obtain a new identity — exactly like every
  anonymous app before real authentication.
* **Not fooled by the frontend** — nothing in the client decides anything. Editing `localStorage`,
  replaying requests or calling the API directly still hits the same server-side counter.
* **Retries are free** — a resend with the same `clientMessageId` is recognised as the same
  message (idempotent), and `POST /chat/:id/regenerate` asks for a missing reply without spending a
  message.
* **Failures are refunded** — if the AI errors, times out or is stopped before producing text, the
  message is returned (`REFUND_FAILED_MESSAGES=true`). If a partial reply was already shown, it is
  kept (the user read it) and the message is not refunded.
* **Typing is never counted** — only accepted, stored user messages are counted.
* **Nothing is deleted at the limit** — the conversation stays readable and editable; only sending
  pauses. The chat shows the friendly card:

  > That's all 20 messages for now 💛
  > Come back after 24 hours and we'll continue our conversation.
  > *Free again in 4h 12m*

* **Displayed everywhere it matters** — Home and Settings show “12 / 20 messages used” with a
  progress bar and reset time; the chat header shows a compact counter.
* **Ready for real auth** — `usage_limits.user_id` already references `users`, and `users` carries
  `auth_provider` / `auth_subject`. Adding Google/phone login means filling those two columns; no
  other table changes.

## 12. How conversation persistence works

* **One conversation per user per companion** (enforced by a unique index), so “continue where you
  stopped” is trivial and history cannot be accidentally duplicated.
* **Messages are stored before the reply arrives**, and the assistant reply is stored the moment it
  completes; a partial stream (network cut, server restart) is saved as the reply the user actually
  saw instead of being discarded.
* **Ordering** uses a monotonic `seq` per conversation, so same-millisecond timestamps cannot
  reorder the chat; the history endpoint is paginated (`?limit=&before=`).
* **The first message of a conversation is a seeded greeting** from the companion (an assistant
  message, so it never consumes a message). It is seeded from either the history endpoint or the
  first send, whichever comes first, which keeps the ordering correct for deep links.
* **Reload/restart safe** — the client re-fetches history on mount, the server serves it from
  SQLite (WAL mode), and the usage window is stored server-side.
* **Privacy** — every read/write goes through `getOwnedConversation(...)`/user-scoped queries, so
  another user can never read your chat (verified by tests: “history is paginated and never leaks
  another session”). There is no public feed.
* **Deletion is real** — clearing a conversation removes its messages and re-seeds the greeting;
  “Delete all my data” removes the user row and (via `ON DELETE CASCADE`) conversations, messages
  and the usage record.

## 13. Database schema

SQLite (file `data/yaar.sqlite`, WAL mode, foreign keys on). Full DDL:
`server/db/schema.sql`.

```
users                   conversations            messages                    usage_limits
─────────────────       ─────────────────        ──────────────────────      ─────────────────────
id (PK, opaque)         id (PK)                  id (PK)                     user_id (PK, FK)
display_name            user_id (FK)             conversation_id (FK)        window_started_at
auth_provider           companion_id             user_id (FK)                window_expires_at
auth_subject            title                    sender (user|ai|system)     messages_used
created_at              created_at               content                     lifetime_messages
last_seen_at            updated_at               status (sent|streaming|…)   updated_at
                        last_message_at          error_code / model / provider
                        is_archived              created_at / seq
```

Each message therefore records **sender, content, timestamp, conversation and user** (plus the
model that produced it), and usage tracking stores **user, messages used in the window, window
start and reset time** — exactly the model the brief requires.

## 14. API reference

All endpoints are JSON unless noted. Identity comes from the `x-yaar-device-id` header and/or the
signed session cookie; both are optional (a new anonymous identity is issued if neither is present).

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/health` | Liveness, AI provider status, database counts |
| `GET` | `/api/session` | **Boot payload:** user, usage, companions, conversations, AI status, app meta |
| `PATCH` | `/api/session` | Set an optional display name |
| `DELETE` | `/api/session` | Delete this anonymous user and all of their data |
| `GET` | `/api/companions` | Public companion metadata (never the prompts) |
| `GET` | `/api/usage` | Current usage window |
| `GET` | `/api/conversations/:companionId/messages` | History, paginated (`limit`, `before`) |
| `DELETE` | `/api/conversations/:companionId/messages` | Clear a conversation (greeting re-seeded) |
| `POST` | `/api/chat/:companionId/messages` | **Send a message** — SSE stream by default, JSON when `{"stream": false}` |
| `POST` | `/api/chat/:companionId/regenerate` | Ask again when a reply is missing (free) |
| `POST` | `/api/chat/dev/reset-usage` | Dev-only usage reset (404 in production) |

**SSE events** for a streaming send:

```
event: meta   data: { conversation, userMessage, usage }        ← message accepted (counted)
event: delta  data: { text: "piece of the reply" }              ← repeated
event: done   data: { assistantMessage, usage, ms }             ← reply stored
event: error  data: { error: { code, message, details } }       ← nothing generated (refunded)
```

**Error shape** (always user-safe):

```json
{ "error": { "code": "daily_limit_reached", "message": "That's all 20 messages for now 💛…",
             "details": { "usage": { "used": 20, "limit": 20, "remaining": 0, "resetAt": 1789586063793 } } } }
```

Codes: `validation_error`, `empty_message`, `message_too_long`, `daily_limit_reached`,
`rate_limited`, `ai_unavailable`, `ai_timeout`, `ai_empty_response`, `ai_not_configured`,
`network_error`, `server_error`, `unknown_companion`, `unknown_conversation`, `not_found`,
`session_expired`, `cancelled`.

## 15. The chat composer (word wrapping)

The composer was written specifically to make the previous implementation's typing bug impossible.
The CSS (`client/src/styles/app.css` → `.composer__input`) and its tests are the contract:

```css
.composer__input {
  white-space: pre-wrap;   /* wrap at real word boundaries, keep the author's spaces */
  word-break: normal;      /* NEVER split a word in the middle — no `break-all` anywhere */
  overflow-wrap: normal;   /* no emergency mid-word breaking */
  overflow-x: auto;        /* an unbreakable mega-word scrolls instead of breaking */
  overflow-y: auto;
  font-size: 16px;         /* stops iOS Safari zooming the page on focus */
  max-height: 132px;       /* ~5 lines, then it scrolls */
}
```

Behaviour that goes with it:

* The textarea auto-grows with the content (measured in JS, capped at 132 px) and re-measures on
  container resize/rotation.
* **Desktop:** `Enter` sends, `Shift+Enter` inserts a newline. **Touch devices:** `Enter` inserts a
  newline (that is what a soft keyboard's Return does) and the round send button sends.
* **IME-safe:** `Enter` during a composition (Urdu/Hindi keyboards, Chinese/Japanese input) never
  triggers a send.
* `dir="auto"` so Urdu/Hindi text lays out right-to-left correctly without switching anything.
* Long messages never break the layout: bubble text uses `overflow-wrap: break-word` (a single
  unbreakable word may break rather than overflow the screen) and the page never scrolls
  horizontally at 360 px.

Tested in `tests/client/ChatComposer.test.jsx`: short sentences, long sentences, long English
words, Urdu, Hindi, mixed Urdu/English, multi-line input, Enter/Shift+Enter, IME, empty/whitespace
input, limit-disabled state, and a CSS contract check that fails if `word-break: break-all` or
`overflow-wrap: anywhere` is ever introduced.

## 16. Responsive & mobile behaviour

* Mobile-first CSS with breakpoints at 400 px and 720 px; layouts verified for **360, 375, 390, 412,
  tablet and desktop** widths. Nothing overflows horizontally.
* **Safe areas:** `env(safe-area-inset-*)` is applied to the nav, header and composer, and the
  viewport uses `viewport-fit=cover`, so notched phones do not clip the UI.
* **Keyboard:** the composer is pinned at the bottom of a `100dvh` flex column inside a scrollable
  shell (the page itself does not scroll), `interactive-widget=resizes-content` is set, and
  `useVisualViewport()` publishes a live `--keyboard-inset` for iOS Safari, which overlays the
  keyboard without resizing the layout. The input therefore stays visible while typing.
* **Touch:** 46 px minimum tap targets, `touch-action: manipulation` (no 300 ms delay),
  `env()`-aware spacing, no hover-only affordances.
* **Reduced motion:** `prefers-reduced-motion` disables the animations.
* **Dark mode:** a full dark theme follows the OS setting (all colours come from CSS variables).
* **PWA:** installable via `manifest.webmanifest`, with icon set and `apple-touch-icon`.

## 17. Testing

```bash
npm run test          # 138 automated tests
npm run smoke         # 41 end-to-end checks (real server + mock provider + temp database)
npm run verify        # test + build + smoke — the pre-release gate
```

| Suite | File | Covers |
| --- | --- | --- |
| Usage limit | `tests/server/usageLimit.test.js` | 20 accepted, #21 rejected, no storage on rejection, window rollover, refunds, per-user isolation, idempotent retries |
| Chat flow (HTTP) | `tests/server/chatFlow.test.js` | Boot payload, greeting seeding, SSE meta/delta/done, JSON mode, one-credit-per-message regression, Urdu/Hindi/Roman/mixed replies, empty messages, unknown companion, regenerate, provider outage/rate-limit/auth failures, history pagination, cross-user privacy, clear/delete |
| AI provider | `tests/server/aiProvider.test.js` | Reasoning filter (single chunk, split chunks, partial tags), SSE parsing, language mirroring, fallbacks (model + non-streaming), timeout, offline, empty reply, error mapping |
| Prompt builder | `tests/server/promptBuilder.test.js` | Script detection, language instructions, history budgeting, same-role merging, persona integrity |
| Secret handling (server) | `tests/server/envSecret.test.js` | The key is read from `HUGGINGFACE_API_KEY` (alias `HF_API_KEY`), never appears in an API response, is redacted in logs and errors, and warns by name when missing |
| Secret handling (client) | `tests/client/secretHandling.test.jsx` | Client config exposes no secrets, no client file reads a server-only variable, no credential-shaped strings, the bundle points at our API only |
| Composer | `tests/client/ChatComposer.test.jsx` | Typing integrity for all scripts, Enter/Shift+Enter, IME, send button, limit state, CSS contract |
| API client | `tests/client/apiClient.test.js` | Device header, error mapping, offline, timeout, cancellation, usage details |
| SSE transport | `tests/client/chatStream.test.js` | Frame ordering, split frames, heartbeats, error frames, aborted streams |
| UI states | `tests/client/uiStates.test.jsx` | Usage meter, limit card, error banners, confirm dialog, empty/loading/error states |
| Formatting | `tests/client/format.test.js` | Countdown, day labels, truncation |
| App flow | `tests/client/appFlow.test.jsx` | Home → chat → send → streamed reply → counter, reload persistence, limit UI, AI-failure banner, settings/about screens |

Manual testing performed for this release: the full flow was exercised against a **running
production build** (`npm start` serving `dist/`) with curl/Node clients — session bootstrap, SSE
streaming, Urdu/Hindi/Roman/mixed replies, 20 accepted messages, 21st rejected with HTTP 429 and
the exact friendly copy, history intact afterwards, counter preserved on a fresh client with the
same device id, and another device unaffected. The current sandbox has no internet access, so the
AI provider was the local mock (same contract as the HF router); run `npm run check:ai` on a
network-enabled machine to confirm the real Hugging Face path.

## 18. Production build & deployment

```bash
npm run build      # → ./dist (client)
npm start          # serves ./dist + the API on PORT, NODE_ENV=production
```

Production checklist:

1. `.env`: `NODE_ENV=production`, a strong `SESSION_SECRET`, real `HUGGINGFACE_API_KEY`, `TRUST_PROXY=1`
   behind a proxy, `FRAME_ANCESTORS='self'`.
2. Put the app behind HTTPS (required for `secure` cookies and for the Play Store build).
3. Persist `DATABASE_PATH` on a volume (`./data` by default) and back it up — it holds the users,
   conversations and usage records.
4. Run one process (SQLite + in-memory rate limiting assume a single instance). For horizontal
   scaling, move rate limiting to Redis and the database to Postgres — both are isolated behind
   `middleware/rateLimit.js` and `db/repositories/*`.
5. Ship the built client and the server together: `server/app.js` serves `dist/` with an SPA
   fallback and long-lived cache headers for hashed assets.

Docker (minimal, optional):

```dockerfile
FROM node:22-alpine
WORKDIR /app
COPY package*.json ./
RUN npm ci --omit=dev && npm i --no-save sharp@0.33.5   # sharp only needed for `npm run icons`
COPY . .
RUN npm run build
ENV NODE_ENV=production PORT=8787 HOST=0.0.0.0
EXPOSE 8787
CMD ["node", "server/index.js"]
```

## 19. Android / Play Store packaging

The client is a static bundle served by the API, which is the shape Capacitor expects.

```bash
# 1. point the build at your deployed API (required: the WebView has no dev proxy)
echo 'VITE_API_BASE_URL=https://your-api.example.com' >> .env
npm run build

# 2. add Capacitor (one-off) — pinned versions are tested with this app
npm i -D @capacitor/cli@^6 && npm i @capacitor/core@^6 @capacitor/android@^6
npm i @capacitor/keyboard@^6 @capacitor/splash-screen@^6 @capacitor/status-bar@^6

# 3. add the platform and copy the web build into it
npx cap add android
npx cap sync android

# 4. open in Android Studio to sign and build
npx cap open android
```

* `capacitor.config.json` is already committed: `webDir: "dist"`, app id `com.yaar.companion`,
  splash + status-bar colours matching the design, and `Keyboard.resize: "body"`.
* Icons/splash: replace `android/app/src/main/res/mipmap-*` and `drawable/splash.png` with the
  generated artwork in `client/public/icons/` (`icon-1024.png` is the store-sized source).
* The WebView keeps the same anonymous identity because the device id lives in `localStorage`
  inside the app sandbox.
* Full submission checklist, data-safety answers, content rating notes and signing steps:
  **[`docs/PLAY_STORE.md`](docs/PLAY_STORE.md)**.

## 20. Security notes

* **The Hugging Face key never leaves the server.** It is read from `HUGGINGFACE_API_KEY` in
  `server/config.js` (server-side only) and used by the AI client as a bearer header on the outgoing
  provider request. No `VITE_*` variable ever holds a secret, the CSP restricts `connect-src` to the
  app's own origin, and `tests/client/secretHandling.test.jsx` fails the build if a client file ever
  touches a server-only variable or contains a credential-shaped string.
* **`.env` is git-ignored** (`.env`, `.env.*`, `!.env.example`); `.env.example` contains
  placeholders only. Never commit real keys — if one leaks, rotate it in the HF dashboard.
* **Secrets the server needs:** `HUGGINGFACE_API_KEY` (alias: `HF_API_KEY`), `SESSION_SECRET`
  (and `OPENAI_COMPATIBLE_API_KEY` when that provider is used). Everything else is configuration.
* **Automated leak detection:** `npm run check:secrets` scans every tracked file and the built
  bundle for `hf_…`/`sk-…`/`AWS`/`Google` credential patterns, asserts `.env.example` holds only
  empty placeholders, proves `.env` is ignored, and verifies the client never reads a server-only
  variable. It runs first and last in `npm run verify`, so a leak fails CI before it ships.
* **Input handling:** messages are Unicode-NFC-normalised, control characters stripped, length
  capped (2000 chars), and rendered as React text nodes (no `dangerouslySetInnerHTML` anywhere),
  so injected markup is displayed literally instead of executed.
* **Ownership checks:** every conversation/message read or write is scoped by user id in SQL.
* **Rate limiting:** 30 chat requests/min and 120 API requests/min per identity (in-memory
  sliding window) on top of the product limit, to blunt scripted abuse.
* **Headers:** CSP, `X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options` (set from
  `FRAME_ANCESTORS`), `X-Powered-By` disabled, JSON body limit 64 kB.
* **Sessions:** the cookie is `httpOnly`, `sameSite=lax`, `secure` in production and signed with
  `SESSION_SECRET`; the device-id header is validated by pattern and hashed with HMAC-SHA256 before
  it becomes a user id.
* **No stack traces to users:** all thrown errors pass through `middleware/errorHandler.js`, which
  logs details server-side and returns `{ error: { code, message } }` with human copy from
  `shared/errors.js`.

## 21. Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| “Yaar is not connected to an AI yet” | `HUGGINGFACE_API_KEY` is missing/empty in `.env`. Set it and restart. |
| Every send shows “I couldn't reply just now…” | Provider outage, wrong model, or a token without *Inference Providers* permission. Run `npm run check:ai` and read the server log line `ai http error` (status + body snippet). |
| 401/403 from the provider | Token revoked or missing the Inference Providers permission — create a new one. |
| 404/400/503 from the provider | Model unavailable for your account/provider routing. Try another `HF_MODEL`, or pin a provider (`HF_INFERENCE_PROVIDER=together`). |
| Replies take too long | Raise `HF_TIMEOUT_MS` / `HF_IDLE_TIMEOUT_MS`, or switch to a smaller model. |
| “Slow down a little 😅” | The per-minute rate limit was hit; wait a few seconds (product limit is separate). |
| Limit reached but it should have reset | The window is rolling (first message + 24 h), not midnight-based. Settings shows the exact reset time. For local testing: `POST /api/chat/dev/reset-usage` (dev only) or delete `data/yaar.sqlite`. |
| Counter looks wrong after clearing site data | The device id was regenerated, so a new anonymous user started. Expected, and how anonymity works before real login. |
| `EADDRINUSE` on start | Another process owns the port: `PORT=8788 npm start`. |
| Client shows the “API is running” page | The client has not been built. Use `npm run dev` (Vite) or `npm run build`. |
| Vite/API disagreement in dev | `npm run dev` proxies `/api`; if you changed `PORT`, restart `npm run dev` so the proxy target follows. |
| `better-sqlite3` install failure | Needs a Node version with matching prebuilds (Node 20/22). Reinstall with `npm rebuild better-sqlite3`. |
| `npm install` fails in `node-gyp` with `ECONNRESET` while fetching Node headers | The sandbox has no access to nodejs.org. `better-sqlite3` ships prebuilt binaries inside the npm tarball, so `npm ci --ignore-scripts` installs everything and the prebuild is used automatically. |
| Keyboard covers the composer (iOS) | Ensure the iOS 15.4+ viewport behaviour is present (`interactive-widget` + `useVisualViewport`); in the Capacitor app set `Keyboard.resize: "body"` (already configured). |
| Tests fail with “Cannot find module” | Run from the repository root (`npm run test`), and make sure `npm install` completed. |

## 22. Roadmap / what is left before store submission

Implemented and tested; the remaining work is operational rather than code:

1. **Real Hugging Face token** in production, and a decision on the paid tier for expected volume.
2. **Deploy the API over HTTPS** on a persistent host with a volume for `data/yaar.sqlite`, then set
   `VITE_API_BASE_URL` and rebuild the client.
3. **Android packaging**: `npx cap add android`, icons/splash from `client/public/icons/`, signed
   AAB, `versionCode`/`versionName` bump. (Config is ready — see §19.)
4. **Play Console paperwork**: store listing, screenshots, feature graphic, data-safety form,
   content rating, privacy-policy URL (the `/privacy` page text is ready to host).
5. **Optional but recommended before scale**: real authentication (the schema anticipates it),
   Postgres + Redis if running more than one instance, structured log shipping, and a moderation
   pass over user input (the personas already refuse harmful content, but server-side filtering is
   the next step for a public launch).
6. **Nice-to-have product work**: push notifications for “your Yaar is thinking of you”, message
   reactions, voice notes, and a supporter tier that raises the 20-message limit.

## 23. For the next developer or AI agent

Read these five files first — they contain 90 % of the app's intent:

1. `shared/companions.js` — personas, language rules and companion metadata (the product's voice).
2. `server/services/chatService.js` — the turn lifecycle (usage → persistence → AI → refund).
3. `server/services/usageService.js` — the 20/24 h rule and its atomic guarantees.
4. `server/services/ai/openaiCompatibleClient.js` — HTTP/SSE plumbing, reasoning filter, fallbacks.
5. `client/src/hooks/useChat.js` + `client/src/components/ChatComposer.jsx` — client state machine
   and the word-wrapping contract.

Working agreements in this repo:

* **Never** put a secret in `client/` or in a `VITE_*` variable.
* **Never** trust the client for usage/limits, and never count anything but accepted user messages.
* **Never** introduce `word-break: break-all` / `overflow-wrap: anywhere` — the CSS test will fail
  (deliberately).
* Keep the AI provider behind `server/services/ai/providers.js`; do not import a provider SDK into
  routes or services.
* Keep user-facing copy in `shared/errors.js` (errors) and the components (UI), not scattered as
  literals in handlers.
* When you change behaviour, extend the matching test and run `npm run verify` before committing.
* Commit style: short imperative subjects, e.g. `Add companion switching in settings`.

Useful entry points when extending:

| Task | Start here |
| --- | --- |
| Add a third companion | `shared/companions.js` (`COMPANIONS` + `COMPANION_IDS`), an avatar in `client/public/avatars/`, and `companionIdSchema` in `server/validation/schemas.js` |
| Change the message limit | `DAILY_MESSAGE_LIMIT` in `.env` (no code change); UI reads it from `/api/session` |
| Add real authentication | `server/middleware/session.js` (issue the id from the auth subject) + `users.auth_provider/auth_subject` |
| Add a new AI provider | `server/services/ai/providers.js` + `.env.example` |
| Add a settings screen section | `client/src/pages/SettingsPage.jsx` (uses `.setting-row` styles) |
| Add another API endpoint | a `server/routes/*.js` file + a zod schema + a method in `client/src/api/yaarApi.js` |

---

Built with care 💛 — Yaar is an AI companion, not a human, and the app is honest about that
everywhere it matters.
