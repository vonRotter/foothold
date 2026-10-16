// The campaign: one map, the same colonists, three attacks. Nothing resets.

import { battleOf } from './combat';
import { BUILDINGS, DAYS_BETWEEN, ROLES, ROSTER, SCAR_ORDER, START_STORES, TOTAL_ATTACKS } from './data';
import { chooseAdaptation } from './mind';
import { CENTER, COLONY_RADIUS, canPlaceBuilding, chebyshev, dist, inBounds, parseMap, placeBuilding, tileAt } from './map';
import { makeRng, next, pick } from './rng';
import type { AttackSummary, Building, BuildingKind, Campaign, Colonist, RoleId, ScarId, StructureKind, Vec } from './types';

export function newCampaign(seed: number): Campaign {
  const map = parseMap();
  const pod: Building = { id: 'pod', kind: 'pod', pos: { x: 19, y: 19 }, size: 3, hp: BUILDINGS.pod.hp, maxHp: BUILDINGS.pod.hp, destroyed: false, droppedAfter: 0 };
  placeBuilding(map, pod);
  const colonists: Colonist[] = ROSTER.map((r, i) => ({
    id: r.id,
    name: r.name,
    role: r.role,
    hp: ROLES[r.role].hp,
    maxHp: ROLES[r.role].hp,
    scars: [],
    downings: 0,
    status: 'active',
    retired: false,
    training: null,
    portraitSeed: seed * 31 + i * 7919,
  }));
  return {
    seed,
    rng: makeRng(seed),
    map,
    buildings: [pod],
    colonists,
    stores: START_STORES,
    salvage: 0,
    attack: 1,
    totalAttacks: TOTAL_ATTACKS,
    adaptations: [],
    kills: [],
    battle: null,
    nextIntent: null,
    reportReady: false,
    history: [],
    lastGrowth: 0,
  };
}

// ---------------------------------------------------------------- after an attack

/**
 * Close the battle: downed colonists become scarred, the mind pushes its adaptation,
 * and the world grows. Returns the summary shown on the aftermath screen.
 */
export function concludeAttack(c: Campaign): AttackSummary {
  const b = battleOf(c);
  if (!b.outcome) throw new Error('battle not over');
  const summary: AttackSummary = {
    attack: b.attack,
    outcome: b.outcome,
    intent: b.intent,
    kills: b.kills.length,
    creatures: b.creatures.length,
    downed: [],
    died: [],
    newScars: [],
    adaptation: null,
  };

  // Everyone who died during the battle.
  for (const col of c.colonists) if (col.status === 'dead' && !c.history.some((h) => h.died.includes(col.id))) summary.died.push(col.id);

  if (b.outcome === 'fallen') {
    // No one left standing: the downed are taken where they lie.
    for (const u of b.units) {
      const col = c.colonists.find((x) => x.id === u.colonistId)!;
      col.status = 'dead';
      col.hp = 0;
      summary.died.push(col.id);
    }
  } else {
    for (const u of b.units) {
      if (!u.everDowned) continue;
      const col = c.colonists.find((x) => x.id === u.colonistId)!;
      col.downings += 1;
      summary.downed.push(col.id);
      const scar = pick(c.rng, SCAR_ORDER) as ScarId;
      if (col.scars.includes(scar)) col.retired = true;
      col.scars.push(scar);
      summary.newScars.push({ colonistId: col.id, scar });
      col.hp = Math.max(1, col.hp);
    }
  }

  c.kills.push(...b.kills);
  const chosen = chooseAdaptation(b.kills, c.adaptations, b.attack);
  if (chosen) {
    c.adaptations.push(chosen.adaptation);
    summary.adaptation = chosen.adaptation;
  }
  c.history.push(summary);
  c.reportReady = false;
  c.lastGrowth = growWorld(c);
  return summary;
}

