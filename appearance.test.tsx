// @vitest-environment happy-dom
import React, { StrictMode } from 'react';
import { readFileSync } from 'node:fs';
import { act, cleanup, fireEvent, render, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AppearanceSettings from './app/AppearanceSettings';
import { appearanceStorageKey, applyTheme, normalizeThemePreference, readThemePreference, resolveTheme, systemThemeQuery, themeChromeColors, useAppearance } from './app/appearance';

let systemDark = false;
const listeners = new Set<() => void>();
const media = {
  get matches() { return systemDark; }, media: systemThemeQuery,
  addEventListener: vi.fn((_event: string, listener: () => void) => { listeners.add(listener); }),
  removeEventListener: vi.fn((_event: string, listener: () => void) => { listeners.delete(listener); }),
  addListener: vi.fn((listener: () => void) => { listeners.add(listener); }),
  removeListener: vi.fn((listener: () => void) => { listeners.delete(listener); }),
};
function Harness() { return <AppearanceSettings {...useAppearance()} />; }
function changeSystem(dark: boolean) {
  systemDark = dark;
  act(() => { for (const listener of listeners) listener(); });
}
function choose(container: HTMLElement, label: string) { fireEvent.click(within(container).getByRole('radio', { name: label })); }
function expectTheme(theme: 'light' | 'dark') {
  expect(document.documentElement.dataset.theme).toBe(theme);
  expect(document.documentElement.style.colorScheme).toBe(theme);
  expect(document.querySelector('meta[name="theme-color"]')?.getAttribute('content')).toBe(themeChromeColors[theme]);
}

beforeEach(() => {
  systemDark = false; listeners.clear(); vi.clearAllMocks(); localStorage.clear();
  vi.stubGlobal('matchMedia', vi.fn(() => media));
  const meta = document.createElement('meta'); meta.name = 'theme-color'; document.head.append(meta);
});
afterEach(() => {
  cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals(); localStorage.clear();
  document.querySelector('meta[name="theme-color"]')?.remove();
  delete document.documentElement.dataset.theme;
  document.documentElement.removeAttribute('style');
});

describe('local appearance preference', () => {
  it.each(['system', 'light', 'dark'] as const)('retains the valid %s preference', preference => {
    localStorage.setItem(appearanceStorageKey, preference);
    expect(normalizeThemePreference(preference)).toBe(preference);
    expect(readThemePreference()).toBe(preference);
  });

  it.each([null, undefined, '', 'invalid', 'DARK', 1])('defaults unknown preference %s to System', value => {
    expect(normalizeThemePreference(value)).toBe('system');
  });

  it.each([
    ['system', false, 'light'], ['system', true, 'dark'],
    ['light', false, 'light'], ['light', true, 'light'],
    ['dark', false, 'dark'], ['dark', true, 'dark'],
  ] as const)('resolves %s with system dark=%s to %s', (preference, dark, expected) => {
    expect(resolveTheme(preference, dark)).toBe(expected);
  });

  it('sets native control colors and browser chrome without requiring a meta tag', () => {
    applyTheme('dark'); expectTheme('dark');
    document.querySelector('meta[name="theme-color"]')!.remove();
    expect(() => applyTheme('light')).not.toThrow();
    expect(document.documentElement.dataset.theme).toBe('light');
  });

  it('follows live OS changes by default without writing any preference', () => {
    systemDark = true;
    const view = render(<Harness />);
    expectTheme('dark'); expect(within(view.container).getByRole('radio', { name: 'System' }).getAttribute('name')).toBeTruthy();
    expect(within(view.container).getByRole('status').textContent).toContain('Dark mode active · follows your device');
    changeSystem(false); expectTheme('light');
    expect(localStorage.getItem(appearanceStorageKey)).toBeNull();
  });

  it('applies immediately, persists across remount, and overrides the system only until System is selected', () => {
    systemDark = true;
    let view = render(<Harness />);
    choose(view.container, 'Light'); expectTheme('light');
    expect(localStorage.getItem(appearanceStorageKey)).toBe('light');
    changeSystem(false); changeSystem(true); expectTheme('light');
    view.unmount(); view = render(<Harness />); expectTheme('light');
    choose(view.container, 'System'); expectTheme('dark');
    changeSystem(false); expectTheme('light');
    expect(localStorage.getItem(appearanceStorageKey)).toBe('system');
    choose(view.container, 'Dark'); expectTheme('dark');
    expect((within(view.container).getByRole('radio', { name: 'Dark' }) as HTMLInputElement).checked).toBe(true);
  });

  it('synchronizes the same browser’s other tabs, ignores unrelated storage, and handles a cleared preference', () => {
    render(<Harness />);
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: appearanceStorageKey, newValue: 'dark' })));
    expectTheme('dark');
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: 'unrelated', newValue: 'light' })));
    expectTheme('dark');
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: appearanceStorageKey, newValue: null })));
    expectTheme('light');
    systemDark = true;
    act(() => window.dispatchEvent(new StorageEvent('storage', { key: null })));
    // A storage clear does not change an already-System preference; the media
    // listener still owns live system changes.
    changeSystem(true); expectTheme('dark');
  });

  it('keeps a session choice usable when storage is blocked/full', () => {
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Blocked storage'); });
    vi.spyOn(Storage.prototype, 'setItem').mockImplementation(() => { throw new Error('Full storage'); });
    systemDark = true;
    const view = render(<Harness />); expectTheme('dark');
    choose(view.container, 'Light'); expectTheme('light');
    changeSystem(false); changeSystem(true); expectTheme('light');
  });

  it('supports legacy media-query listeners and removes them on unmount', () => {
    vi.stubGlobal('matchMedia', vi.fn(() => ({ get matches() { return systemDark; }, addListener: media.addListener, removeListener: media.removeListener })));
    const view = render(<Harness />);
    expect(media.addListener).toHaveBeenCalledTimes(1);
    changeSystem(true); expectTheme('dark');
    view.unmount(); expect(listeners.size).toBe(0);
    expect(media.removeListener).toHaveBeenCalledTimes(1);
  });

  it('still supports explicit choices without matchMedia', () => {
    vi.stubGlobal('matchMedia', undefined);
    const view = render(<Harness />); expectTheme('light');
    choose(view.container, 'Dark'); expectTheme('dark');
  });

  it('does not accumulate system listeners in StrictMode', () => {
    const view = render(<StrictMode><Harness /></StrictMode>);
    expect(listeners.size).toBe(1);
    view.unmount(); expect(listeners.size).toBe(0);
  });
});

