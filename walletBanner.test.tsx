// @vitest-environment happy-dom
import React, { StrictMode } from 'react';
import { act, cleanup, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWalletBanner, walletBannerQuery } from './app/useWalletBanner';

let y = 0, width = 390, height = 844, headerHeight = 300, walletHeight = 120;
let nextFrame = 0;
const frames = new Map<number, FrameRequestCallback>();
const mediaListeners = new Set<() => void>();
const observers: { update: () => void; disconnect: ReturnType<typeof vi.fn> }[] = [];
const eligible = () => width <= 767 || (width <= 1199 && height >= width);
const media = {
  get matches() { return eligible(); }, media: walletBannerQuery,
  addEventListener: vi.fn((_event: string, listener: () => void) => { mediaListeners.add(listener); }),
  removeEventListener: vi.fn((_event: string, listener: () => void) => { mediaListeners.delete(listener); }),
  addListener: vi.fn((listener: () => void) => { mediaListeners.add(listener); }),
  removeListener: vi.fn((listener: () => void) => { mediaListeners.delete(listener); }),
};
function Harness({ enabled = true, section = 'home' }: { enabled?: boolean; section?: string }) {
  const banner = useWalletBanner(enabled, section);
  return <>
    <span data-anchor ref={banner.anchorRef}/>
    <header ref={banner.headerRef} data-compact={banner.compact} style={{ paddingTop: 12, paddingBottom: 12 }} onFocusCapture={event => { if (!banner.walletRef.current?.contains(event.target as Node)) banner.restore(); }}>
      <h1>Store name</h1><nav><button>Transactions</button></nav>
      <div data-wallet ref={banner.walletRef}><p>Main Wallet ₱5,000</p><button>Quick Sale</button></div>
    </header>
    <input aria-label="Unsaved notes" defaultValue="Keep this draft"/>
  </>;
}
function flushFrame() {
  act(() => { const callbacks = [...frames.values()]; frames.clear(); for (const callback of callbacks) callback(0); });
}
function scrollTo(value: number) { y = value; fireEvent.scroll(window); flushFrame(); }
function resize(w: number, h: number) {
  const before = eligible(); width = w; height = h;
  act(() => { if (before !== eligible()) for (const listener of mediaListeners) listener(); fireEvent(window, new Event('resize')); });
}
function compact(container: HTMLElement) { return container.querySelector('header')?.getAttribute('data-compact') === 'true'; }

beforeEach(() => {
  y = 0; width = 390; height = 844; headerHeight = 300; walletHeight = 120;
  nextFrame = 0; frames.clear(); mediaListeners.clear(); observers.length = 0; vi.clearAllMocks();
  vi.spyOn(window, 'scrollY', 'get').mockImplementation(() => y);
  vi.spyOn(window, 'innerWidth', 'get').mockImplementation(() => width);
  vi.spyOn(window, 'innerHeight', 'get').mockImplementation(() => height);
  Object.defineProperty(document.documentElement, 'scrollHeight', { configurable: true, value: 5000 });
  vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const h = this.tagName === 'HEADER' ? headerHeight : this.hasAttribute('data-wallet') ? walletHeight : 0;
    const top = this.hasAttribute('data-anchor') ? 48 - y : 0;
    return { x: 0, y: top, top, bottom: top + h, left: 0, right: width, width, height: h, toJSON() {} };
  });
  vi.stubGlobal('requestAnimationFrame', vi.fn((callback: FrameRequestCallback) => { frames.set(++nextFrame, callback); return nextFrame; }));
  vi.stubGlobal('cancelAnimationFrame', vi.fn((id: number) => { frames.delete(id); }));
  vi.stubGlobal('matchMedia', vi.fn(() => media));
  vi.stubGlobal('ResizeObserver', class {
    observe = vi.fn(); unobserve = vi.fn();
    disconnect = vi.fn();
    constructor(update: () => void) { observers.push({ update, disconnect: this.disconnect }); }
  });
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); document.body.style.overflow = '';
  Reflect.deleteProperty(document.documentElement, 'scrollHeight');
});

