/**
 * `useChat` — the client-side chat state machine.
 *
 * These tests pin the behaviours that make the chat feel trustworthy:
 * optimistic bubbles, streaming, failure handling that never loses the user's
 * text, idempotent retries, the local limit guard, and history loading that does
 * not clobber a message sent while it was still loading.
 */

import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SessionProvider } from '../../client/src/hooks/useSession.jsx';
import { useChat } from '../../client/src/hooks/useChat.js';

/** Renders the hook inside the session provider (useChat depends on it). */
function Harness({ companionId = 'girlfriend' }) {
  const chat = useChat(companionId);

  return (
    <div>
      <span data-testid="loading">{String(chat.loading)}</span>
      <span data-testid="sending">{String(chat.sending)}</span>
      <span data-testid="used">{chat.usage?.used ?? 'none'}</span>
      <span data-testid="limit">{String(chat.limitReached)}</span>
      <span data-testid="error">{chat.error?.code ?? 'none'}</span>
      <ul data-testid="messages">
        {chat.messages.map((message) => (
          <li key={message.id} data-status={message.status} data-sender={message.sender}>
            {message.content}
          </li>
        ))}
      </ul>
      <button type="button" onClick={() => chat.send('hello there')}>
        send
      </button>
      <button type="button" onClick={() => chat.retry()}>
        retry
      </button>
      <button type="button" onClick={() => chat.regenerate()}>
        regenerate
      </button>
      <button type="button" onClick={() => chat.stop()}>
        stop
      </button>
    </div>
  );
}

function renderChat(companionId = 'girlfriend') {
  return render(
    <SessionProvider>
      <Harness companionId={companionId} />
    </SessionProvider>,
  );
}

function json(body, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }),
  );
}

function sse(frames) {
  const encoder = new TextEncoder();
  return Promise.resolve(
    new Response(
      new ReadableStream({
        start(controller) {
          for (const frame of frames) controller.enqueue(encoder.encode(frame));
          controller.close();
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ),
  );
}

const frame = (event, data) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;

const USAGE = (used = 0, limit = 20) => ({
  limit,
  used,
  remaining: Math.max(0, limit - used),
  windowHours: 24,
  windowStartedAt: Date.now(),
  resetAt: Date.now() + 86_400_000,
  msUntilReset: 86_400_000,
  exhausted: used >= limit,
});

const SESSION = {
  user: { ref: 'ref', displayName: null, createdAt: Date.now(), isAnonymous: true },
  usage: USAGE(0),
  companions: [
    { id: 'girlfriend', displayName: 'Ayesha', label: 'Your Girlfriend', avatar: '/a.jpg' },
    { id: 'boyfriend', displayName: 'Hamza', label: 'Your Boyfriend', avatar: '/b.jpg' },
  ],
  conversations: [],
  ai: { provider: 'huggingface', model: 'm', configured: true },
  app: { name: 'Yaar', version: '1.0.0', dailyMessageLimit: 20 },
};

const HISTORY = (messages) => ({
  conversation: { id: 'c1', companionId: 'girlfriend' },
  messages,
  hasMore: false,
  usage: USAGE(0),
});

const greeting = {
  id: 'greeting',
  conversationId: 'c1',
  sender: 'assistant',
  content: 'Hii, tum aagaye 🥰',
  status: 'sent',
  errorCode: null,
  createdAt: Date.now(),
  seq: 1,
};

const usedRow = (id, content, sender = 'user', seq = 2) => ({
  id,
  conversationId: 'c1',
  sender,
  content,
  status: 'sent',
  errorCode: null,
  createdAt: Date.now(),
  seq,
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('useChat — history', () => {
  it('loads history on mount and exposes usage', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url) => {
        if (String(url).endsWith('/api/session')) return json(SESSION);
        return json(HISTORY([greeting, usedRow('u1', 'earlier message')]));
      }),
    );

    renderChat();

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByText('Hii, tum aagaye 🥰')).toBeInTheDocument();
    expect(screen.getByText('earlier message')).toBeInTheDocument();
  });

  it('keeps a message sent while the history was still loading', async () => {
    const user = userEvent.setup();
    let resolveHistory;
    const historyGate = new Promise((resolve) => {
      resolveHistory = resolve;
    });

    vi.stubGlobal(
      'fetch',
      vi.fn((url) => {
        const path = String(url);
        if (path.endsWith('/api/session')) return json(SESSION);
        if (path.includes('/chat/')) {
          return sse([
            frame('meta', {
              userMessage: usedRow('client-message-id-1', 'hello there'),
              usage: USAGE(1),
            }),
            frame('done', {
              assistantMessage: usedRow('assistant-1', 'hi!', 'assistant', 3),
              usage: USAGE(1),
            }),
          ]);
        }
        // History resolves only after the send has happened.
        return historyGate.then(() => json(HISTORY([greeting])));
      }),
    );

    renderChat();

    // Send before the history request has resolved.
    await user.click(screen.getByRole('button', { name: 'send' }));
    await waitFor(() => expect(screen.getByText('hello there')).toBeInTheDocument());

    // Now let the (stale) history arrive: the message must survive.
    resolveHistory();

    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));
    expect(screen.getByText('hello there')).toBeInTheDocument();
    expect(screen.getByText('hi!')).toBeInTheDocument();
    expect(screen.getByText('Hii, tum aagaye 🥰')).toBeInTheDocument();
  });
});