export function campaignOver(c: Campaign): 'won' | 'fallen' | null {
  if (c.colonists.every((x) => x.status === 'dead')) return 'fallen';
  if (c.history.length >= c.totalAttacks) return 'won';
  return null;
}

/** Prepare for the next attack once the days between are spent. */
export function advanceToNextAttack(c: Campaign): void {
  c.attack += 1;
  c.battle = null;
}

// ---------------------------------------------------------------- the world grows

/** Thorn mats spread from the forest and existing growth, leaning toward the colony. */
export function growWorld(c: Campaign): number {
  const n = 6 + 3 * c.history.length;
  let grown = 0;
  for (let i = 0; i < n; i++) {
    const cands: { p: Vec; w: number }[] = [];
    for (let y = 0; y < c.map.h; y++) {
      for (let x = 0; x < c.map.w; x++) {
        const t = tileAt(c.map, x, y);
        if (t.growth || t.burned || t.base === 'rock' || t.base === 'tree' || t.base === 'pad' || t.buildingId || t.structure) continue;
        let seeded = false;
        for (let dy = -1; dy <= 1 && !seeded; dy++)
          for (let dx = -1; dx <= 1 && !seeded; dx++) {
            if (!dx && !dy) continue;
            const nx = x + dx;
            const ny = y + dy;
            if (!inBounds(c.map, nx, ny)) continue;
            const nt = tileAt(c.map, nx, ny);
            if (nt.growth || (nt.base === 'tree' && !nt.burned)) seeded = true;
          }
        if (!seeded) continue;
        // The world pushes inward.
        const w = 1 / (1 + dist({ x, y }, CENTER) / 5);
        cands.push({ p: { x, y }, w });
      }
    }
    if (!cands.length) break;
    const total = cands.reduce((s, q) => s + q.w, 0);
    let r = next(c.rng) * total;
    let chosen = cands[cands.length - 1].p;
    for (const q of cands) {
      r -= q.w;
      if (r <= 0) {
        chosen = q.p;
        break;
      }
    }
    tileAt(c.map, chosen.x, chosen.y).growth = true;
    grown += 1;
  }
  // Growth eats cover: every structure touching growth is overgrown a little more.
  for (let y = 0; y < c.map.h; y++)
    for (let x = 0; x < c.map.w; x++) {
      const s = tileAt(c.map, x, y).structure;
      if (!s) continue;
      let touch = false;
      for (let dy = -1; dy <= 1; dy++)
        for (let dx = -1; dx <= 1; dx++) {
          if (inBounds(c.map, x + dx, y + dy) && tileAt(c.map, x + dx, y + dy).growth) touch = true;
        }
      if (touch) s.overgrowth += 1;
    }
  return grown;
}

// ---------------------------------------------------------------- between attacks

export type Assignment =
  | { kind: 'rest' }
  | { kind: 'build'; tiles: Vec[]; wall: StructureKind }
  | { kind: 'repair'; buildingId: string }
  | { kind: 'staff'; buildingId: string }
  | { kind: 'heal' }
  | { kind: 'clear'; tiles: Vec[] }
  | { kind: 'train'; role: RoleId };

export const ASSIGNMENT_LABEL: Record<Assignment['kind'], string> = {
  rest: 'Rest',
  build: 'Build',
  repair: 'Repair',
  staff: 'Staff',
  heal: 'Heal',
  clear: 'Clear growth',
  train: 'Train',
};

export function material(c: Campaign): number {
  return c.stores + c.salvage;
}

/** Pay from salvage first, then stores. */
function pay(c: Campaign, amount: number): boolean {
  if (material(c) < amount) return false;
  const fromSalvage = Math.min(c.salvage, amount);
  c.salvage -= fromSalvage;
  c.stores -= amount - fromSalvage;
  return true;
}

export function buildRate(col: Colonist): number {
  return ROLES[col.role].buildRate;
}

