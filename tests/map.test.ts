import { describe, expect, it } from 'vitest';
import { newCampaign } from '../src/sim/campaign';
import { coverAgainst, hasLos, parseMap, tileAt } from '../src/sim/map';
import { pathTo, reach, stepCost, type MoveOpts } from '../src/sim/path';

const creature: MoveOpts = { mover: 'creature', blocked: new Set(), occupied: new Set() };
const colonist: MoveOpts = { mover: 'colonist', blocked: new Set(), occupied: new Set() };

describe('map', () => {
  it('parses a 48×48 map with four approaches', () => {
    const m = parseMap();
    expect(m.tiles.length).toBe(48 * 48);
    expect(m.approaches.map((a) => a.id)).toEqual(['ravine', 'ridge', 'forest', 'ford']);
  });

  it('every approach can reach the habitat', () => {
    const c = newCampaign(1);
    for (const ap of c.map.approaches) {
      const r = reach(c.map, ap.entry[2], 400, creature);
      // (22, 24) is just west of the habitat, inside the starting walls.
      expect(r.cost.has(24 * 1000 + 22), ap.id).toBe(true);
    }
  });

  it('deep water blocks movement but not sight; the ford can be waded', () => {
    const m = parseMap();
    expect(tileAt(m, 8, 10).base).toBe('water');
    expect(stepCost(m, { x: 7, y: 10 }, { x: 8, y: 10 }, colonist)).toBe(Infinity);
    expect(hasLos(m, { x: 6, y: 10 }, { x: 11, y: 10 }, 15)).toBe(true);
    // Across at the ford, wading costs an extra move.
    expect(tileAt(m, 8, 23).base).toBe('ford');
    expect(stepCost(m, { x: 7, y: 23 }, { x: 8, y: 23 }, colonist)).toBe(2);
    const r = reach(m, { x: 4, y: 23 }, 30, colonist);
    const path = pathTo(r, { x: 12, y: 23 });
    expect(path.some((p) => tileAt(m, p.x, p.y).base === 'ford')).toBe(true);
  });

  it('cliffs cannot be climbed and give full cover from below', () => {
    const m = parseMap();
    expect(tileAt(m, 20, 10).elevation).toBe(0);
    expect(tileAt(m, 20, 9).elevation).toBe(2);
    expect(stepCost(m, { x: 20, y: 10 }, { x: 20, y: 9 }, colonist)).toBe(Infinity);
    // Under the cliff, the face is full cover; a shooter up on the plateau is higher, which drops it to half.
    expect(coverAgainst(m, { x: 20, y: 10 }, { x: 20, y: 4 })).toBe(1);
  });

  it('a wall gives full cover against shots from its side only', () => {
    const m = parseMap();
    tileAt(m, 17, 30).structure = { kind: 'wall', overgrowth: 0 };
    const d = { x: 17, y: 31 };
    expect(coverAgainst(m, d, { x: 17, y: 25 })).toBe(2);
    expect(coverAgainst(m, d, { x: 17, y: 36 })).toBe(0);
  });

  it('overgrowth eats cover', () => {
    const m = parseMap();
    tileAt(m, 17, 30).structure = { kind: 'lowwall', overgrowth: 2 };
    expect(coverAgainst(m, { x: 17, y: 31 }, { x: 17, y: 25 })).toBe(0);
  });

  it('rock blocks sight; thorn blocks sight', () => {
    const m = parseMap();
    expect(tileAt(m, 13, 20).base).toBe('rock');
    expect(hasLos(m, { x: 11, y: 20 }, { x: 15, y: 20 }, 15)).toBe(false);
    tileAt(m, 17, 33).growth = true;
    expect(hasLos(m, { x: 17, y: 31 }, { x: 17, y: 35 }, 15)).toBe(false);
    expect(hasLos(m, { x: 14, y: 26 }, { x: 20, y: 26 }, 15)).toBe(true);
  });
});
