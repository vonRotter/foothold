import type { Approach, Building, CoverLevel, GameMap, Tile, Vec } from './types';

// The one map. Hand-built, 48×48, north at the top. Two layers of the same size.
//
// Height, 0–3. A step of 1 is a slope (costs a move); a step of 2 or more is a cliff
// (cannot be crossed, and gives full cover against shots from below).
const HEIGHT = `
000000000002222222222000000222222222222222222222
000000000002223333322000000222222222222222222222
000000000002223333322000000222333333222222222222
000000000002223333322000000222333333222222222222
000000000002223333322000000222333333222222222222
000000000002223333322000000222333333222222222222
000000000002222222222000000222333333222222222222
000000000002222222222000000222222222222222222222
000000000002222222222000000222222222222222222222
000000000002222222222000000222222222222222222222
000000000000000000000000000000000000022222222222
000000000000000000000000000000000000022222222222
000000000000000000000000000000000000022222222222
000000000000000000000000000000000000022223333322
000000000000000000000000000000000000022223333322
000000000000000111100000000000000000022223333322
000000000000000122100000000000000000022223333322
000000000000000122100000000000000000022223333322
000000000000000111100000000000000000022223333322
000000000000000000000000000000000111122222222222
000000000000000000000000000000000111122222222222
000000000000000000000000000000000111122222222222
000000000000000000000000000000000111122222222222
000000000000000000000000000000000111122222222222
000000000000000000000000000000000000022223333322
000000000000000000000000000000000000022223333322
000000000000000000000000000000000000022223333322
000000000000000000000000000000000000022223333322
000000000000000000000000000001111000022223333322
000000000000000000000000000001111000022223333322
000000000000000000000000000001111000022223333322
000000000000000000000000000001111000022223333322
000000000000000000000000000000000000022222222222
000000000000000000000000000000000000022222222222
000000000000000000000000000000000000022222222222
000000000000000000000000000000000000022222222222
000000000000000000000000000000000000022222222222
000000000000000000000000000000000000000000000000
000000000000000000000000000000000000000000000000
000000000000000000000000000000000000000000000000
000000000000000000000000000000000000000000000000
000000000000000000000000000000000000000000000000
111111111111111111111111111111111111111111111111
111111111111111111111111111111111111222222222111
111111112222222221111111111111111111222222222111
111111112222222221111111111111111111222222222111
111111112222222221111111111111111111222222222111
111111112222222221111111111111111111222222222111
`;

// Features.
//   .  ground      ,  sand / bank      #  rock      T  tree
//   W  deep water (blocks movement, not sight)      w  ford (shallow, slow)
//   ~  thorn mat (the world's growth at landing)
const FEATURES = `
..T.TT.,WW,...T..............#..................
...TT.TTWW,..T..........,.,..T..........T..T....
T..T...TWW,#..............TT....................
T.T..T.TWW,..........#.....T........#.T.........
T.T.TTT.WW........#.....T.#........T............
T.....T,WW,..........#,.........................
TT..TTT,WW#...............,.....T#.........T..T.
...T..T.WW,....T.....#,..,...............T#...#.
.T...T..WW...........#.~~~,...#...........T....#
....T...WW#..T..T.#...,~~~..#.....T.............
.T.....TWW,T.....#.#..,.,....##...#..#..#.......
..TTT..,WW,..............................#......
T.T.TT.TWW~~.......#.......................T....
T......,WW~~........................#.#.T...#...
TT.T...,WW~~................#.......#...........
.TT..T.,WW~~.....................#..............
..T...T,WW..................................#...
.T....T,WW,.....................................
T..T.TT.WW..TT.........................T.....T..
..TT..T.WW...T..................................
.....T..WW,.T#..................................
...TT..TWW,.....................................
...T....ww,.....................................
.......Tww,.....................................
.....T.TwwTT........................#....T......
........WW,...................................#.
........WW,.....................................
.TTTT...WW,.........................#...........
TTT...TTWW....#.......................#T.....T..
...T..T.WW,.T...................................
T..T..TTWW~~~......................#............
T.T.....WW~~~.......................#.........#.
T....T.,WW~~~.......#.................##......#.
..T....,WW,T#...........................T..#...T
T.TT.TT.WW,..T..................................
.T..T..,WW,............#............#...........
T.....T,WWT....................#................
.TTTTTTTWW............................#.....#...
.......,WW,,..,..,,,,.,,.,.,...,...,.,.,,,,,,..,
T..T.T.TWWWWWWWWWWWWWWWWWWWwwwWWWWWWWWWWWWWWWWWW
..T.T..TWWWWWWWWWWWWWWWWWWWwwwWWWWWWWWWWWWWWWWWW
T..T.TTT..,.,,.,,.,,,,.,,.,.,.,,,,,,~~~.,,,,,..,
........................TT..........~~~.........
T...................~~~~~.......T....T#.....T...
.......T....T...T...~~~~~....................TT.
........T.......#..........T....T....T........T.
..............................T......T.....T....
...T.....T....#..T....T.............TT#....#....
`;

