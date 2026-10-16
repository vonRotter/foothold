import { describe, expect, it } from 'vitest';
import { coverAgainst, hasLos, parseMap, tileAt } from '../src/sim/map';
import { reach } from '../src/sim/path';

describe('map', () => {
  it('parses a 40×40 map with four approaches', () => {
    const m = parseMap();
    expect(m.tiles.length).toBe(1600);
    expect(m.approaches.map((a) => a.id)).toEqual(['ravine', 'ridge', 'forest', 'riverbed']);
  });

  it('every approach can reach the landing pad', () => {
    const m = parseMap();
    for (const ap of m.approaches) {
      const r = reach(m, ap.entry[2], 400, { mover: 'creature', blocked: new Set(), occupied: new Set() });
      expect(r.cost.has(20 * 1000 + 17), ap.id).toBe(true);
    }
  });

  it('a wall gives full cover against shots from its side only', () => {
    const m = parseMap();
    tileAt(m, 15, 25).structure = { kind: 'wall', overgrowth: 0 };
    const d = { x: 15, y: 26 };
    expect(coverAgainst(m, d, { x: 15, y: 20 })).toBe(2);
    expect(coverAgainst(m, d, { x: 15, y: 31 })).toBe(0);
  });

  it('overgrowth eats cover', () => {
    const m = parseMap();
    tileAt(m, 15, 25).structure = { kind: 'lowwall', overgrowth: 2 };
    expect(coverAgainst(m, { x: 15, y: 26 }, { x: 15, y: 20 })).toBe(0);
  });

  it('rock blocks sight; thorn blocks sight', () => {
    const m = parseMap();
    expect(hasLos(m, { x: 13, y: 14 }, { x: 15, y: 14 }, 15)).toBe(false); // rock at 14,14
    tileAt(m, 16, 16).growth = true;
    expect(hasLos(m, { x: 16, y: 13 }, { x: 16, y: 19 }, 15)).toBe(false);
    expect(hasLos(m, { x: 12, y: 17 }, { x: 18, y: 17 }, 15)).toBe(true);
  });
});
