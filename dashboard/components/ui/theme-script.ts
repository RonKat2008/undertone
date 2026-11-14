/** Kept out of theme.tsx so the server layout can read the string (a 'use client' module would hand it a reference). */
export const THEME_STORAGE_KEY = 'undertone-theme';

/**
 * Runs before first paint (inlined in <head> by app/layout.tsx): dark unless the person chose
 * light in Settings. The system preference is deliberately ignored.
 */
export const THEME_SCRIPT = `try{var t=localStorage.getItem('${THEME_STORAGE_KEY}');document.documentElement.dataset.theme=t==='light'?'light':'dark'}catch(e){}`;
