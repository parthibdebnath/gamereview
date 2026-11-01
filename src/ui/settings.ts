import { DEFAULT_CONFIG, withSensitivity, type ClassifyConfig, type Sensitivity } from '../core/config';
import { PRESETS, type AnalysisSettings, type PresetName } from '../engine/analyzer';

export type BoardStyle = 'graphite' | 'stone' | 'tide' | 'moss';

export interface Settings {
  preset: PresetName;
  /** Custom depth; overrides the preset's when set. */
  depth?: number;
  multipv: number;
  adaptive: boolean;
  /** 0 = automatic. */
  threads: number;
  brilliant: Sensitivity;
  great: Sensitivity;
  thresholds: { excellent: number; good: number; inaccuracy: number; mistake: number };
  /** Page background (#rrggbb); text and surfaces derive from it. */
  background: string;
  glass: boolean;
  monoMarks: boolean;
  boardStyle: BoardStyle;
  coords: boolean;
  arrows: boolean;
  threats: boolean;
  /** Optional network features: off by default. */
  onlineImport: boolean;
  llm: { enabled: boolean; endpoint: string; model: string; apiKey: string };
}

/** Phones and tablets: User-Agent Client Hints where available, else the UA string / touch-only pointer. */
export function isMobile(): boolean {
  if (typeof navigator === 'undefined') return false;
  const hints = (navigator as Navigator & { userAgentData?: { mobile?: boolean } }).userAgentData;
  if (hints?.mobile !== undefined) return hints.mobile;
  if (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)) return true;
  return typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches && !matchMedia('(pointer: fine)').matches;
}

export const DEFAULT_SETTINGS: Settings = {
  preset: isMobile() ? 'fast' : 'standard',
  multipv: 3,
  adaptive: true,
  threads: 0,
  brilliant: 'normal',
  great: 'normal',
  thresholds: {
    excellent: DEFAULT_CONFIG.excellent,
    good: DEFAULT_CONFIG.good,
    inaccuracy: DEFAULT_CONFIG.inaccuracy,
    mistake: DEFAULT_CONFIG.mistake,
  },
  background: '#000000',
  glass: false,
  monoMarks: false,
  boardStyle: 'graphite',
  coords: true,
  arrows: true,
  threats: true,
  onlineImport: false,
  llm: { enabled: false, endpoint: '', model: '', apiKey: '' },
};

const KEY = 'hindsight.settings.v1';

export function loadSettings(): Settings {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return DEFAULT_SETTINGS;
    const parsed = JSON.parse(raw) as Partial<Settings>;
    return {
      ...DEFAULT_SETTINGS,
      ...parsed,
      thresholds: { ...DEFAULT_SETTINGS.thresholds, ...parsed.thresholds },
      llm: { ...DEFAULT_SETTINGS.llm, ...parsed.llm },
    };
  } catch {
    return DEFAULT_SETTINGS;
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* storage unavailable: settings last for this session only */
  }
}

export function analysisSettings(s: Settings): AnalysisSettings {
  const p = PRESETS[s.preset];
  return { depth: s.depth ?? p.depth, multipv: s.multipv, adaptive: s.adaptive };
}

export function classifyConfig(s: Settings): ClassifyConfig {
  return withSensitivity({ ...DEFAULT_CONFIG, ...s.thresholds }, s.brilliant, s.great);
}

/** Perceptual luminance of a #rrggbb colour (0..1). */
export function luminance(hex: string): number {
  const m = hex.replace('#', '').match(/^([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
  if (!m) return 0;
  const ch = (v: string) => {
    const c = parseInt(v, 16) / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * ch(m[1]) + 0.7152 * ch(m[2]) + 0.0722 * ch(m[3]);
}

export function normalizeHex(hex: string): string {
  const h = hex.trim().replace(/^#/, '');
  if (/^[0-9a-f]{3}$/i.test(h)) return '#' + [...h].map((c) => c + c).join('').toLowerCase();
  if (/^[0-9a-f]{6}$/i.test(h)) return '#' + h.toLowerCase();
  return '#000000';
}

/** Content colour for a background: same rule as the sibling apps (luminance > 0.45 -> black). */
export function contentFor(bg: string): string {
  return luminance(bg) > 0.45 ? '#000000' : '#ffffff';
}

export const BACKGROUNDS: { name: string; hex: string }[] = [
  { name: 'Black', hex: '#000000' },
  { name: 'Graphite', hex: '#1c1c1e' },
  { name: 'Ink', hex: '#0f1720' },
  { name: 'Forest', hex: '#0f1a14' },
  { name: 'Paper', hex: '#ffffff' },
  { name: 'Sand', hex: '#efe9df' },
];

export const BOARD_STYLES: Record<BoardStyle, { name: string; light: string; dark: string }> = {
  graphite: { name: 'Graphite', light: '#c9c9cc', dark: '#86868b' },
  stone: { name: 'Stone', light: '#e6dccb', dark: '#a8927a' },
  tide: { name: 'Tide', light: '#d5dee6', dark: '#7a92a8' },
  moss: { name: 'Moss', light: '#dfe3d3', dark: '#7f9472' },
};

/** Applies the background-derived palette to <html>. */
export function applyTheme(s: Settings): void {
  const root = document.documentElement;
  const bg = normalizeHex(s.background);
  const fg = contentFor(bg);
  root.style.setProperty('--bg', bg);
  root.style.setProperty('--fg', fg);
  root.dataset.light = fg === '#000000' ? '1' : '0';
  root.dataset.glass = s.glass ? '1' : '0';
  const board = BOARD_STYLES[s.boardStyle] ?? BOARD_STYLES.graphite;
  root.style.setProperty('--sq-light', board.light);
  root.style.setProperty('--sq-dark', board.dark);
  const meta = document.querySelector('meta[name="theme-color"]');
  meta?.setAttribute('content', bg);
}
