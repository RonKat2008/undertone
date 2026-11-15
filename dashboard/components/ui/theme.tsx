'use client';

import { useSyncExternalStore } from 'react';
import { SegmentedControl } from './segmented-control';
import { THEME_STORAGE_KEY } from './theme-script';

export type Theme = 'dark' | 'light';

const EVENT = 'undertone-theme-change';

function read(): Theme {
  return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function subscribe(onChange: () => void): () => void {
  window.addEventListener(EVENT, onChange);
  window.addEventListener('storage', onChange);
  return () => {
    window.removeEventListener(EVENT, onChange);
    window.removeEventListener('storage', onChange);
  };
}

/** Apply and remember a theme. */
export function setTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme;
  try {
    localStorage.setItem(THEME_STORAGE_KEY, theme);
  } catch {
    // storage blocked (private window): the choice lasts for this page only
  }
  window.dispatchEvent(new Event(EVENT));
}

/** The current theme; 'dark' on the server. */
export function useTheme(): Theme {
  return useSyncExternalStore(subscribe, read, () => 'dark');
}

/** The Settings control for the theme. */
export function ThemeToggle() {
  const theme = useTheme();
  return (
    <SegmentedControl
      label="Theme"
      value={theme}
      onValueChange={setTheme}
      options={[{ value: 'dark', label: 'Dark' }, { value: 'light', label: 'Light' }]}
    />
  );
}