/** Why a wall cannot go here, or null if it can. */
export function buildBlocked(c: Campaign, p: Vec, wall: StructureKind): string | null {
  if (!inBounds(c.map, p.x, p.y)) return 'Off the map.';
  if (chebyshev(p, CENTER) > COLONY_RADIUS + 3) return 'Too far from the colony to build.';
  const t = tileAt(c.map, p.x, p.y);
  if (t.base === 'rock' || t.base === 'tree') return 'Something is already standing there.';
  if (t.buildingId) return 'A building stands there.';
  if (t.growth) return 'Thorn grows there. Clear it first.';
  // Building over an existing wall repairs overgrowth, or raises a low wall to a full one.
  if (t.structure && !(t.structure.kind === 'lowwall' && wall === 'wall') && t.structure.overgrowth === 0) return 'There is already a wall there.';
  return null;
}

export function canBuildAt(c: Campaign, p: Vec, wall: StructureKind): boolean {
  return buildBlocked(c, p, wall) === null;
}

export function workshopStaffed(c: Campaign, day: Record<string, Assignment>): boolean {
  const ws = c.buildings.find((b) => b.kind === 'workshop' && !b.destroyed);
  if (!ws) return false;
  return Object.entries(day).some(([id, a]) => a.kind === 'staff' && a.buildingId === ws.id && c.colonists.find((x) => x.id === id)?.role === 'engineer');
}

export function canTrain(col: Colonist): boolean {
  return col.status === 'active' && col.scars.length > 0;
}

export interface DayResult {
  lines: string[];
}

