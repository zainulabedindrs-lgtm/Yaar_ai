/**
 * App-level integration test: the whole client against a stubbed fetch.
 *
 * This is the closest thing to "open the app and use it" that can run without a
 * browser. It exercises the real router, the real session provider, the real
 * chat hook and the real components — only the network boundary is stubbed —
 * and asserts the user-visible behaviour:
 *
 *   home → start chat → companion greeting → send → streamed reply → limit
 */

import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import App from '../../client/src/App.jsx';

const COMPANIONS = [
  {
    id: 'girlfriend',
    mode: 'girlfriend',
    label: 'Your Girlfriend',
    displayName: 'Ayesha',
    tagline: 'Warm, caring and a little playful',
    description: 'The one who asks about your day and actually listens.',
    traits: ['Caring', 'Playful', 'Good listener'],
    accent: '#ff5f8f',
    avatar: '/avatars/ayesha.webp',
    avatarFallback: '/avatars/ayesha.png',
    status: 'Always here for you',
    theme: { from: '#ff8fb1', to: '#ff5f8f' },
  },
  {
    id: 'boyfriend',
    mode: 'boyfriend',
    label: 'Your Boyfriend',
    displayName: 'Hamza',
    tagline: 'Friendly, supportive and easy to talk to',
    description: 'The calm one who keeps it real.',
    traits: ['Supportive', 'Funny', 'Never judges'],
    accent: '#3f8cff',
    avatar: '/avatars/hamza.webp',
    avatarFallback: '/avatars/hamza.png',
    status: 'Here whenever you need',
    theme: { from: '#7cb0ff', to: '#3f8cff' },
  },
];

const APP_META = {
  name: 'Yaar',
  version: '1.0.0',
  tagline: 'Someone to talk to, anytime.',
  dailyMessageLimit: 20,
  usageWindowHours: 24,
  privacyPath: '/privacy',
  termsPath: '/terms',
};

function json(body, status = 200) {
  return Promise.resolve(
    new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    }),
  );
}

/** Builds an SSE response body for a streamed reply. */
function sse(frames) {
  const encoder = new TextEncoder();
  const body = new ReadableStream({
    start(controller) {
      for (const frame of frames) controller.enqueue(encoder.encode(frame));
      controller.close();
    },
  });
  return Promise.resolve(new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } }));
}

function frame(event, data) {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
}

/**
 * A tiny fake Yaar server: enough state to answer the endpoints the client
 * calls, including a real usage counter and the 429 behaviour.
 */