describe('wallet-only scrolling banner', () => {
  it('starts full and collapses on an upward swipe only after the reserved brand space has scrolled away', () => {
    const view = render(<Harness />), header = view.container.querySelector('header')!;
    expect(compact(view.container)).toBe(false);
    expect(header.style.getPropertyValue('--banner-expanded-height')).toBe('300px');
    expect(header.style.getPropertyValue('--banner-wallet-height')).toBe('120px');
    expect(header.style.getPropertyValue('--banner-collapse-distance')).toBe('156px');
    scrollTo(100); expect(compact(view.container)).toBe(false);
    scrollTo(203); expect(compact(view.container)).toBe(false);
    scrollTo(220); expect(compact(view.container)).toBe(true);
    expect(header.style.getPropertyValue('--banner-expanded-height')).toBe('300px');
  });

  it('restores on a downward swipe and waits for meaningful motion rather than flickering on small reversals', () => {
    const view = render(<Harness />); scrollTo(400); expect(compact(view.container)).toBe(true);
    scrollTo(397); scrollTo(394); expect(compact(view.container)).toBe(true);
    scrollTo(388); expect(compact(view.container)).toBe(false);
    scrollTo(395); scrollTo(402); expect(compact(view.container)).toBe(false);
    scrollTo(412); expect(compact(view.container)).toBe(true);
    scrollTo(20); expect(compact(view.container)).toBe(false);
  });

  it.each([
    [320, 700, true], [390, 844, true], [740, 390, true],
    [768, 1024, true], [820, 1180, true], [1024, 1366, true], [1199, 1600, true],
    [820, 768, false], [1180, 820, false], [1366, 900, false], [1200, 1600, false],
  ])('limits compaction at %i×%i to the phone/portrait-tablet layout (eligible=%s)', (w, h, expected) => {
    width = w; height = h;
    const view = render(<Harness />); scrollTo(400);
    expect(compact(view.container)).toBe(expected);
    expect(window.matchMedia).toHaveBeenCalledWith(walletBannerQuery);
  });

  it('does not move the viewport, remount controls, alter an input draft, or persist anything', () => {
    const storage = vi.spyOn(Storage.prototype, 'setItem'), move = vi.spyOn(window, 'scrollTo');
    const view = render(<Harness />), wallet = view.container.querySelector('[data-wallet]'), button = wallet?.querySelector('button');
    const draft = view.getByLabelText('Unsaved notes') as HTMLInputElement;
    fireEvent.change(draft, { target: { value: 'Still unfinished' } });
    for (let i = 0; i < 3; i++) { scrollTo(400); scrollTo(350); }
    expect(view.container.querySelector('[data-wallet]')).toBe(wallet);
    expect(wallet?.querySelector('button')).toBe(button);
    expect(draft.value).toBe('Still unfinished');
    expect(y).toBe(350); expect(move).not.toHaveBeenCalled(); expect(storage).not.toHaveBeenCalled();
  });

  it('keeps the wallet action focused while compact and reveals the full banner when a top tab receives keyboard focus', () => {
    const view = render(<Harness />); scrollTo(400);
    act(() => { view.getByText('Quick Sale').focus(); }); expect(compact(view.container)).toBe(true);
    act(() => { view.getByText('Transactions').focus(); }); expect(compact(view.container)).toBe(false);
    scrollTo(500); expect(compact(view.container)).toBe(false);
    act(() => { view.getByLabelText('Unsaved notes').focus(); }); scrollTo(530);
    expect(compact(view.container)).toBe(true);
  });

  it('does not let lingering pointer focus on a tab prevent the next upward swipe', () => {
    const view = render(<Harness />), tab = view.getByText('Transactions');
    act(() => { tab.focus(); });
    const matches = tab.matches.bind(tab);
    vi.spyOn(tab, 'matches').mockImplementation(selector => selector === ':focus-visible' ? false : matches(selector));
    scrollTo(400); expect(compact(view.container)).toBe(true);
    expect(document.activeElement).toBe(tab);
  });

  it('restores on a section change and on rotation/width changes, but not on browser-chrome height changes', () => {
    const view = render(<Harness />); scrollTo(400);
    resize(390, 780); expect(compact(view.container)).toBe(true);
    view.rerender(<Harness section="transactions"/>); expect(compact(view.container)).toBe(false);
    scrollTo(450); expect(compact(view.container)).toBe(true);
    resize(820, 1180); expect(compact(view.container)).toBe(false);
    scrollTo(500); expect(compact(view.container)).toBe(true);
    resize(1180, 820); expect(compact(view.container)).toBe(false);
    scrollTo(600); expect(compact(view.container)).toBe(false);
  });

  it('does not react while a payment sheet/update prompt has locked background scrolling', () => {
    const view = render(<Harness />);
    document.body.style.overflow = 'hidden'; scrollTo(400); expect(compact(view.container)).toBe(false);
    document.body.style.overflow = ''; scrollTo(430); expect(compact(view.container)).toBe(true);
    document.body.style.overflow = 'hidden'; scrollTo(300); expect(compact(view.container)).toBe(true);
    document.body.style.overflow = ''; scrollTo(270); expect(compact(view.container)).toBe(false);
  });

  it('clamps elastic overscroll at both ends instead of treating the bounce as a swipe reversal', () => {
    const view = render(<Harness />); scrollTo(400); scrollTo(4156); expect(compact(view.container)).toBe(true);
    scrollTo(4300); scrollTo(4200); scrollTo(4156); expect(compact(view.container)).toBe(true);
    scrollTo(4140); expect(compact(view.container)).toBe(false);
    scrollTo(-100); scrollTo(0); expect(compact(view.container)).toBe(false);
  });

  it('remeasures after fonts, live balances, or a resized card change size without changing the reserved flow height', () => {
    const view = render(<Harness />), header = view.container.querySelector('header')!;
    headerHeight = 330; walletHeight = 130; act(() => { for (const observer of observers) observer.update(); });
    expect(header.style.getPropertyValue('--banner-expanded-height')).toBe('330px');
    scrollTo(400); walletHeight = 160;
    act(() => { for (const observer of observers) observer.update(); });
    expect(header.style.getPropertyValue('--banner-expanded-height')).toBe('330px');
    expect(header.style.getPropertyValue('--banner-collapse-distance')).toBe('146px');
    expect(compact(view.container)).toBe(true);
  });

  it('throttles scroll work to one animation frame and cleans up listeners/observers in StrictMode', () => {
    const view = render(<StrictMode><Harness /></StrictMode>);
    expect(mediaListeners.size).toBe(1);
    y = 400; fireEvent.scroll(window); fireEvent.scroll(window); fireEvent.scroll(window);
    expect(frames.size).toBe(1); flushFrame(); expect(compact(view.container)).toBe(true);
    y = 350; fireEvent.scroll(window); expect(frames.size).toBe(1);
    view.unmount(); expect(frames.size).toBe(0); expect(mediaListeners.size).toBe(0);
    expect(observers.every(observer => observer.disconnect.mock.calls.length === 1)).toBe(true);
    fireEvent.scroll(window); expect(frames.size).toBe(0);
  });

  it('waits for dashboard loading and supports legacy media listeners or missing browser APIs', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ get matches() { return eligible(); }, addListener: media.addListener, removeListener: media.removeListener })));
    vi.stubGlobal('ResizeObserver', undefined);
    const view = render(<Harness enabled={false}/>); scrollTo(400); expect(compact(view.container)).toBe(false);
    view.rerender(<Harness />); scrollTo(450); expect(compact(view.container)).toBe(true);
    expect(mediaListeners.size).toBe(1); view.unmount(); expect(mediaListeners.size).toBe(0);
    vi.stubGlobal('matchMedia', undefined); y = 0;
    const fallback = render(<Harness />); scrollTo(400); expect(compact(fallback.container)).toBe(true);
  });
});