export const MAP_SIZE = 48;
export const CENTER: Vec = { x: 24, y: 24 };
/**
 * The colony can build and deploy within this Chebyshev radius of the centre.
 * The starting base fills only the middle of it, so there is room to grow.
 */
export const COLONY_RADIUS = 10;

function range(a: number, b: number): number[] {
  const out: number[] = [];
  for (let i = a; i <= b; i++) out.push(i);
  return out;
}

const APPROACHES: Approach[] = [
  { id: 'ravine', name: 'the ravine', entry: range(21, 26).map((x) => ({ x, y: 0 })) },
  { id: 'ridge', name: 'the ridge pass', entry: range(19, 23).map((y) => ({ x: 47, y })) },
  { id: 'forest', name: 'the forest across the river', entry: range(21, 25).map((y) => ({ x: 0, y })) },
  { id: 'ford', name: 'the southern ford', entry: range(26, 30).map((x) => ({ x, y: 47 })) },
];

export function parseMap(): GameMap {
  const hRows = HEIGHT.trim().split('\n');
  const fRows = FEATURES.trim().split('\n');
  if (hRows.length !== MAP_SIZE || fRows.length !== MAP_SIZE) throw new Error('map layers must be 48 rows');
  const tiles: Tile[] = [];
  for (let y = 0; y < MAP_SIZE; y++) {
    if (hRows[y].length !== MAP_SIZE || fRows[y].length !== MAP_SIZE) throw new Error(`map row ${y} is not 48 wide`);
    for (let x = 0; x < MAP_SIZE; x++) {
      const t: Tile = { base: 'ground', elevation: Number(hRows[y][x]), structure: null, buildingId: null, growth: false, burned: false, rubble: false };
      switch (fRows[y][x]) {
        case ',': t.base = 'sand'; break;
        case '#': t.base = 'rock'; break;
        case 'T': t.base = 'tree'; break;
        case 'W': t.base = 'water'; break;
        case 'w': t.base = 'ford'; break;
        case '~': t.growth = true; break;
        case '.': break;
        default: throw new Error(`unknown map glyph ${fRows[y][x]}`);
      }
      tiles.push(t);
    }
  }
  for (const ap of APPROACHES) {
    for (const p of ap.entry) {
      const t = tiles[p.y * MAP_SIZE + p.x];
      if (t.base !== 'sand') t.base = 'ground';
      t.growth = false;
    }
  }
  return { w: MAP_SIZE, h: MAP_SIZE, tiles, approaches: APPROACHES.map((a) => ({ ...a, entry: a.entry.map((p) => ({ ...p })) })) };
}

export function inBounds(map: GameMap, x: number, y: number): boolean {
  return x >= 0 && y >= 0 && x < map.w && y < map.h;
}

export function tileAt(map: GameMap, x: number, y: number): Tile {
  return map.tiles[y * map.w + x];
}

export function key(p: Vec): number {
  return p.y * 1000 + p.x;
}

export function samePos(a: Vec, b: Vec): boolean {
  return a.x === b.x && a.y === b.y;
}

export function dist(a: Vec, b: Vec): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function chebyshev(a: Vec, b: Vec): number {
  return Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
}

export function adjacent(a: Vec, b: Vec): boolean {
  return chebyshev(a, b) === 1;
}

/** Something stands here that no one can walk through or see through. */
export function isSolid(t: Tile): boolean {
  return t.base === 'rock' || t.base === 'tree' || t.buildingId !== null || t.structure?.kind === 'wall';
}

/** Deep water: nothing walks through it, but you can see and shoot across it. */
export function isWater(t: Tile): boolean {
  return t.base === 'water';
}

/** Inside the area the colony can build on and deploy to. */
export function inColony(p: Vec): boolean {
  return chebyshev(p, CENTER) <= COLONY_RADIUS;
}

export function blocksSight(t: Tile): boolean {
  return t.base === 'rock' || t.buildingId !== null || t.structure?.kind === 'wall' || t.growth;
}

/** Cover a tile provides to someone standing next to it. */
export function coverValue(t: Tile): CoverLevel {
  if (t.base === 'rock' || t.buildingId !== null) return 2;
  if (t.structure) {
    const base: CoverLevel = t.structure.kind === 'wall' ? 2 : 1;
    // Growth eats cover: an overgrown structure gives one level less.
    return (t.structure.overgrowth >= 2 ? Math.max(0, base - 1) : base) as CoverLevel;
  }
  if (t.base === 'tree' || t.growth || t.rubble) return 1;
  return 0;
}

