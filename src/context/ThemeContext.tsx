import { createContext, useContext, useState, useEffect, useCallback, useMemo, type ReactNode } from 'react';

export type Mode = 'light' | 'dark';
export type NamedPresetId = 'default' | 'warm';
export type PresetId = NamedPresetId | 'custom';

export interface ThemeColors {
  bg: string;
  panel: string;
}

interface PresetDef {
  label: string;
  colors: ThemeColors;
}

export const LIGHT_PRESETS: Record<NamedPresetId, PresetDef> = {
  default: { label: 'Himmelblau', colors: { bg: '#eff6ff', panel: '#ffffff' } },
  warm:    { label: 'Sepia',      colors: { bg: '#f5efdc', panel: '#fdfaf2' } },
};

export const DARK_PRESETS: Record<NamedPresetId, PresetDef> = {
  default: { label: 'Schiefer',    colors: { bg: '#030712', panel: '#111827' } },
  warm:    { label: 'Mitternacht', colors: { bg: '#0c1220', panel: '#162032' } },
};

interface ThemeState {
  mode: Mode;
  lightPreset: PresetId;
  darkPreset: PresetId;
  customLight: ThemeColors;
  customDark: ThemeColors;
}

interface ThemeContextType {
  mode: Mode;
  /** Backward-compat alias for mode */
  theme: Mode;
  activePreset: PresetId;
  activeColors: ThemeColors;
  toggle: () => void;
  setPreset: (id: PresetId) => void;
  setCustomColor: (key: keyof ThemeColors, value: string) => void;
}

const STORAGE_KEY = 'schulchat_theme_v2';

function loadState(): ThemeState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return JSON.parse(raw) as ThemeState;
  } catch { /* ignore */ }
  const legacy = localStorage.getItem('schulchat_theme');
  const mode: Mode =
    legacy === 'dark' || legacy === 'light'
      ? legacy
      : window.matchMedia('(prefers-color-scheme: dark)').matches
      ? 'dark'
      : 'light';
  return {
    mode,
    lightPreset: 'default',
    darkPreset: 'default',
    customLight: { bg: '#eff6ff', panel: '#ffffff' },
    customDark: { bg: '#030712', panel: '#111827' },
  };
}

function deriveColors(state: ThemeState): ThemeColors {
  const preset = state.mode === 'light' ? state.lightPreset : state.darkPreset;
  if (preset === 'custom') {
    return state.mode === 'light' ? state.customLight : state.customDark;
  }
  const presets = state.mode === 'light' ? LIGHT_PRESETS : DARK_PRESETS;
  return (presets[preset as NamedPresetId] ?? presets.default).colors;
}

function applyColors(mode: Mode, colors: ThemeColors) {
  const el = document.documentElement;
  el.classList.toggle('dark', mode === 'dark');
  el.style.setProperty('--theme-bg', colors.bg);
  el.style.setProperty('--theme-panel', colors.panel);
}

const ThemeContext = createContext<ThemeContextType | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<ThemeState>(loadState);

  useEffect(() => {
    const colors = deriveColors(state);
    applyColors(state.mode, colors);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }, [state]);

  const toggle = useCallback(() => {
    setState((s) => ({ ...s, mode: s.mode === 'dark' ? 'light' : 'dark' }));
  }, []);

  const setPreset = useCallback((id: PresetId) => {
    setState((s) => {
      if (id !== 'custom') {
        return s.mode === 'light' ? { ...s, lightPreset: id } : { ...s, darkPreset: id };
      }
      // Switching to custom: seed from current active colors so it's a seamless transition
      const currentColors = deriveColors(s);
      if (s.mode === 'light') {
        return { ...s, lightPreset: 'custom', customLight: currentColors };
      }
      return { ...s, darkPreset: 'custom', customDark: currentColors };
    });
  }, []);

  const setCustomColor = useCallback((key: keyof ThemeColors, value: string) => {
    setState((s) => {
      if (s.mode === 'light') {
        return { ...s, lightPreset: 'custom', customLight: { ...s.customLight, [key]: value } };
      }
      return { ...s, darkPreset: 'custom', customDark: { ...s.customDark, [key]: value } };
    });
  }, []);

  const value = useMemo((): ThemeContextType => {
    const activePreset = state.mode === 'light' ? state.lightPreset : state.darkPreset;
    const activeColors = deriveColors(state);
    return { mode: state.mode, theme: state.mode, activePreset, activeColors, toggle, setPreset, setCustomColor };
  }, [state, toggle, setPreset, setCustomColor]);

  return <ThemeContext value={value}>{children}</ThemeContext>;
}

export function useTheme() {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
