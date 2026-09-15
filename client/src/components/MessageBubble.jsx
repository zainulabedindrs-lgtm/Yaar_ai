import { memo } from 'react';

import { ERROR_CODES } from '@shared/errors';

import { formatMessageTime } from '../utils/format.js';
import { AlertIcon, RefreshIcon } from './icons.jsx';

/**
 * One chat bubble.
 *
 * Memoised because a streaming reply re-renders the list ~10x per second and
 * older bubbles must not be recalculated (see "Performance" in the README).
 */
export const MessageBubble = memo(function MessageBubble({ message, companion, onRetry }) {
  const isUser = message.sender === 'user';
  const isStreaming = message.status === 'streaming';
  const isFailed = message.status === 'failed';

  const classNames = [
    'bubble',
    isUser ? 'bubble--user' : 'bubble--assistant',
    isFailed ? 'bubble--failed' : '',
  ]
    .filter(Boolean)
    .join(' ');

  const showRetry =
    isFailed &&
    onRetry &&
    // A message that never reached the server can simply be resent; a message
    // that was accepted but got no reply is regenerated without using a credit.
    (message.errorCode === ERROR_CODES.NETWORK ||
      message.errorCode === ERROR_CODES.AI_UNAVAILABLE ||
      message.errorCode === ERROR_CODES.AI_TIMEOUT ||
      message.errorCode === ERROR_CODES.AI_EMPTY ||
      !message.errorCode);

  return (
    <div className={`message-row ${isUser ? 'message-row--user' : ''}`.trim()}>
      <div
        className={classNames}
        dir="auto"
        // Announce streamed replies to screen readers once they are complete.
        aria-live={isUser ? 'off' : 'polite'}
      >
        {message.content ? (
          <span>{message.content}</span>
        ) : isStreaming ? (
          <span className="typing" aria-label={`${companion?.displayName ?? 'Yaar'} is typing`}>
            <span className="typing__dot" />
            <span className="typing__dot" />
            <span className="typing__dot" />
          </span>
        ) : null}

        <div className="bubble__meta">
          {isFailed ? (
            <span className="bubble__flag" title="This message was not delivered">
              <AlertIcon style={{ verticalAlign: '-2px', marginRight: 3 }} />
              not delivered
            </span>
          ) : (
            <span>{formatMessageTime(message.createdAt)}</span>
          )}
          {message.status === 'sending' ? <span>Sending…</span> : null}
        </div>
      </div>

      {showRetry ? (
        <button
          type="button"
          className="icon-button"
          onClick={onRetry}
          aria-label="Retry this message"
          title="Try again"
        >
          <RefreshIcon width={18} height={18} />
        </button>
      ) : null}
    </div>
  );
});

export default MessageBubble;