// The inline pre-paint path must make exactly the same decision as the React
// controller, including blocked storage and a stale/invalid saved value.
const html = readFileSync('app/index.html', 'utf8');
const bootstrap = html.match(/<script id="appearance-bootstrap">([\s\S]*?)<\/script>/)?.[1];
if (!bootstrap) throw new Error('Missing pre-paint appearance bootstrap');
describe('pre-paint theme bootstrap', () => {
  it.each([
    [null, false], [null, true], ['system', false], ['system', true],
    ['light', false], ['light', true], ['dark', false], ['dark', true], ['invalid', true],
  ] as const)('matches the controller for saved %s and system dark=%s', (saved, dark) => {
    systemDark = dark;
    if (saved) localStorage.setItem(appearanceStorageKey, saved);
    new Function(bootstrap)();
    const theme = resolveTheme(normalizeThemePreference(saved), dark);
    expectTheme(theme);
    expect(document.documentElement.style.backgroundColor).toBe(themeChromeColors[theme]);
    expect(localStorage.getItem(appearanceStorageKey)).toBe(saved);
  });

  it('uses the system preference with blocked storage before React is available', () => {
    systemDark = true;
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('Blocked storage'); });
    expect(() => new Function(bootstrap)()).not.toThrow();
    expectTheme('dark');
  });
});

const css = readFileSync('index.css', 'utf8');
const colors = (block: string) => Object.fromEntries([...block.matchAll(/--([\w-]+):\s*(#[a-f\d]{6});/gi)].map(match => [match[1], match[2]]));
const light = colors(css.match(/:root\{([\s\S]*?)\}/)![1]);
const dark = { ...light, ...colors(css.match(/:root\[data-theme="dark"\]\{([\s\S]*?)\}/)![1]) };
function luminance(hex: string) {
  const c = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4);
  return c[0] * .2126 + c[1] * .7152 + c[2] * .0722;
}
function contrast(a: string, b: string) {
  const values = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (values[0] + .05) / (values[1] + .05);
}
describe.each([['light', light], ['dark', dark]] as const)('%s semantic palette', (_theme, palette) => {
  const roles = ['green', 'orange', 'purple', 'blue', 'sky', 'amber', 'red'];
  it('keeps regular text, muted labels, and status accents at least 4.5:1', () => {
    const backgrounds = ['bg', 'surface', 'surface2', ...roles.map(role => `${role}-soft`)];
    for (const fg of ['ink', 'muted']) for (const bg of backgrounds) expect(contrast(palette[fg], palette[bg]), `${fg} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    for (const role of [...roles, 'wallet-ink']) {
      for (const bg of ['bg', 'surface', 'surface2', ...(roles.includes(role) ? [`${role}-soft`] : [])]) expect(contrast(palette[role], palette[bg]), `${role} on ${bg}`).toBeGreaterThanOrEqual(4.5);
    }
  });
  it('keeps filled action labels at least 4.5:1 instead of reusing bright accent text as a fill', () => {
    for (const role of ['green', 'orange', 'purple', 'blue', 'sky', 'red', 'wallet']) expect(contrast('#ffffff', palette[`${role}-solid`]), role).toBeGreaterThanOrEqual(4.5);
    expect(contrast(palette['on-strong'], palette.strong)).toBeGreaterThanOrEqual(4.5);
  });
  it('keeps input boundaries and keyboard focus visible at least 3:1', () => {
    expect(contrast(palette['field-border'], palette.surface2)).toBeGreaterThanOrEqual(3);
    for (const bg of ['bg', 'surface', 'surface2']) expect(contrast(palette.focus, palette[bg])).toBeGreaterThanOrEqual(3);
  });
  it('matches the pre-paint and browser chrome background', () => {
    expect(palette.bg).toBe(themeChromeColors[_theme]);
  });
});
