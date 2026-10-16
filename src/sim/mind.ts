// The mind: the strategic AI. It never acts during an attack. Between attacks it
// (1) pushes one adaptation against what killed it most, and
// (2) chooses what the next attack is for and where it comes from.
// Every choice here is a fixed rule over data the player produced, so every choice
// can be explained afterwards in one sentence.

import { ADAPTATIONS, BUILDINGS, CATEGORY_ORDER, CATEGORY_VALUES, VALUE_LABEL, adaptationFor } from './data';
import { CENTER, buildingTiles, chebyshev, key, tileAt, touchesBuilding } from './map';
import { canStand, reach } from './path';
import type { Adaptation, ApproachId, Building, Campaign, Intent, KillCategory, KillRecord, Vec } from './types';

export interface Tally {
  category: KillCategory;
  counts: Record<string, number>;
  total: number;
}

export function tally(kills: KillRecord[]): Tally[] {
  return CATEGORY_ORDER.map((category) => {
    const counts: Record<string, number> = {};
    for (const v of CATEGORY_VALUES[category]) counts[v] = 0;
    let total = 0;
    for (const k of kills) {
      const v = k[category];
      if (v === null) continue; // area weapons hit no particular part
      counts[v] += 1;
      total += 1;
    }
    return { category, counts, total };
  });
}

export interface Candidate {
  category: KillCategory;
  value: string;
  count: number;
  share: number;
  /**
   * How concentrated the kills were on this value, from 0 (an even spread across the
   * category, or less) to 1 (every kill). This is what lets a 2-value category (time)
   * be compared fairly with 4-value ones.
   */
  concentration: number;
}

export function candidates(kills: KillRecord[]): Candidate[] {
  const out: Candidate[] = [];
  for (const t of tally(kills)) {
    if (t.total === 0) continue;
    const n = CATEGORY_VALUES[t.category].length;
    for (const value of CATEGORY_VALUES[t.category]) {
      const count = t.counts[value];
      if (count === 0) continue;
      // Shares are of all kills, not of the kills that had a value in this category:
      // grenade and flamer kills hit no particular part, and must not let one aimed
      // kill make the body-part category look completely concentrated.
      const share = count / kills.length;
      const concentration = (share - 1 / n) / (1 - 1 / n);
      out.push({ category: t.category, value, count, share, concentration });
    }
  }
  return out;
}

/** The attack number in which a category was last adapted against, or 0 if never. */
function lastAdapted(adaptations: Adaptation[], category: KillCategory): number {
  let last = 0;
  for (const a of adaptations) if (a.category === category) last = Math.max(last, a.after);
  return last;
}

/**
 * The adaptation rule.
 *   1. For each category, measure how concentrated this attack's kills were on one value.
 *   2. Take the most concentrated value across all categories.
 *   3. Ties go to the category adapted least recently, then weapon > part > position > time.
 *   4. The mind never pushes the same change twice; it takes the next candidate instead.
 */
export function chooseAdaptation(kills: KillRecord[], existing: Adaptation[], attack: number): { adaptation: Adaptation; ranked: Candidate[] } | null {
  const have = new Set(existing.map((a) => a.id));
  const ranked = candidates(kills).sort((a, b) => {
    const dc = b.concentration - a.concentration;
    if (Math.abs(dc) > 1e-9) return dc;
    const dr = lastAdapted(existing, a.category) - lastAdapted(existing, b.category);
    if (dr !== 0) return dr;
    const dk = CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category);
    if (dk !== 0) return dk;
    return CATEGORY_VALUES[a.category].indexOf(a.value) - CATEGORY_VALUES[b.category].indexOf(b.value);
  });
  for (const c of ranked) {
    const def = adaptationFor(c.category, c.value);
    if (have.has(def.id)) continue;
    return { adaptation: { id: def.id, category: c.category, value: c.value, after: attack }, ranked };
  }
  return null;
}

