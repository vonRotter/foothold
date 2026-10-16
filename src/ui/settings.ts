// Player preferences, kept in this browser. URL options (?quality=low etc.) override them.

export interface Settings {
  quality: 'high' | 'low';
  /** Enemy-turn playback: normal, fast (2.5×), or instant (no animation). */
  speed: 'normal' | 'fast' | 'instant';
  models: boolean;
}

const KEY = 'foothold.settings';
export const DEFAULTS: Settings = { quality: 'high', speed: 'normal', models: true };

export function loadSettings(): Settings {
  try {
    const raw = JSON.parse(localStorage.getItem(KEY) ?? '{}') as Partial<Settings>;
    return {
      quality: raw.quality === 'low' ? 'low' : 'high',
      speed: raw.speed === 'fast' || raw.speed === 'instant' ? raw.speed : 'normal',
      models: raw.models !== false,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveSettings(s: Settings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    // Unavailable storage: the choice lasts until the page is closed.
  }
}

/** Settings with any URL overrides applied: ?quality=low, ?instant=1, ?models=0. */
export function effectiveSettings(params: URLSearchParams): Settings {
  const s = loadSettings();
  if (params.get('quality') === 'low' || params.get('quality') === 'high') s.quality = params.get('quality') as Settings['quality'];
  if (params.get('instant') === '1') s.speed = 'instant';
  if (params.get('models') === '0') s.models = false;
  return s;
}
