import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';

// Phone-sized layouts, plus portrait tablets (including 1024px iPads).
// Keep the matching media rule in index.css in sync with this query.
export const walletBannerQuery = '(max-width: 767px), (min-width: 768px) and (max-width: 1199px) and (orientation: portrait)';

function scrollPosition() {
  // iOS elastic overscroll must not look like a reversal of the user's gesture.
  const bottom = Math.max(0, document.documentElement.scrollHeight - window.innerHeight);
  return Math.min(bottom, Math.max(0, window.scrollY));
}

/** A single live wallet card, with no reparenting, duplicate controls, or ledger writes. */
export function useWalletBanner(enabled: boolean, section: string) {
  const anchorRef = useRef<HTMLSpanElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  const walletRef = useRef<HTMLDivElement>(null);
  const [compact, setCompact] = useState(false);
  const compactRef = useRef(false);
  const expandedHeight = useRef(0);
  const collapseDistance = useRef(0);
  const lastY = useRef(0);
  const travel = useRef(0);

  const restore = useCallback(() => {
    compactRef.current = false;
    setCompact(false);
    lastY.current = scrollPosition();
    travel.current = 0;
  }, []);

  const measure = useCallback(() => {
    const header = headerRef.current, wallet = walletRef.current;
    if (!header || !wallet) return;
    const walletHeight = wallet.getBoundingClientRect().height;
    if (!compactRef.current) {
      expandedHeight.current = header.getBoundingClientRect().height;
      header.style.setProperty('--banner-wallet-height', `${walletHeight}px`);
    }
    const padding = getComputedStyle(header);
    const verticalPadding = (parseFloat(padding.paddingTop) || 0) + (parseFloat(padding.paddingBottom) || 0);
    expandedHeight.current = Math.max(expandedHeight.current, walletHeight + verticalPadding);
    collapseDistance.current = Math.max(0, expandedHeight.current - walletHeight - verticalPadding);
    header.style.setProperty('--banner-expanded-height', `${expandedHeight.current}px`);
    header.style.setProperty('--banner-collapse-distance', `${collapseDistance.current}px`);
  }, []);

  // Measure the compact card before paint as its wider tablet layout takes effect.
  // The original header height remains in document flow: shrinking/restoring the
  // sticky region never changes scrollY or falsely triggers the opposite state.
  useLayoutEffect(() => { if (enabled) measure(); }, [enabled, compact, measure]);

  useEffect(() => {
    restore();
    if (!enabled) return;
    let media: MediaQueryList | undefined;
    try { media = window.matchMedia(walletBannerQuery); } catch { /* Older/embedded browser. */ }
    const eligible = () => media?.matches ?? (window.innerWidth <= 767 || (window.innerWidth <= 1199 && window.innerHeight >= window.innerWidth));
    let frame: number | undefined;
    let width = window.innerWidth;
    const onScroll = () => {
      if (frame !== undefined) return;
      frame = window.requestAnimationFrame(() => {
        frame = undefined;
        const y = scrollPosition(), delta = y - lastY.current;
        lastY.current = y;
        if (!eligible()) { if (compactRef.current) restore(); return; }
        // Sheets and update prompts lock the page. Scrolling inside one must not
        // change the underlying banner or disturb a form's focus/draft.
        if (document.body.style.overflow === 'hidden') { travel.current = 0; return; }
        if (y <= 24) { restore(); return; }
        if (!delta) return;
        travel.current = Math.sign(delta) === Math.sign(travel.current) ? travel.current + delta : delta;
        if (delta < 0 && travel.current <= -12) { restore(); return; }
        const header = headerRef.current, wallet = walletRef.current;
        const focused = document.activeElement;
        // Preserve keyboard navigation, not the lingering pointer/touch focus
        // left on a tab after selecting it and starting the next swipe.
        if (header?.contains(focused) && !wallet?.contains(focused) && focused?.matches(':focus-visible')) return;
        // Wait until the space reserved by the hidden brand/nav has scrolled
        // away; otherwise a compact header would leave an empty gap below it.
        const origin = (anchorRef.current?.getBoundingClientRect().top || 0) + window.scrollY;
        if (!compactRef.current && delta > 0 && travel.current >= 24 && y >= origin + collapseDistance.current) {
          compactRef.current = true;
          setCompact(true);
          travel.current = 0;
        }
      });
    };
    const onMediaChange = () => { restore(); measure(); };
    const onResize = () => {
      // Mobile browser chrome and an on-screen keyboard change height while
      // scrolling. Only a new width/layout should reset the banner.
      if (window.innerWidth !== width) { width = window.innerWidth; restore(); }
      measure();
    };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : undefined;
    if (headerRef.current) observer?.observe(headerRef.current);
    if (walletRef.current) observer?.observe(walletRef.current);
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    if (media?.addEventListener) media.addEventListener('change', onMediaChange);
    else media?.addListener?.(onMediaChange);
    return () => {
      if (frame !== undefined) window.cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      if (media?.removeEventListener) media.removeEventListener('change', onMediaChange);
      else media?.removeListener?.(onMediaChange);
    };
  }, [enabled, section, restore, measure]);

  return { anchorRef, headerRef, walletRef, compact, restore };
}