/** Plain-language dissection report, written by the xenobiologist. */
export function dissectionReport(kills: KillRecord[], adaptation: Adaptation | null): string[] {
  if (kills.length === 0) return ['There were no bodies to open.'];
  const lines: string[] = [];
  const top = candidates(kills).filter((c) => c.category === 'weapon').sort((a, b) => b.count - a.count)[0];
  lines.push(`We recovered ${kills.length} bodies. Most were killed by ${VALUE_LABEL[top?.value ?? 'ballistic']}.`);
  if (adaptation) {
    const def = ADAPTATIONS.find((a) => a.id === adaptation.id)!;
    lines.push(`The tissue in the young ones is changing. ${def.report}`);
    lines.push(`It looks like a response to ${VALUE_LABEL[adaptation.value]}.`);
  } else {
    lines.push('Nothing in them is changing that I can see.');
  }
  return lines;
}

// ---------------------------------------------------------------- intent

function defenceScore(c: Campaign, b: Building): number {
  let walls = 0;
  for (let y = b.pos.y - 2; y < b.pos.y + b.size + 2; y++) {
    for (let x = b.pos.x - 2; x < b.pos.x + b.size + 2; x++) {
      if (x < 0 || y < 0 || x >= c.map.w || y >= c.map.h) continue;
      const s = tileAt(c.map, x, y).structure;
      if (s) walls += s.kind === 'wall' ? 2 : 1;
    }
  }
  return walls;
}

export function chooseIntent(c: Campaign): Intent {
  const standing = c.buildings.filter((b) => !b.destroyed);
  const alive = c.colonists.filter((x) => x.status === 'active');
  const habitat = standing.find((b) => b.kind === 'habitat');

  if (c.attack === 1 && habitat) {
    return { kind: 'building', buildingId: habitat.id, reason: 'The habitat is the first thing that came down. It has been watching it since.' };
  }
  if (alive.length <= Math.ceil(c.colonists.length / 2)) {
    return { kind: 'colonists', reason: `Only ${alive.length} of you are left. It is coming for the people.` };
  }
  const newest = standing.filter((b) => b.droppedAfter === c.attack - 1 && b.kind !== 'habitat');
  if (newest.length) {
    const b = newest[newest.length - 1];
    return { kind: 'building', buildingId: b.id, reason: `It noticed the ${BUILDINGS[b.kind].name.toLowerCase()}. It is the newest thing you put down.` };
  }
  if (standing.length === 0) return { kind: 'colonists', reason: 'Nothing you built is still standing. It is coming for the people.' };
  const scored = standing
    .map((b) => ({ b, score: defenceScore(c, b) }))
    .sort((p, q) => p.score - q.score || p.b.hp - q.b.hp || p.b.droppedAfter - q.b.droppedAfter);
  const b = scored[0].b;
  return { kind: 'building', buildingId: b.id, reason: `The ${BUILDINGS[b.kind].name.toLowerCase()} has the fewest walls around it.` };
}

/** Tiles from which a creature can strike the intent. */
export function goalTiles(c: Campaign, intent: Intent): Vec[] {
  if (intent.kind === 'building') {
    const b = c.buildings.find((x) => x.id === intent.buildingId)!;
    const fp = new Set(buildingTiles(b).map(key));
    const out: Vec[] = [];
    for (let y = b.pos.y - 1; y <= b.pos.y + b.size; y++) {
      for (let x = b.pos.x - 1; x <= b.pos.x + b.size; x++) {
        const p = { x, y };
        if (fp.has(key(p)) || !touchesBuilding(p, b)) continue;
        if (x < 0 || y < 0 || x >= c.map.w || y >= c.map.h) continue;
        if (canStand(c.map, p)) out.push(p);
      }
    }
    return out;
  }
  return [{ ...CENTER }];
}

/** Approaches ranked by how short the walk is from each to the intent. */
export function rankApproaches(c: Campaign, intent: Intent): { id: ApproachId; cost: number }[] {
  const goals = goalTiles(c, intent);
  return c.map.approaches
    .map((ap) => {
      const mid = ap.entry[Math.floor(ap.entry.length / 2)];
      const r = reach(c.map, mid, 400, { mover: 'creature', blocked: new Set(), occupied: new Set() });
      let best = Infinity;
      for (const g of goals) best = Math.min(best, r.cost.get(key(g)) ?? Infinity);
      if (best === Infinity) best = 1000 + chebyshev(mid, CENTER);
      return { id: ap.id, cost: best };
    })
    .sort((a, b) => a.cost - b.cost);
}
