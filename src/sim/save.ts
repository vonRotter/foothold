// Saving is a snapshot of the campaign: all of its state is plain data (including the
// random generator's state), so a restored campaign continues exactly as the original would.

import type { AdaptationId, Campaign } from './types';

/** Bump when the shape of Campaign changes in a way old saves cannot be read into. */
export const SAVE_VERSION = 1;

export interface SaveFile {
  version: number;
  savedAt: string;
  campaign: Campaign;
  /** Adaptations the player has learned about (interface state worth keeping). */
  known: AdaptationId[];
}

export function serialize(c: Campaign, known: Iterable<AdaptationId>): string {
  const file: SaveFile = { version: SAVE_VERSION, savedAt: new Date().toISOString(), campaign: c, known: [...known] };
  return JSON.stringify(file);
}

/** Parse a save, or null if it is missing, damaged, or from an incompatible version. */
export function deserialize(text: string | null): SaveFile | null {
  if (!text) return null;
  try {
    const f = JSON.parse(text) as SaveFile;
    if (f.version !== SAVE_VERSION) return null;
    const c = f.campaign;
    if (!c || !c.map?.tiles?.length || !Array.isArray(c.colonists) || typeof c.rng?.state !== 'number') return null;
    return { ...f, known: Array.isArray(f.known) ? f.known : [] };
  } catch {
    return null;
  }
}

/** A short line for the title screen: where the saved campaign stands. */
export function describeSave(f: SaveFile): string {
  const c = f.campaign;
  const alive = c.colonists.filter((x) => x.status === 'active').length;
  const where = c.battle
    ? c.battle.phase === 'deploy'
      ? `Mission ${c.battle.attack} of ${c.totalAttacks}, deployment`
      : `Mission ${c.battle.attack} of ${c.totalAttacks}, turn ${c.battle.turn}`
    : `Building before mission ${c.attack} of ${c.totalAttacks}`;
  return `${where} · ${alive} of ${c.colonists.length} colonists · seed ${c.seed}`;
}
