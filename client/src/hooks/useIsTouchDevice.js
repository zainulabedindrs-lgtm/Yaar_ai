import { useEffect, useState } from 'react';

/**
 * True on phones/tablets (coarse pointer).
 *
 * Used by the composer: on a touch keyboard people expect Enter to add a new
 * line and the send button to be the explicit action, whereas on a desktop
 * Enter should send.
 */
export function useIsTouchDevice() {
  const [isTouch, setIsTouch] = useState(() => detect());

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return undefined;
    const query = window.matchMedia('(pointer: coarse)');
    const update = () => setIsTouch(detect());
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);

  return isTouch;
}

function detect() {
  if (typeof window === 'undefined') return false;
  if (window.matchMedia?.('(pointer: coarse)').matches) return true;
  return 'ontouchstart' in window && navigator.maxTouchPoints > 0;
}
