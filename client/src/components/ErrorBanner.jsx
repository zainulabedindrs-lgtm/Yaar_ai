import { ERROR_CODES, friendlyMessageFor } from '@shared/errors';

import { AlertIcon, RefreshIcon } from './icons.jsx';

/**
 * Friendly, dismissible error banner.
 *
 * Never shows a stack trace: the message comes either from the server (already
 * user-safe) or from the shared friendly-message table.
 *
 * @param {Object} props
 * @param {{ code?: string, message?: string }|null} props.error
 * @param {() => void} [props.onRetry]
 * @param {() => void} [props.onDismiss]
 * @param {boolean} [props.offline]
 */
export function ErrorBanner({ error, onRetry, onDismiss, offline = false }) {
  if (!error && !offline) return null;

  const code = offline ? ERROR_CODES.NETWORK : error?.code;
  const message = offline
    ? friendlyMessageFor(ERROR_CODES.NETWORK)
    : error?.message || friendlyMessageFor(error?.code);
  const isLimit = code === ERROR_CODES.LIMIT_REACHED;

  return (
    <div className={`banner banner--${isLimit ? 'info' : 'error'}`} role="alert">
      <AlertIcon />
      <div className="banner__body">
        <div>{message}</div>
        {onRetry || onDismiss ? (
          <div className="banner__actions">
            {onRetry ? (
              <button type="button" className="button button--sm button--ghost" onClick={onRetry}>
                <RefreshIcon width={16} height={16} />
                Try again
              </button>
            ) : null}
            {onDismiss ? (
              <button type="button" className="button button--sm button--soft" onClick={onDismiss}>
                Dismiss
              </button>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}

export default ErrorBanner;
