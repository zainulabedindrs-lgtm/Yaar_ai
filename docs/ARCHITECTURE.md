# Yaar — architecture notes

A short, precise companion to the README for anyone making structural changes. The README explains
*what* the app does; this file explains *why* it is shaped this way, so changes stay coherent.

## Layers

```
client/src/api        transport only (fetch + SSE). Knows nothing about React.
client/src/hooks      state machines (session, chat) + browser APIs (viewport, online, scroll).
client/src/components pure presentational pieces; no network access.
client/src/pages      composition of hooks + components; routing targets.

server/routes         HTTP shape: parse → call a service → serialise. No business logic.
server/services       business rules: chatService (turns), usageService (limits), ai/* (provider).
server/db             persistence: schema + one repository per table.
server/middleware     cross-cutting: identity, rate limiting, error mapping.
shared/               the only code imported by both sides: personas, error copy, limits.
```

Rules that keep it navigable:

* **Routes never touch SQL.** They call a service; services call repositories.
* **Repositories never contain rules.** They are thin wrappers over prepared statements.
* **The AI provider is never imported outside `server/services/ai/`** — everything else asks the
  factory for a chat client.
* **The client never decides anything security- or usage-related.** It mirrors server state.
* **User-facing copy lives in `shared/errors.js` or the component that renders it**, never in a
  route handler.

## The chat turn (the core flow)

```
POST /api/chat/:companionId/messages
  ├─ route: validate companion id, zod body, sanitise content
  ├─ chatService.beginTurn  ────────────── one better-sqlite3 transaction ──┐
  │     ├─ usersRepo.ensureUser (idempotent)                               │
  │     ├─ conversationsRepo.getOrCreateConversation                      │
  │     ├─ chatService.ensureGreeting (assistant, never counted)          │
  │     ├─ usageService.consumeMessage  → throws 429 daily_limit_reached  │
  │     └─ messagesRepo.insertMessage(user)                               │
  │   commit ─────────────────────────────────────────────────────────────┘
  ├─ SSE `meta`  (conversation, userMessage, usage)
  ├─ chatService.requestAiReply (streaming, fallback models, abortable)
  │     └─ deltas → SSE `delta` frames
  ├─ on success: chatService.saveAssistantReply → SSE `done`
  ├─ on partial:  save what the user saw        → SSE `done` (truncated)
  └─ on empty:    chatService.refundTurn        → SSE `error` (friendly code)
```

Why this order matters:

1. The message is **counted and stored together** — no in-between state where a message costs a
   credit but does not exist, or exists but is not counted.
2. The user message exists **before** the AI is contacted, so the UI can render it optimistically
   and a crash mid-reply still leaves a coherent transcript.
3. The reply is stored **before** the `done` event, so a refresh can never show a reply that
   disappears, or lose one that was shown.

## Identity model

* The client generates one random **device id** and stores it in `localStorage`.
* Every request sends it as `x-yaar-device-id` **and** the browser sends the signed session cookie.
* The server prefers the device id: `userId = HMAC_SHA256(SESSION_SECRET, "device:" + deviceId)`.
  This makes identity **deterministic** (same device → same user, even without cookies) and keeps
  raw client values out of the database.
* `users.auth_provider` / `auth_subject` are reserved for real authentication. When that arrives,
  `middleware/session.js` resolves the user id from the auth subject instead, and nothing else
  changes — usage, conversations and messages are all keyed by `user_id` already.

## Failure taxonomy

Everything the client can see comes from `shared/errors.js`. Server-side:

| Layer | Behaviour |
| --- | --- |
| Provider HTTP | `openaiCompatibleClient.#mapHttpError` → 401/403 → `ai_not_configured`, 429 → `rate_limited`, 4xx/5xx → `ai_unavailable` |
| Timeouts | Explicit `timedOut` flag (never inferred from the abort error) → `ai_timeout` (504) |
| Empty reply | `ai_empty_response` |
| Client disconnect | `res.on('close')` before `finish` → abort the provider call, refund the message |
| App errors | `ApiError` → `middleware/errorHandler.js` → `{ error: { code, message, details } }` |
| Unknown crashes | Logged with a short stack; the client receives `server_error` copy only |

The client maps the same codes to copy via `friendlyMessageFor()` when the server does not send a
message, so a user never reads a raw code, a provider payload or a stack trace.

## Performance decisions

* **One boot request.** `GET /api/session` returns identity + usage + companions + conversations +
  AI status, so the home screen has no waterfall.
* **Code splitting.** Home is eagerly bundled; chat, settings and the legal pages are lazy chunks
  (see `client/src/App.jsx`), and the vendor libraries are split into `react`/`router` chunks.
* **Memoised bubbles.** `MessageBubble` is `React.memo`'d because a streaming reply re-renders the
  list many times per second.
* **Windowed history.** The API returns the newest 200 messages by default and supports
  `?before=` pagination for older ones; the prompt builder trims to ~24 messages / ~9 000 characters.
* **No polling.** Usage and history update from the SSE payloads; the only timer is a 30 s
  countdown tick that runs solely while the limit card is visible.
* **Prepared statements + transactions** everywhere in the data layer; SQLite runs in WAL mode with
  `synchronous = NORMAL`.

## Extending safely

| Change | Touch points |
| --- | --- |
| New companion | `shared/companions.js`, avatar in `client/public/avatars/`, `companionIdSchema` |
| New AI provider | `server/services/ai/providers.js` (+ `.env.example`) and a test in `tests/server/aiProvider.test.js` |
| New endpoint | `server/routes/*.js`, a zod schema in `server/validation/schemas.js`, a method in `client/src/api/yaarApi.js`, and a test in `tests/server/chatFlow.test.js` |
| New screen | `client/src/pages/*.jsx`, a lazy route in `App.jsx`, a nav entry in `components/BottomNav.jsx` |
| Schema change | `server/db/schema.sql` + a migration step in `server/db/database.js` (bump `SCHEMA_VERSION`) and repository updates |

Before committing anything structural: `npm run verify` (138 unit/integration tests, production
build, 41 end-to-end smoke checks).
