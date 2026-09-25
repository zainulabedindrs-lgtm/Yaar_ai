import { friendlyMessageFor } from '@shared/errors';

/**
 * Shared loading / empty / error states so every screen degrades gracefully
 * instead of showing an empty box.
 */

/** Skeleton list used while chat history loads. */
export function ChatSkeleton() {
  return (
    <div className="chat__list" aria-hidden="true">
      <div className="message-row">
        <div className="skeleton" style={{ width: 40, height: 40, borderRadius: '50%' }} />
        <div className="skeleton" style={{ width: 180, height: 44, borderRadius: 20 }} />
      </div>
      <div className="message-row message-row--user">
        <div className="skeleton" style={{ width: 120, height: 40, borderRadius: 20 }} />
      </div>
      <div className="message-row">
        <div className="skeleton" style={{ width: 220, height: 44, borderRadius: 20 }} />
      </div>
    </div>
  );
}

/** Full page spinner with a label. */
export function LoadingState({ label = 'Just a second…' }) {
  return (
    <div className="empty-state" role="status">
      <span className="spinner spinner--lg" />
      <span className="muted">{label}</span>
    </div>
  );
}

/**
 * @param {Object} props
 * @param {string} [props.title]
 * @param {string} [props.description]
 * @param {string} [props.emoji]
 */
export function EmptyState({ title = 'Nothing here yet', description = '', emoji = '💬' }) {
  return (
    <div className="empty-state">
      <div className="empty-state__art" aria-hidden="true">
        {emoji}
      </div>
      <div>
        <strong>{title}</strong>
      </div>
      {description ? <p className="muted">{description}</p> : null}
    </div>
  );
}

/**
 * @param {Object} props
 * @param {string} [props.title]
 * @param {{ code?: string, message?: string }|null} [props.error]
 * @param {() => void} [props.onRetry]
 */
export function ErrorState({ title = 'We hit a snag', error, onRetry }) {
  const message = error?.message || friendlyMessageFor(error?.code);

  return (
    <div className="empty-state" role="alert">
      <div className="empty-state__art" aria-hidden="true">
        🙈
      </div>
      <div>
        <strong>{title}</strong>
      </div>
      <p className="muted">{message}</p>
      {onRetry ? (
        <button type="button" className="button button--soft" onClick={onRetry}>
          Try again
        </button>
      ) : null}
    </div>
  );
}