/** Resolve one day of assignments. Staffing resolves first, so a staffed workshop helps builders the same day. */
export function runDay(c: Campaign, day: Record<string, Assignment>): DayResult {
  const lines: string[] = [];
  const active = c.colonists.filter((x) => x.status === 'active');
  const fullWalls = workshopStaffed(c, day);
  const infirmary = c.buildings.find((b) => b.kind === 'infirmary' && !b.destroyed);

  const order: Assignment['kind'][] = ['staff', 'build', 'repair', 'clear', 'heal', 'rest', 'train'];
  const sorted = [...active].sort((a, b) => order.indexOf((day[a.id] ?? { kind: 'rest' }).kind) - order.indexOf((day[b.id] ?? { kind: 'rest' }).kind));

  for (const col of sorted) {
    const a = day[col.id] ?? { kind: 'rest' };
    const first = col.name.split(' ')[0];
    switch (a.kind) {
      case 'staff': {
        const b = c.buildings.find((x) => x.id === a.buildingId);
        if (!b || b.destroyed) {
          lines.push(`${first} has nothing to staff.`);
          break;
        }
        const needs = BUILDINGS[b.kind].needs;
        if (needs && col.role !== needs) {
          lines.push(`${first} staffs the ${BUILDINGS[b.kind].name.toLowerCase()}, but it needs a ${ROLES[needs].name.toLowerCase()} to be any use.`);
          break;
        }
        if (b.kind === 'lab') {
          if (c.history.length === 0 || c.history[c.history.length - 1].kills === 0) {
            lines.push(`${first} has no bodies to study.`);
          } else if (c.reportReady) {
            lines.push(`${first} has nothing more to learn from these bodies.`);
          } else {
            c.reportReady = true;
            lines.push(`${first} spends the day dissecting. A report is ready.`);
          }
        } else if (b.kind === 'workshop') {
          lines.push(`${first} runs the workshop. Full walls can be built today.`);
        } else {
          lines.push(`${first} keeps the ${BUILDINGS[b.kind].name.toLowerCase()} running.`);
        }
        break;
      }
      case 'build': {
        let built = 0;
        for (const p of a.tiles.slice(0, buildRate(col))) {
          const kind: StructureKind = a.wall === 'wall' && fullWalls ? 'wall' : 'lowwall';
          if (!canBuildAt(c, p, kind)) continue;
          const cost = kind === 'wall' ? 2 : 1;
          if (!pay(c, cost)) {
            lines.push(`${first} runs out of material.`);
            break;
          }
          const t = tileAt(c.map, p.x, p.y);
          t.structure = { kind, overgrowth: 0 };
          t.rubble = false;
          built += 1;
        }
        if (a.wall === 'wall' && !fullWalls && built) lines.push(`Without a staffed workshop, ${first} can only raise low walls.`);
        lines.push(built ? `${first} builds ${built} wall segment${built > 1 ? 's' : ''}.` : `${first} builds nothing.`);
        break;
      }
      case 'repair': {
        const b = c.buildings.find((x) => x.id === a.buildingId);
        if (!b || b.destroyed || b.hp >= b.maxHp) {
          lines.push(`${first} finds nothing to repair.`);
          break;
        }
        if (!pay(c, 1)) {
          lines.push(`${first} has no material to repair with.`);
          break;
        }
        const amount = col.role === 'engineer' ? 6 : 3;
        b.hp = Math.min(b.maxHp, b.hp + amount);
        lines.push(`${first} patches the ${BUILDINGS[b.kind].name.toLowerCase()} (${b.hp}/${b.maxHp}).`);
        break;
      }
      case 'clear': {
        let cleared = 0;
        for (const p of a.tiles.slice(0, buildRate(col) + 1)) {
          const t = tileAt(c.map, p.x, p.y);
          if (!t.growth) continue;
          t.growth = false;
          cleared += 1;
        }
        lines.push(cleared ? `${first} cuts back ${cleared} patch${cleared > 1 ? 'es' : ''} of thorn.` : `${first} finds no growth to clear.`);
        break;
      }
      case 'heal': {
        if (infirmary) {
          col.hp = col.maxHp;
          lines.push(`${first} is treated in the infirmary and is back to full strength.`);
        } else {
          col.hp = Math.min(col.maxHp, col.hp + 2);
          lines.push(`${first} rests their wounds. There is no infirmary.`);
        }
        break;
      }
      case 'rest': {
        col.hp = Math.min(col.maxHp, col.hp + 2);
        lines.push(`${first} rests.`);
        break;
      }
      case 'train': {
        if (!canTrain(col) || a.role === col.role) {
          lines.push(`${first} cannot train for that.`);
          break;
        }
        if (!col.training || col.training.role !== a.role) col.training = { role: a.role, days: 0 };
        col.training.days += 1;
        if (col.training.days >= 2) {
          const old = ROLES[col.role].name.toLowerCase();
          col.role = a.role;
          col.maxHp = ROLES[a.role].hp;
          col.hp = Math.min(col.hp, col.maxHp);
          col.training = null;
          lines.push(`${first} is no longer a ${old}. They are a ${ROLES[a.role].name.toLowerCase()} now.`);
        } else {
          lines.push(`${first} trains as a ${ROLES[a.role].name.toLowerCase()} (1 of 2 days).`);
        }
        break;
      }
    }
  }
  // Everyone heals a little overnight.
  for (const col of active) col.hp = Math.min(col.maxHp, col.hp + 1);
  return { lines };
}

export function canDrop(c: Campaign, kind: BuildingKind, pos: Vec): boolean {
  if (kind === 'pod') return false;
  if (c.buildings.some((b) => b.kind === kind)) return false;
  if (c.stores < BUILDINGS[kind].cost) return false;
  return canPlaceBuilding(c.map, pos, BUILDINGS[kind].size);
}

/** Drop a building from orbit. Irreversible, and the world notices. */
export function dropBuilding(c: Campaign, kind: BuildingKind, pos: Vec): Building | null {
  if (!canDrop(c, kind, pos)) return null;
  const def = BUILDINGS[kind];
  c.stores -= def.cost;
  const b: Building = { id: `${kind}`, kind, pos: { ...pos }, size: def.size, hp: def.hp, maxHp: def.hp, destroyed: false, droppedAfter: c.history.length };
  placeBuilding(c.map, b);
  c.buildings.push(b);
  return b;
}

export { DAYS_BETWEEN };
