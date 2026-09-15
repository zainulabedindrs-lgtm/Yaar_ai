import { useEffect } from 'react';

/**
 * Keeps the composer above the on-screen keyboard on mobile.
 *
 * `100dvh` plus `interactive-widget=resizes-content` already handles most
 * cases, but iOS Safari still overlays the keyboard without resizing the layout
 * viewport. We therefore measure the visual viewport and publish the difference
 * as `--keyboard-inset`, which the composer uses as a bottom margin.
 */
export function useVisualViewport() {
  useEffect(() => {
    const viewport = window.visualViewport;
    if (!viewport) return undefined;

    const root = document.documentElement;
    let frame = 0;

    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        const inset = Math.max(
          0,
          window.innerHeight - viewport.height - viewport.offsetTop,
        );
        // Ignore sub-pixel noise and cap it so a zoomed page cannot push the
        // composer off-screen.
        const value = inset > 24 ? Math.min(inset, window.innerHeight * 0.6) : 0;
        root.style.setProperty('--keyboard-inset', `${Math.round(value)}px`);
      });
    };

    viewport.addEventListener('resize', update);
    viewport.addEventListener('scroll', update);
    update();

    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', update);
      viewport.removeEventListener('scroll', update);
      root.style.setProperty('--keyboard-inset', '0px');
    };
  }, []);
}
