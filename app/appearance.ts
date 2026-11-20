import { useCallback, useEffect, useState } from 'react';

export type ThemePreference = 'system' | 'light' | 'dark';
export type ResolvedTheme = 'light' | 'dark';
export const appearanceStorageKey = 'eics.appearance';
export const systemThemeQuery = '(prefers-color-scheme: dark)';
export const themeChromeColors = { light: '#f1f5f0', dark: '#101714' } as const;

export function normalizeThemePreference(value: unknown): ThemePreference {
  return value === 'light' || value === 'dark' ? value : 'system';
}

export function readThemePreference(): ThemePreference {
  try { return normalizeThemePreference(window.localStorage.getItem(appearanceStorageKey)); }
  catch { return 'system'; }
}

function systemMediaQuery(): MediaQueryList | undefined {
  try { return window.matchMedia(systemThemeQuery); }
  catch { return undefined; }
}

export function resolveTheme(preference: ThemePreference, systemDark = false): ResolvedTheme {
  return preference === 'system' ? systemDark ? 'dark' : 'light' : preference;
}

export function applyTheme(preference: ThemePreference, systemDark = false): ResolvedTheme {
  const theme = resolveTheme(preference, systemDark);
  const root = document.documentElement;
  root.dataset.theme = theme;
  // Match native form controls, the initial canvas, and supported browser chrome.
  root.style.colorScheme = theme;
  root.style.backgroundColor = themeChromeColors[theme];
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', themeChromeColors[theme]);
  return theme;
}

export type AppearanceControls = {
  preference: ThemePreference;
  resolvedTheme: ResolvedTheme;
  setPreference: (preference: ThemePreference) => void;
};

// Appearance is a device preference, not account/financial metadata. Keep the
// listener above the signed-in dashboard so auth changes never reset the theme.
export function useAppearance(): AppearanceControls {
  const [preference, setStoredPreference] = useState<ThemePreference>(readThemePreference);
  const [resolvedTheme, setResolvedTheme] = useState<ResolvedTheme>(() => resolveTheme(preference, systemMediaQuery()?.matches));

  useEffect(() => {
    const media = systemMediaQuery();
    const syncTheme = () => setResolvedTheme(applyTheme(preference, media?.matches));
    const onSystemChange = () => { if (preference === 'system') syncTheme(); };
    const onStorage = (event: StorageEvent) => {
      if (event.key === appearanceStorageKey) setStoredPreference(normalizeThemePreference(event.newValue));
      else if (event.key === null) setStoredPreference(readThemePreference());
    };
    syncTheme();
    // Older Safari exposes only addListener/removeListener.
    if (media?.addEventListener) media.addEventListener('change', onSystemChange);
    else media?.addListener?.(onSystemChange);
    window.addEventListener('storage', onStorage);
    return () => {
      if (media?.removeEventListener) media.removeEventListener('change', onSystemChange);
      else media?.removeListener?.(onSystemChange);
      window.removeEventListener('storage', onStorage);
    };
  }, [preference]);

  const setPreference = useCallback((next: ThemePreference) => {
    try { window.localStorage.setItem(appearanceStorageKey, next); }
    catch { /* A blocked/full storage area must not prevent this session's choice. */ }
    setStoredPreference(next);
    setResolvedTheme(applyTheme(next, systemMediaQuery()?.matches));
  }, []);

  return { preference, resolvedTheme, setPreference };
}