describe('useChat — sending', () => {
  it('renders the user bubble immediately, then streams the reply', async () => {
    const user = userEvent.setup();
    vi.stubGlobal(
      'fetch',
      vi.fn((url) => {
        const path = String(url);
        if (path.endsWith('/api/session')) return json(SESSION);
        if (path.includes('/chat/')) {
          return sse([
            frame('meta', { userMessage: usedRow('client-message-id-1', 'hello there'), usage: USAGE(1) }),
            frame('delta', { text: 'hey ' }),
            frame('delta', { text: 'you 💛' }),
            frame('done', {
              assistantMessage: usedRow('assistant-1', 'hey you 💛', 'assistant', 3),
              usage: USAGE(1),
            }),
          ]);
        }
        return json(HISTORY([greeting]));
      }),
    );

    renderChat();
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));

    await user.click(screen.getByRole('button', { name: 'send' }));

    // Optimistic bubble first...
    expect(screen.getByText('hello there')).toBeInTheDocument();
    // ...then the streamed reply, and the counter moves.
    await waitFor(() => expect(screen.getByText('hey you 💛')).toBeInTheDocument());
    expect(screen.getByTestId('used')).toHaveTextContent('1');
    expect(screen.getByTestId('sending')).toHaveTextContent('false');
  });

  it('marks the message as failed on an AI error and retries with the same id', async () => {
    const user = userEvent.setup();
    const sentClientIds = [];

    vi.stubGlobal(
      'fetch',
      vi.fn((url, init = {}) => {
        const path = String(url);
        if (path.endsWith('/api/session')) return json(SESSION);
        if (path.includes('/chat/')) {
          const body = JSON.parse(init.body ?? '{}');
          sentClientIds.push(body.clientMessageId);

          if (sentClientIds.length === 1) {
            return json(
              {
                error: {
                  code: 'ai_unavailable',
                  message: "I couldn't reply just now.",
                  details: { usage: USAGE(0) },
                },
              },
              502,
            );
          }
          return sse([
            frame('meta', { userMessage: usedRow(body.clientMessageId, 'hello there'), usage: USAGE(1) }),
            frame('done', {
              assistantMessage: usedRow('assistant-retry', 'welcome back 💛', 'assistant', 3),
              usage: USAGE(1),
            }),
          ]);
        }
        return json(HISTORY([greeting]));
      }),
    );

    renderChat();
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));

    await user.click(screen.getByRole('button', { name: 'send' }));

    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('ai_unavailable'));
    // The user's text stays on screen, marked as not delivered.
    const failed = await screen.findByText('hello there');
    expect(failed).toHaveAttribute('data-status', 'failed');

    await user.click(screen.getByRole('button', { name: 'retry' }));

    await waitFor(() => expect(screen.getByText('welcome back 💛')).toBeInTheDocument());
    expect(sentClientIds).toHaveLength(2);
    expect(sentClientIds[0]).toBe(sentClientIds[1]);
  });

  it('does not send when the daily limit is reached', async () => {
    const user = userEvent.setup();
    const chatCalls = [];

    vi.stubGlobal(
      'fetch',
      vi.fn((url) => {
        const path = String(url);
        if (path.endsWith('/api/session')) {
          return json({ ...SESSION, usage: USAGE(20) });
        }
        if (path.includes('/chat/')) {
          chatCalls.push(path);
          return json({ error: { code: 'daily_limit_reached' } }, 429);
        }
        return json({ ...HISTORY([greeting]), usage: USAGE(20) });
      }),
    );

    renderChat();
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));

    expect(screen.getByTestId('limit')).toHaveTextContent('true');
    await user.click(screen.getByRole('button', { name: 'send' }));

    // Guarded locally: no request is attempted, and the limit copy is shown.
    expect(chatCalls).toHaveLength(0);
    expect(screen.getByTestId('error')).toHaveTextContent('daily_limit_reached');
  });

  it('refuses to send an empty message', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn((url) => (String(url).endsWith('/api/session') ? json(SESSION) : json(HISTORY([greeting])))),
    );

    function EmptyHarness() {
      const chat = useChat('girlfriend');
      return (
        <div>
          <span data-testid="error">{chat.error?.code ?? 'none'}</span>
          <button type="button" onClick={() => chat.send('   ')}>
            send blank
          </button>
        </div>
      );
    }

    render(
      <SessionProvider>
        <EmptyHarness />
      </SessionProvider>,
    );

    await userEvent.setup().click(await screen.findByRole('button', { name: 'send blank' }));
    await waitFor(() => expect(screen.getByTestId('error')).toHaveTextContent('empty_message'));
  });

  it('regenerates a missing reply without spending a message', async () => {
    const user = userEvent.setup();
    const paths = [];

    vi.stubGlobal(
      'fetch',
      vi.fn((url) => {
        const path = String(url);
        paths.push(path);
        if (path.endsWith('/api/session')) return json(SESSION);
        if (path.includes('/regenerate')) {
          return sse([
            frame('done', {
              assistantMessage: usedRow('assistant-regen', 'sorry, I am here now 💛', 'assistant', 3),
              usage: USAGE(1),
            }),
          ]);
        }
        if (path.includes('/chat/')) {
          return sse([
            frame('meta', { userMessage: usedRow('client-message-id-1', 'hello there'), usage: USAGE(1) }),
            frame('done', { assistantMessage: usedRow('a1', 'first reply', 'assistant', 3), usage: USAGE(1) }),
          ]);
        }
        return json(HISTORY([greeting]));
      }),
    );

    renderChat();
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));

    await user.click(screen.getByRole('button', { name: 'regenerate' }));
    await waitFor(() => expect(screen.getByText('sorry, I am here now 💛')).toBeInTheDocument());
    expect(paths.at(-1)).toContain('/regenerate');
  });

  it('drops the empty reply bubble when the user stops the turn', async () => {
    const user = userEvent.setup();

    vi.stubGlobal(
      'fetch',
      vi.fn((url, init = {}) => {
        const path = String(url);
        if (path.endsWith('/api/session')) return json(SESSION);
        if (path.includes('/chat/')) {
          // A stream that opens and then stays silent until aborted.
          return Promise.resolve(
            new Response(
              new ReadableStream({
                start(controller) {
                  controller.enqueue(
                    new TextEncoder().encode(
                      frame('meta', { userMessage: usedRow('client-message-id-1', 'hello there'), usage: USAGE(1) }),
                    ),
                  );
                  init.signal?.addEventListener('abort', () => controller.error(new Error('aborted')));
                },
              }),
              { status: 200, headers: { 'content-type': 'text/event-stream' } },
            ),
          );
        }
        return json(HISTORY([greeting]));
      }),
    );

    renderChat();
    await waitFor(() => expect(screen.getByTestId('loading')).toHaveTextContent('false'));

    await user.click(screen.getByRole('button', { name: 'send' }));
    await waitFor(() => expect(screen.getByTestId('sending')).toHaveTextContent('true'));

    await user.click(screen.getByRole('button', { name: 'stop' }));

    await waitFor(() => expect(screen.getByTestId('sending')).toHaveTextContent('false'));
    // The user's message is kept; no empty reply bubble is left behind.
    expect(screen.getByText('hello there')).toBeInTheDocument();
    const items = screen.getAllByRole('listitem');
    expect(items.filter((item) => item.textContent === '')).toHaveLength(0);
  });
});
