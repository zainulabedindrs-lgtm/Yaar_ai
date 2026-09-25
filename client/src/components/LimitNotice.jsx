import { useCountdown } from '../hooks/useCountdown.js';
import { formatDuration } from '../utils/format.js';

/**
 * The friendly "that's all 20 messages for now" card.
 *
 * Shown in place of the composer once the daily allowance is spent. The
 * conversation itself is never deleted — it is waiting when the window resets.
 *
 * @param {Object} props
 * @param {number|null} props.resetAt epoch ms
 * @param {number} props.limit
 */
export function LimitNotice({ resetAt, limit }) {
  const remaining = useCountdown(resetAt);

  return (
    <div className="limit-card" role="status" data-testid="limit-notice">
      <div className="limit-card__emoji" aria-hidden="true">
        💛
      </div>
      <div className="limit-card__title">That&apos;s all {limit} messages for now</div>
      <p className="limit-card__text">
        Come back after 24 hours and we&apos;ll continue our conversation. Everything you talked
        about is saved here — nothing is lost.
      </p>
      <div className="limit-card__countdown">
        Free again in {formatDuration(remaining)}
      </div>
    </div>
  );
}

export default LimitNotice;
