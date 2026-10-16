import { inBounds, isSolid, isWater, key, tileAt } from './map';
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
    // Underground: under walls, buildings and the river; only bedrock stops it.
    if (tb.base === 'rock') return Infinity;
    return base;
  }
  if (isSolid(tb) || isWater(tb)) return Infinity;
  if (diag) {
    // No cutting corners past solid tiles.
    const s1 = tileAt(map, a.x, b.y);
    const s2 = tileAt(map, b.x, a.y);
    if (isSolid(s1) || isSolid(s2) || isWater(s1) || isWater(s2)) return Infinity;
  }
  const ta = tileAt(map, a.x, a.y);
  const climb = Math.abs(tb.elevation - ta.elevation);
  if (climb >= 2) return Infinity;
  let cost = base;
  if (climb === 1 && !opts.climbers) cost += 1;
  if (tb.structure && tb.structure.kind !== 'wall') cost += 1; // vault a low wall or crate
  if (tb.base === 'ford') cost += 1; // wading
  if (tb.growth && opts.mover === 'colonist') cost += 1;
  return cost;
}

/** Can a unit end its move on this tile? */
export function canStand(map: GameMap, p: Vec): boolean {
  if (!inBounds(map, p.x, p.y)) return false;
  const t = tileAt(map, p.x, p.y);
  return !isSolid(t) && !isWater(t) && !t.structure;
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
  const heap = new MinHeap();
  heap.push(0, start, from.x, from.y);
  while (heap.size) {
    const cur = heap.pop();
    if (cur.c > (cost.get(cur.k) ?? Infinity)) continue;
    const p = { x: cur.x, y: cur.y };
    for (const [dx, dy] of DIRS) {
      const n = { x: p.x + dx, y: p.y + dy };
      if (!inBounds(map, n.x, n.y)) continue;
      const nk = key(n);
      if (opts.blocked.has(nk)) continue;
      const c = cur.c + stepCost(map, p, n, opts);
      if (c > maxCost) continue;
      if (c < (cost.get(nk) ?? Infinity)) {
        cost.set(nk, c);
        prev.set(nk, cur.k);
        heap.push(c, nk, n.x, n.y);
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
      const t = tileAt(map, p.x, p.y);
      if (t.base === 'rock' || isWater(t)) continue;
    } else if (!canStand(map, p)) continue;
    out.push(p);
  }
  return out;
}

/** Binary min-heap keyed on cost, for Dijkstra. */
class MinHeap {
  private c: number[] = [];
  private k: number[] = [];
  private x: number[] = [];
  private y: number[] = [];

  get size(): number {
    return this.c.length;
  }

  push(c: number, k: number, x: number, y: number) {
    this.c.push(c);
    this.k.push(k);
    this.x.push(x);
    this.y.push(y);
    let i = this.c.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.c[parent] <= this.c[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): { c: number; k: number; x: number; y: number } {
    const top = { c: this.c[0], k: this.k[0], x: this.x[0], y: this.y[0] };
    const last = this.c.length - 1;
    this.swap(0, last);
    this.c.pop();
    this.k.pop();
    this.x.pop();
    this.y.pop();
    let i = 0;
    for (;;) {
      const l = 2 * i + 1;
      const r = l + 1;
      let m = i;
      if (l < this.c.length && this.c[l] < this.c[m]) m = l;
      if (r < this.c.length && this.c[r] < this.c[m]) m = r;
      if (m === i) break;
      this.swap(i, m);
      i = m;
    }
    return top;
  }

  private swap(a: number, b: number) {
    [this.c[a], this.c[b]] = [this.c[b], this.c[a]];
    [this.k[a], this.k[b]] = [this.k[b], this.k[a]];
    [this.x[a], this.x[b]] = [this.x[b], this.x[a]];
    [this.y[a], this.y[b]] = [this.y[b], this.y[a]];
  }
}