function createFakeServer({ limit = 20 } = {}) {
  const state = {
    used: 0,
    resetAt: Date.now() + 24 * 60 * 60 * 1000,
    messages: [
      {
        id: 'greeting-1',
        conversationId: 'conversation-1',
        sender: 'assistant',
        content: 'Hii, tum aagaye 🥰 Tell me everything — your day kaisa tha?',
        status: 'sent',
        errorCode: null,
        createdAt: Date.now(),
        seq: 1,
      },
    ],
    calls: [],
  };

  const usage = () => ({
    limit,
    used: state.used,
    remaining: Math.max(0, limit - state.used),
    windowHours: 24,
    windowStartedAt: state.resetAt - 24 * 60 * 60 * 1000,
    resetAt: state.resetAt,
    msUntilReset: state.resetAt - Date.now(),
    exhausted: state.used >= limit,
  });

  const fetchMock = vi.fn((url, init = {}) => {
    const path = String(url);
    const method = init.method ?? 'GET';
    state.calls.push(`${method} ${path}`);

    if (path.endsWith('/api/session')) {
      return json({
        user: { ref: 'abc123def456', displayName: null, createdAt: Date.now(), isAnonymous: true },
        usage: usage(),
        companions: COMPANIONS,
        conversations: [],
        ai: { provider: 'huggingface', label: 'Hugging Face', model: 'Qwen/Qwen3-8B', configured: true },
        app: APP_META,
      });
    }

    if (path.includes('/conversations/') && path.includes('/messages')) {
      return json({
        conversation: { id: 'conversation-1', companionId: 'girlfriend', messageCount: state.messages.length },
        messages: state.messages,
        hasMore: false,
        usage: usage(),
      });
    }

    if (path.includes('/chat/') && path.includes('/messages')) {
      const body = JSON.parse(init.body ?? '{}');
      if (state.used >= limit) {
        return json(
          {
            error: {
              code: 'daily_limit_reached',
              message: "That's all 20 messages for now 💛\nCome back after 24 hours and we'll continue our conversation.",
              details: { usage: usage() },
            },
          },
          429,
        );
      }

      state.used += 1;
      const userMessage = {
        id: body.clientMessageId,
        conversationId: 'conversation-1',
        sender: 'user',
        content: body.content,
        status: 'sent',
        errorCode: null,
        createdAt: Date.now(),
        seq: state.messages.length + 1,
      };
      const assistantMessage = {
        id: `assistant-${state.used}`,
        conversationId: 'conversation-1',
        sender: 'assistant',
        content: 'That sounds like a lot 💛 tell me more?',
        status: 'sent',
        errorCode: null,
        createdAt: Date.now(),
        seq: userMessage.seq + 1,
      };
      state.messages.push(userMessage, assistantMessage);

      if (body.stream === false) {
        return json({
          conversation: { id: 'conversation-1', companionId: 'girlfriend' },
          userMessage,
          assistantMessage,
          usage: usage(),
        });
      }

      return sse([
        frame('meta', { conversation: { id: 'conversation-1' }, userMessage, usage: usage() }),
        frame('delta', { text: 'That sounds like' }),
        frame('delta', { text: ' a lot 💛 tell me more?' }),
        frame('done', { assistantMessage, usage: usage() }),
      ]);
    }

    if (path.endsWith('/api/usage')) return json({ usage: usage() });

    return json({ error: { code: 'not_found', message: 'Not found' } }, 404);
  });

  return { fetchMock, state };
}

/** Clicks the Start/Continue button inside one companion card. */
async function startChat(user, companionId = 'girlfriend') {
  const card = await screen.findByTestId(`companion-card-${companionId}`);
  await user.click(within(card).getByRole('button', { name: /start chat|continue chat/i }));
}

function renderApp() {
  return render(
    <MemoryRouter initialEntries={['/']}>
      <App />
    </MemoryRouter>,
  );
}

let fake;