/**
 * Cover the defender at `d` has against an attacker at `a`.
 * Looks at the neighbouring tiles on the attacker's side. A higher attacker drops it one level.
 */
export function coverAgainst(map: GameMap, d: Vec, a: Vec, opts: { ignoreElevation?: boolean } = {}): CoverLevel {
  if (adjacent(d, a)) return 0;
  const dx = Math.sign(a.x - d.x);
  const dy = Math.sign(a.y - d.y);
  const here = tileAt(map, d.x, d.y);
  let best = 0;
  const consider = (x: number, y: number) => {
    if (!inBounds(map, x, y)) return;
    const t = tileAt(map, x, y);
    let c: number = coverValue(t);
    if (t.elevation > here.elevation) c = 2; // a cliff face
    best = Math.max(best, c);
  };
  // Only neighbours that actually face the attacker count; a shot from a steep angle
  // only checks the dominant axis.
  const ax = Math.abs(a.x - d.x);
  const ay = Math.abs(a.y - d.y);
  if (dx !== 0 && ax * 2 >= ay) consider(d.x + dx, d.y);
  if (dy !== 0 && ay * 2 >= ax) consider(d.x, d.y + dy);
  if (!opts.ignoreElevation && tileAt(map, a.x, a.y).elevation > here.elevation) best = Math.max(0, best - 1);
  return best as CoverLevel;
}

/** Tiles strictly between a and b along the line between their centres. */
export function lineTiles(a: Vec, b: Vec): Vec[] {
  const out: Vec[] = [];
  const seen = new Set<number>();
  const d = Math.max(Math.abs(b.x - a.x), Math.abs(b.y - a.y));
  if (d === 0) return out;
  const steps = d * 8;
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    const x = Math.round(a.x + (b.x - a.x) * t);
    const y = Math.round(a.y + (b.y - a.y) * t);
    if ((x === a.x && y === a.y) || (x === b.x && y === b.y)) continue;
    const k = y * 1000 + x;
    if (!seen.has(k)) {
      seen.add(k);
      out.push({ x, y });
    }
  }
  return out;
}

/**
 * Line of sight between two tiles. Blocked by anything solid to sight, or by ground
 * that rises above both ends. Standing next to a blocker does not block your own view
 * out of it (you lean out), so blockers adjacent to either end are only counted if the
 * line runs straight through them along an axis.
 */
export function hasLos(map: GameMap, a: Vec, b: Vec, sight: number): boolean {
  if (dist(a, b) > sight) return false;
  const ea = tileAt(map, a.x, a.y).elevation;
  const eb = tileAt(map, b.x, b.y).elevation;
  const top = Math.max(ea, eb);
  for (const p of lineTiles(a, b)) {
    const t = tileAt(map, p.x, p.y);
    if (t.elevation > top) return false;
    if (!blocksSight(t)) continue;
    const leanA = adjacent(p, a) && p.x !== a.x && p.y !== a.y;
    const leanB = adjacent(p, b) && p.x !== b.x && p.y !== b.y;
    if (leanA || leanB) continue;
    return false;
  }
  return true;
}

export function buildingTiles(b: Building): Vec[] {
  const out: Vec[] = [];
  for (let y = b.pos.y; y < b.pos.y + b.size; y++) for (let x = b.pos.x; x < b.pos.x + b.size; x++) out.push({ x, y });
  return out;
}

/** Is `p` next to (or on) a building's footprint? */
export function touchesBuilding(p: Vec, b: Building): boolean {
  return p.x >= b.pos.x - 1 && p.x <= b.pos.x + b.size && p.y >= b.pos.y - 1 && p.y <= b.pos.y + b.size;
}

export function placeBuilding(map: GameMap, b: Building): void {
  for (const p of buildingTiles(b)) {
    const t = tileAt(map, p.x, p.y);
    t.buildingId = b.id;
    t.structure = null;
    t.growth = false;
  }
}

export function destroyBuilding(map: GameMap, b: Building): void {
  b.destroyed = true;
  b.hp = 0;
  for (const p of buildingTiles(b)) {
    const t = tileAt(map, p.x, p.y);
    t.buildingId = null;
    t.rubble = true;
  }
}

/** Can a building of this size be dropped with its corner at `pos`? */
export function canPlaceBuilding(map: GameMap, pos: Vec, size: number): boolean {
  for (let y = pos.y; y < pos.y + size; y++) {
    for (let x = pos.x; x < pos.x + size; x++) {
      if (!inBounds(map, x, y)) return false;
      const t = tileAt(map, x, y);
      if (t.base === 'rock' || t.base === 'tree' || t.base === 'water' || t.base === 'ford' || t.buildingId || t.structure) return false;
      if (t.elevation !== tileAt(map, pos.x, pos.y).elevation) return false;
      if (!inColony({ x, y })) return false;
    }
  }
  return true;
}
