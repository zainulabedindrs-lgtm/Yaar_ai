import { useEffect, useState } from 'react';

/**
 * Re-renders once a minute (or once a second when the target is close) so
 * countdown text like "comes back in 4h 12m" stays accurate without a busy
 * timer.
 *
 * @param {number|null|undefined} targetTimestamp epoch ms
 * @returns {number} milliseconds remaining (0 when passed or unknown)
 */
export function useCountdown(targetTimestamp) {
  const [, forceTick] = useState(0);

  useEffect(() => {
    if (!targetTimestamp) return undefined;
    const remaining = targetTimestamp - Date.now();
    if (remaining <= 0) return undefined;

    const interval = remaining < 60_000 ? 1_000 : 30_000;
    const timer = setInterval(() => forceTick((tick) => tick + 1), interval);
    return () => clearInterval(timer);
  }, [targetTimestamp]);

  if (!targetTimestamp) return 0;
  return Math.max(0, targetTimestamp - Date.now());
}
