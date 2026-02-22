import { useState, useEffect, useCallback } from 'preact/hooks';
import type { ThemeMode } from '@/lib/storage/types';

const STORAGE_KEY = 'xtil-theme';
const OLD_STORAGE_KEY = 'tldr-theme';

function resolveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return mode;
}

export function useTheme() {
  const [mode, setModeState] = useState<ThemeMode>(() => {
    const saved = localStorage.getItem(STORAGE_KEY) as ThemeMode | null;
    if (saved) return saved;
    // Migrate from old key
    const old = localStorage.getItem(OLD_STORAGE_KEY) as ThemeMode | null;
    if (old) {
      localStorage.setItem(STORAGE_KEY, old);
      localStorage.removeItem(OLD_STORAGE_KEY);
      return old;
    }
    return 'system';
  });
  const [resolved, setResolved] = useState<'light' | 'dark'>(() => resolveTheme(mode));

  const applyTheme = useCallback((m: ThemeMode) => {
    const r = resolveTheme(m);
    setResolved(r);
    document.documentElement.setAttribute('data-theme', r);
  }, []);

  const setMode = useCallback((newMode: ThemeMode) => {
    setModeState(newMode);
    localStorage.setItem(STORAGE_KEY, newMode);
    applyTheme(newMode);
  }, [applyTheme]);

  useEffect(() => {
    applyTheme(mode);

    if (mode === 'system') {
      const mq = window.matchMedia('(prefers-color-scheme: dark)');
      const handler = () => applyTheme('system');
      mq.addEventListener('change', handler);
      return () => mq.removeEventListener('change', handler);
    }
  }, [mode, applyTheme]);

  return { mode, resolved, setMode };
}
