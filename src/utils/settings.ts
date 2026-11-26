import type { AccentThemeId, AppSettings } from '../types/timeline';

export interface AccentThemeConfig {
  id: AccentThemeId;
  name: string;
  primary: string;
  glow: string;
  softBg: string;
  border: string;
  text: string;
  buttonBg: string;
  buttonText: string;
}

export const ACCENT_THEMES: Record<AccentThemeId, AccentThemeConfig> = {
  CYAN: {
    id: 'CYAN',
    name: 'Cyber Cyan',
    primary: '#22d3ee',
    glow: 'rgba(34, 211, 238, 0.35)',
    softBg: 'rgba(34, 211, 238, 0.16)',
    border: 'rgba(34, 211, 238, 0.48)',
    text: '#a5f3fc',
    buttonBg: '#22d3ee',
    buttonText: '#020617',
  },
  CRIMSON: {
    id: 'CRIMSON',
    name: 'Prague Crimson',
    primary: '#f43f5e',
    glow: 'rgba(244, 63, 94, 0.35)',
    softBg: 'rgba(244, 63, 94, 0.16)',
    border: 'rgba(244, 63, 94, 0.50)',
    text: '#fecdd3',
    buttonBg: '#f43f5e',
    buttonText: '#ffffff',
  },
  EMERALD: {
    id: 'EMERALD',
    name: 'Emerald Pulse',
    primary: '#10b981',
    glow: 'rgba(16, 185, 129, 0.35)',
    softBg: 'rgba(16, 185, 129, 0.16)',
    border: 'rgba(16, 185, 129, 0.48)',
    text: '#a7f3d0',
    buttonBg: '#10b981',
    buttonText: '#022c22',
  },
  AMBER: {
    id: 'AMBER',
    name: 'Solar Amber',
    primary: '#f59e0b',
    glow: 'rgba(245, 158, 11, 0.35)',
    softBg: 'rgba(245, 158, 11, 0.16)',
    border: 'rgba(245, 158, 11, 0.50)',
    text: '#fde68a',
    buttonBg: '#f59e0b',
    buttonText: '#020617',
  },
};

export const DEFAULT_SETTINGS: AppSettings = {
  accentTheme: 'CYAN',
  routeWidth: 4,
  routeGlow: true,
  units: 'METRIC',
  mapStyle: 'DARK',
  enable3D: false,
};

const STORAGE_KEY = 'chronomap.settings.v1';

export function loadSettings(): AppSettings {
  if (typeof window === 'undefined' || !window.localStorage) {
    return DEFAULT_SETTINGS;
  }
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const accentTheme =
      parsed.accentTheme && parsed.accentTheme in ACCENT_THEMES
        ? parsed.accentTheme
        : DEFAULT_SETTINGS.accentTheme;
    const routeWidth =
      typeof parsed.routeWidth === 'number' && Number.isFinite(parsed.routeWidth)
        ? Math.min(8, Math.max(2, Math.round(parsed.routeWidth)))
        : DEFAULT_SETTINGS.routeWidth;
    const routeGlow =
      typeof parsed.routeGlow === 'boolean' ? parsed.routeGlow : DEFAULT_SETTINGS.routeGlow;
    const units =
      parsed.units === 'IMPERIAL' || parsed.units === 'METRIC'
        ? parsed.units
        : DEFAULT_SETTINGS.units;
    const mapStyle =
      parsed.mapStyle === 'DARK' ||
      parsed.mapStyle === 'SATELLITE' ||
      parsed.mapStyle === 'DAYLIGHT'
        ? parsed.mapStyle
        : DEFAULT_SETTINGS.mapStyle;
    const enable3D =
      typeof parsed.enable3D === 'boolean' ? parsed.enable3D : DEFAULT_SETTINGS.enable3D;

    return {
      accentTheme,
      routeWidth,
      routeGlow,
      units,
      mapStyle,
      enable3D,
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(settings: AppSettings): void {
  if (typeof window === 'undefined' || !window.localStorage) return;
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
  } catch {
    // Ignore storage quota errors
  }
}
