import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * Auto-scroll for the message list.
 *
 * Behaviour that makes a chat feel right:
 *  - a new message scrolls into view only when the user is already near the
 *    bottom (never yank the view while they are reading older messages)
 *  - a "jump to latest" affordance appears when they are scrolled up
 *  - scrolling is instant while a reply streams (no jitter) and smooth for
 *    anything the user triggered
 *
 * @param {{ deps?: unknown[], streaming?: boolean, threshold?: number }} options
 */
export function useAutoScroll({ deps = [], streaming = false, threshold = 120 } = {}) {
  const containerRef = useRef(/** @type {HTMLDivElement|null} */ (null));
  const [atBottom, setAtBottom] = useState(true);
  const lastScrollHeight = useRef(0);

  const isNearBottom = useCallback(
    (element) => element.scrollHeight - element.scrollTop - element.clientHeight <= threshold,
    [threshold],
  );

  const scrollToBottom = useCallback(
    (behavior = 'smooth') => {
      const element = containerRef.current;
      if (!element) return;
      element.scrollTo({ top: element.scrollHeight, behavior });
      setAtBottom(true);
    },
    [],
  );

  // Track the user's scroll position.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return undefined;

    const onScroll = () => setAtBottom(isNearBottom(element));
    element.addEventListener('scroll', onScroll, { passive: true });
    return () => element.removeEventListener('scroll', onScroll);
  }, [isNearBottom]);

  // React to content changes.
  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;

    const grew = element.scrollHeight > lastScrollHeight.current;
    lastScrollHeight.current = element.scrollHeight;

    const wasAtBottom = atBottom;
    if (wasAtBottom || (grew && isNearBottom(element))) {
      element.scrollTo({ top: element.scrollHeight, behavior: streaming ? 'auto' : 'smooth' });
    }
    // `deps` drives this effect; streaming only changes *how* we scroll.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  // Keep the latest message visible when the composer/keyboard changes size.
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return undefined;
    const onResize = () => {
      if (atBottom) scrollToBottom('auto');
    };
    viewport.addEventListener('resize', onResize);
    return () => viewport.removeEventListener('resize', onResize);
  }, [atBottom, scrollToBottom]);

  return { containerRef, scrollToBottom, atBottom };
}
