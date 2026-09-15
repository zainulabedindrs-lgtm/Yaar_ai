import { Avatar } from './Avatar.jsx';

/**
 * "…is typing" bubble. Shown between accepting a message and the first streamed
 * token, so the user always sees immediate feedback.
 */
export function TypingIndicator({ companion, label = 'typing' }) {
  return (
    <div className="message-row" role="status" aria-live="polite">
      <span className="message-row__avatar">
        <Avatar companion={companion} size="sm" />
      </span>
      <div className="bubble bubble--assistant">
        <span className="typing" aria-label={`${companion?.displayName ?? 'Yaar'} is ${label}`}>
          <span className="typing__dot" />
          <span className="typing__dot" />
          <span className="typing__dot" />
        </span>
      </div>
    </div>
  );
}

export default TypingIndicator;
