import { inBounds, isSolid, key, tileAt } from './map';
import type { GameMap, Vec } from './types';

export type Mover = 'colonist' | 'creature' | 'burrowed';

export interface MoveOpts {
  mover: Mover;
  /** Tiles that cannot be entered at all (enemy units). */
  blocked: Set<number>;
  /** Tiles that can be passed through but not ended on (friendly units). */
  occupied: Set<number>;
  /** Ignore elevation cost (Climbers). */
  climbers?: boolean;
}

const DIRS: [number, number][] = [
  [1, 0], [-1, 0], [0, 1], [0, -1],
  [1, 1], [1, -1], [-1, 1], [-1, -1],
];

/** Cost of stepping from `a` to the neighbouring tile `b`, or Infinity. */
export function stepCost(map: GameMap, a: Vec, b: Vec, opts: MoveOpts): number {
  const diag = a.x !== b.x && a.y !== b.y;
  const base = diag ? 1.5 : 1;
  const tb = tileAt(map, b.x, b.y);
  if (opts.mover === 'burrowed') {
    if (tb.base === 'rock') return Infinity;
    return base;
  }
  if (isSolid(tb)) return Infinity;
  if (diag) {
    // No cutting corners past solid tiles.
    if (isSolid(tileAt(map, a.x, b.y)) || isSolid(tileAt(map, b.x, a.y))) return Infinity;
  }
  const ta = tileAt(map, a.x, a.y);
  const climb = Math.abs(tb.elevation - ta.elevation);
  if (climb >= 2) return Infinity;
  let cost = base;
  if (climb === 1 && !opts.climbers) cost += 1;
  if (tb.structure?.kind === 'lowwall') cost += 1; // vault
  if (tb.growth && opts.mover === 'colonist') cost += 1;
  return cost;
}

/** Can a unit end its move on this tile? */
export function canStand(map: GameMap, p: Vec): boolean {
  if (!inBounds(map, p.x, p.y)) return false;
  const t = tileAt(map, p.x, p.y);
  return !isSolid(t) && t.structure?.kind !== 'lowwall';
}

export interface Reach {
  cost: Map<number, number>;
  prev: Map<number, number>;
}

/** Dijkstra out to `maxCost`. */
export function reach(map: GameMap, from: Vec, maxCost: number, opts: MoveOpts): Reach {
  const cost = new Map<number, number>();
  const prev = new Map<number, number>();
  const start = key(from);
  cost.set(start, 0);
  // Small maps: a simple array-backed frontier is fast enough.
  const frontier: { k: number; c: number; p: Vec }[] = [{ k: start, c: 0, p: from }];
  while (frontier.length) {
    let bi = 0;
    for (let i = 1; i < frontier.length; i++) if (frontier[i].c < frontier[bi].c) bi = i;
    const cur = frontier[bi];
    frontier[bi] = frontier[frontier.length - 1];
    frontier.pop();
    if (cur.c > (cost.get(cur.k) ?? Infinity)) continue;
    for (const [dx, dy] of DIRS) {
      const n = { x: cur.p.x + dx, y: cur.p.y + dy };
      if (!inBounds(map, n.x, n.y)) continue;
      const nk = key(n);
      if (opts.blocked.has(nk)) continue;
      const c = cur.c + stepCost(map, cur.p, n, opts);
      if (c > maxCost) continue;
      if (c < (cost.get(nk) ?? Infinity)) {
        cost.set(nk, c);
        prev.set(nk, cur.k);
        frontier.push({ k: nk, c, p: n });
      }
    }
  }
  return { cost, prev };
}

export function unkey(k: number): Vec {
  return { x: k % 1000, y: Math.floor(k / 1000) };
}

export function pathTo(r: Reach, to: Vec): Vec[] {
  const out: Vec[] = [];
  let k: number | undefined = key(to);
  if (!r.cost.has(k)) return out;
  while (k !== undefined) {
    out.push(unkey(k));
    k = r.prev.get(k);
  }
  return out.reverse();
}

/** Tiles a unit could end a move on within `maxCost`. */
export function destinations(map: GameMap, r: Reach, opts: MoveOpts): Vec[] {
  const out: Vec[] = [];
  for (const k of r.cost.keys()) {
    if (opts.occupied.has(k)) continue;
    const p = unkey(k);
    if (opts.mover === 'burrowed') {
      if (tileAt(map, p.x, p.y).base === 'rock') continue;
    } else if (!canStand(map, p)) continue;
    out.push(p);
  }
  return out;
}
