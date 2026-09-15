import { useMemo } from 'react';

import { formatDayLabel, isDifferentDay } from '../utils/format.js';
import { MessageBubble } from './MessageBubble.jsx';
import { TypingIndicator } from './TypingIndicator.jsx';
import { ArrowDownIcon } from './icons.jsx';

/**
 * Scrollable message area.
 *
 * Layout notes:
 *  - day separators keep long histories readable
 *  - the "…typing" bubble appears between accepting a message and the first
 *    streamed token
 *  - the container is the scroll parent used by `useAutoScroll`
 *
 * @param {Object} props
 * @param {Array<any>} props.messages
 * @param {any} props.companion
 * @param {import('react').RefObject<HTMLDivElement>} props.containerRef
 * @param {boolean} props.showTyping
 * @param {boolean} props.atBottom
 * @param {() => void} props.onJumpToLatest
 * @param {() => void} props.onRetry
 */
export function MessageList({
  messages,
  companion,
  containerRef,
  showTyping,
  atBottom,
  onJumpToLatest,
  onRetry,
}) {
  const rows = useMemo(() => buildRows(messages), [messages]);

  return (
    <div className="chat__scroll" ref={containerRef} data-testid="chat-scroll">
      <div className="chat__list">
        {rows.map((row) =>
          row.type === 'day' ? (
            <div className="chat__day" key={row.key}>
              {row.label}
            </div>
          ) : (
            <MessageBubble
              key={row.message.id}
              message={row.message}
              companion={companion}
              onRetry={row.message.status === 'failed' ? onRetry : undefined}
            />
          ),
        )}

        {showTyping ? <TypingIndicator companion={companion} /> : null}
      </div>

      {!atBottom ? (
        <div style={{ position: 'sticky', bottom: 8, display: 'flex', justifyContent: 'flex-end' }}>
          <button
            type="button"
            className="icon-button"
            onClick={onJumpToLatest}
            style={{ boxShadow: 'var(--shadow-md)' }}
            aria-label="Jump to the latest message"
            title="Jump to the latest message"
          >
            <ArrowDownIcon />
          </button>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Flattens messages into a render list, inserting a day separator whenever the
 * calendar day changes.
 * @param {Array<{ id: string, createdAt: number }>} messages
 */
function buildRows(messages) {
  /** @type {Array<{ type: 'day', key: string, label: string } | { type: 'message', message: any }>} */
  const rows = [];
  let previousTimestamp = null;

  for (const message of messages) {
    if (previousTimestamp === null || isDifferentDay(previousTimestamp, message.createdAt)) {
      rows.push({
        type: 'day',
        key: `day-${message.createdAt}-${message.id}`,
        label: formatDayLabel(message.createdAt),
      });
    }
    rows.push({ type: 'message', message });
    previousTimestamp = message.createdAt;
  }

  return rows;
}

export default MessageList;