beforeEach(() => {
  fake = createFakeServer();
  vi.stubGlobal('fetch', fake.fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Yaar app flow', () => {
  it('shows the home screen with both companions and the usage meter', async () => {
    renderApp();

    expect(await screen.findByText('Your Girlfriend')).toBeInTheDocument();
    expect(screen.getByText('Your Boyfriend')).toBeInTheDocument();
    expect(screen.getByText('Ayesha')).toBeInTheDocument();
    expect(screen.getByText('Hamza')).toBeInTheDocument();
    expect(screen.getByText('0 / 20 messages used')).toBeInTheDocument();
    expect(screen.getByText(/Someone to talk to/)).toBeInTheDocument();
  });

  it('opens the chat with the companion greeting and an online status', async () => {
    const user = userEvent.setup();
    renderApp();

    await startChat(user);

    expect(await screen.findByText(/Tell me everything/)).toBeInTheDocument();
    expect(screen.getByText('Always here for you')).toBeInTheDocument();
    expect(screen.getByLabelText('Message')).toBeInTheDocument();
  });

  it('sends a message, streams the reply and updates the usage counter', async () => {
    const user = userEvent.setup();
    renderApp();

    await startChat(user);
    const input = await screen.findByLabelText('Message');

    await user.type(input, 'I had a long day today{Enter}');

    // The user's own message appears immediately (optimistic bubble).
    expect(await screen.findByText('I had a long day today')).toBeInTheDocument();

    // Then the streamed reply.
    await waitFor(() =>
      expect(screen.getByText(/That sounds like a lot 💛 tell me more\?/)).toBeInTheDocument(),
    );

    // The counter in the chat header reflects the accepted message.
    const header = screen.getByRole('banner');
    await waitFor(() => expect(within(header).getByText('1 / 20')).toBeInTheDocument());
    expect(input).toHaveValue('');
  });

  it('keeps the conversation after a reload and lets the user continue', async () => {
    const user = userEvent.setup();
    const first = renderApp();

    await startChat(user);
    await user.type(await screen.findByLabelText('Message'), 'hello before reload{Enter}');
    await waitFor(() => expect(screen.getByText('hello before reload')).toBeInTheDocument());

    first.unmount();

    // Same fake server = same stored conversation.
    renderApp();
    await startChat(user);

    expect(await screen.findByText('hello before reload')).toBeInTheDocument();
    expect(screen.getByText(/That sounds like a lot/)).toBeInTheDocument();
    const header = screen.getByRole('banner');
    await waitFor(() => expect(within(header).getByText('1 / 20')).toBeInTheDocument());
  });

  it('shows the friendly limit notice and disables the composer at 20 messages', async () => {
    const user = userEvent.setup();
    fake = createFakeServer({ limit: 1 });
    vi.stubGlobal('fetch', fake.fetchMock);

    renderApp();
    await startChat(user);

    const input = await screen.findByLabelText('Message');
    await user.type(input, 'my one and only message{Enter}');

    await waitFor(() => expect(screen.getByTestId('limit-notice')).toBeInTheDocument());
    expect(screen.getByText(/That's all 1 messages for now/)).toBeInTheDocument();
    expect(screen.getByText(/Come back after 24 hours/)).toBeInTheDocument();

    // The composer is replaced: the user cannot send #21 from the UI…
    expect(screen.queryByLabelText('Message')).not.toBeInTheDocument();
    // …and the conversation is still on screen.
    expect(screen.getByText('my one and only message')).toBeInTheDocument();
  });

  it('shows a friendly banner when the AI provider fails, and keeps the text for a retry', async () => {
    const user = userEvent.setup();
    const failing = vi.fn((url, init = {}) => {
      const path = String(url);
      if (path.includes('/chat/') && path.includes('/messages')) {
        return json(
          {
            error: {
              code: 'ai_unavailable',
              message: "I couldn't reply just now — something on my side hiccuped. Try again in a moment?",
              details: { usage: { limit: 20, used: 0, remaining: 20, resetAt: Date.now() + 1000, msUntilReset: 1000, exhausted: false } },
            },
          },
          502,
        );
      }
      return fake.fetchMock(url, init);
    });
    vi.stubGlobal('fetch', failing);

    renderApp();
    await startChat(user);
    await user.type(await screen.findByLabelText('Message'), 'are you there?{Enter}');

    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(/couldn't reply just now/i);
    expect(alert).not.toHaveTextContent('ai_unavailable');
    expect(alert).not.toHaveTextContent(/at Object|stack/i);

    // The message is still visible with a retry affordance.
    expect(screen.getByText('are you there?')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /retry this message/i })).toBeInTheDocument();
  });

  it('renders the settings, about, privacy and terms screens without errors', async () => {
    const user = userEvent.setup();
    renderApp();
    await screen.findByText('Your Girlfriend');

    const navigate = async (name) => {
      const link = screen.getByRole('link', { name });
      await user.click(link);
    };

    await navigate('Settings');
    expect(await screen.findByRole('heading', { name: 'Settings' })).toBeInTheDocument();
    expect(screen.getByText('Chat usage')).toBeInTheDocument();
    expect(screen.getByText('Your session')).toBeInTheDocument();

    await navigate('About');
    expect(await screen.findByRole('heading', { name: 'About Yaar' })).toBeInTheDocument();
    expect(screen.getByText(/Yaar is an AI, not a person/i)).toBeInTheDocument();
  });
});

describe('usage meter inside the chat header', () => {
  it('renders the remaining count in the chat header chip', async () => {
    const user = userEvent.setup();
    renderApp();
    await startChat(user);

    const header = await screen.findByRole('banner');
    expect(within(header).getByText('0 / 20')).toBeInTheDocument();
  });
});
