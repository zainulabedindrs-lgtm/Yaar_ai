import { useCallback, useEffect, useMemo } from 'react';
import { useNavigate, useParams } from 'react-router-dom';

import { ERROR_CODES, LAST_COMPANION_STORAGE_KEY } from '@shared/errors';

import Avatar from '../components/Avatar.jsx';
import ChatComposer from '../components/ChatComposer.jsx';
import ErrorBanner from '../components/ErrorBanner.jsx';
import LimitNotice from '../components/LimitNotice.jsx';
import MessageList from '../components/MessageList.jsx';
import { ChatSkeleton, EmptyState } from '../components/States.jsx';
import { ArrowLeftIcon, RefreshIcon, SettingsIcon } from '../components/icons.jsx';
import { ROUTES } from '../config/appConfig.js';
import { useAutoScroll } from '../hooks/useAutoScroll.js';
import { useChat } from '../hooks/useChat.js';
import { useCompanion, useSession } from '../hooks/useSession.jsx';
import { useVisualViewport } from '../hooks/useVisualViewport.js';
import { writeStorage } from '../utils/storage.js';

/** Failures that are worth retrying straight from the banner. */
const RETRYABLE_CODES = new Set([
  ERROR_CODES.NETWORK,
  ERROR_CODES.AI_UNAVAILABLE,
  ERROR_CODES.AI_TIMEOUT,
  ERROR_CODES.AI_EMPTY,
  ERROR_CODES.RATE_LIMITED,
]);

/**
 * Chat screen.
 *
 * Layout: a full-height column — sticky header, the scrolling message list, and
 * the composer pinned at the bottom (kept above the mobile keyboard by
 * `useVisualViewport` and the `dvh`-based shell).
 */
export function ChatPage() {
  const { companionId } = useParams();
  const navigate = useNavigate();
  const companion = useCompanion(companionId);
  const { status: sessionStatus } = useSession();

  useVisualViewport();

  const chat = useChat(companionId);
  const {
    messages,
    usage,
    loading,
    sending,
    error,
    loadError,
    limitReached,
    awaitingReply,
    canSend,
    send,
    retry,
    regenerate,
    stop,
    reload,
    dismissError,
  } = chat;

  const lastMessage = messages[messages.length - 1];
  const { containerRef, scrollToBottom, atBottom } = useAutoScroll({
    deps: [messages.length, lastMessage?.content, sending],
    streaming: sending,
  });

  // Remember the last companion so Settings and the nav can point back to it.
  useEffect(() => {
    if (companionId) writeStorage(LAST_COMPANION_STORAGE_KEY, companionId);
  }, [companionId]);

  // Unknown companion in the URL → back home (never a dead screen).
  useEffect(() => {
    if (sessionStatus === 'ready' && !companion) navigate(ROUTES.home, { replace: true });
  }, [companion, navigate, sessionStatus]);

  const handleSend = useCallback(
    (text) => {
      scrollToBottom('smooth');
      send(text);
    },
    [scrollToBottom, send],
  );

  const composerHint = useMemo(() => {
    if (sending) return 'Replying…';
    if (limitReached) return 'Daily limit reached';
    return '';
  }, [limitReached, sending]);

  const counterText = usage ? `${usage.used} / ${usage.limit}` : '';
  const counterTone = usage?.exhausted ? 'out' : usage && usage.remaining <= 5 ? 'low' : '';

  if (!companion) {
    return (
      <div className="container">
        <ChatSkeleton />
      </div>
    );
  }

  return (
    <div className="chat" data-accent={companion.id}>
      <header className="topbar">
        <button
          type="button"
          className="icon-button"
          onClick={() => navigate(ROUTES.home)}
          aria-label="Back to home"
        >
          <ArrowLeftIcon />
        </button>

        <Avatar companion={companion} size="md" presence />

        <div className="topbar__body">
          <div className="topbar__title">
            {companion.displayName}
            <span className="chip chip--accent" style={{ fontSize: 11 }}>
              {usage ? `${usage.used} / ${usage.limit}` : 'free'}
            </span>
          </div>
          <div className="topbar__subtitle">
            <span className="online-dot" aria-hidden="true" />
            {sending ? 'typing…' : companion.status}
          </div>
        </div>

        <button
          type="button"
          className="icon-button"
          onClick={() => navigate(ROUTES.settings)}
          aria-label="Settings"
        >
          <SettingsIcon width={19} height={19} />
        </button>
      </header>

      {loading ? (
        <div className="chat__scroll" ref={containerRef}>
          <ChatSkeleton />
        </div>
      ) : loadError ? (
        <div className="chat__scroll" ref={containerRef}>
          <ErrorBanner error={loadError} onRetry={reload} />
        </div>
      ) : messages.length === 0 ? (
        <div className="chat__scroll" ref={containerRef}>
          <EmptyState
            emoji="👋"
            title={`Say hi to ${companion.displayName}`}
            description="Type anything — your day, a random thought, or just a hello."
          />
        </div>
      ) : (
        <MessageList
          messages={messages}
          companion={companion}
          containerRef={containerRef}
          showTyping={sending && lastMessage?.sender === 'user'}
          atBottom={atBottom}
          onJumpToLatest={() => scrollToBottom('smooth')}
          onRetry={retry}
        />
      )}

      <div className="chat__footer">
        {error ? (
          <div style={{ padding: '10px 12px 0' }}>
            <ErrorBanner
              error={error}
              onRetry={RETRYABLE_CODES.has(error.code) ? retry : undefined}
              onDismiss={dismissError}
            />
          </div>
        ) : null}

        {awaitingReply && !sending && !error ? (
          <div style={{ padding: '10px 12px 0' }}>
            <div className="banner banner--info">
              <div className="banner__body">
                <div>No reply came through for your last message.</div>
                <div className="banner__actions">
                  <button type="button" className="button button--sm button--soft" onClick={regenerate}>
                    <RefreshIcon width={16} height={16} />
                    Ask {companion.displayName} again
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        {limitReached ? (
          <div style={{ padding: '12px 12px 0' }}>
            <LimitNotice resetAt={usage?.resetAt} limit={usage?.limit ?? 20} />
          </div>
        ) : (
          <ChatComposer
            onSend={handleSend}
            onStop={stop}
            sending={sending}
            canSend={canSend}
            limitReached={limitReached}
            hint={composerHint}
            counterText={counterText}
            counterTone={counterTone}
            placeholder={`Message ${companion.displayName}…`}
          />
        )}

        {limitReached ? (
          <div className="composer__hint" style={{ padding: '8px 18px 12px' }}>
            <span>
              {usage?.used} / {usage?.limit} messages used
            </span>
            <span>Your chat is saved 💛</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default ChatPage;
