import { useCountdown } from '../hooks/useCountdown.js';
import { formatDuration } from '../utils/format.js';

/**
 * "12 / 20 messages used" with a soft progress bar and, once the allowance is
 * spent, the exact time until it comes back.
 *
 * @param {Object} props
 * @param {{ used: number, limit: number, remaining: number, resetAt: number, exhausted: boolean }|null} props.usage
 * @param {boolean} [props.compact]
 * @param {boolean} [props.showReset]
 */
export function UsageMeter({ usage, compact = false, showReset = true }) {
  const remainingMs = useCountdown(usage?.exhausted ? usage?.resetAt : null);

  if (!usage) {
    return (
      <div className={`usage ${compact ? 'usage--compact' : ''}`.trim()} aria-hidden="true">
        <div className="usage__bar">
          <div className="skeleton" style={{ height: '100%', width: '100%' }} />
        </div>
      </div>
    );
  }

  const percent = Math.min(100, Math.round((usage.used / Math.max(1, usage.limit)) * 100));
  const fillClass = usage.exhausted
    ? 'usage__fill usage__fill--out'
    : usage.remaining <= 5
      ? 'usage__fill usage__fill--low'
      : 'usage__fill';

  return (
    <div
      className={`usage ${compact ? 'usage--compact' : ''}`.trim()}
      role="group"
      aria-label={`${usage.used} of ${usage.limit} messages used`}
    >
      <div className="usage__row">
        <span className="usage__count">
          {usage.used} / {usage.limit} messages used
        </span>
        {showReset && !usage.exhausted ? (
          <span className="usage__reset">
            {usage.remaining} left · resets in {formatDuration(usage.resetAt - Date.now())}
          </span>
        ) : null}
        {showReset && usage.exhausted ? (
          <span className="usage__reset">Resets in {formatDuration(remainingMs)}</span>
        ) : null}
      </div>
      <div
        className="usage__bar"
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={usage.limit}
        aria-valuenow={usage.used}
      >
        <div className={fillClass} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

export default UsageMeter;
