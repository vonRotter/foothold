// The campaign: one map, the same colonists, three attacks. Nothing resets.
// The game starts in a build phase; each mission is followed by another one.

import { battleOf } from './combat';
import { BUILDINGS, COSTS, REPAIR_HP, ROLES, ROSTER, SCAR_ORDER, START_STORES, STARTING_BASE, TOTAL_ATTACKS } from './data';
import { chooseAdaptation } from './mind';
import { CENTER, COLONY_RADIUS, canPlaceBuilding, chebyshev, dist, inBounds, inColony, parseMap, placeBuilding, samePos, tileAt } from './map';
import { makeRng, next, pick } from './rng';
import type { AttackSummary, Building, BuildingKind, BuildPhase, Campaign, Colonist, Job, ScarId, StructureKind, Vec } from './types';

export function newCampaign(seed: number): Campaign {
  const map = parseMap();
  const h = STARTING_BASE.habitat;
  // A concrete apron around the habitat.
  for (let y = h.y - 2; y <= h.y + 4; y++) for (let x = h.x - 2; x <= h.x + 4; x++) tileAt(map, x, y).base = 'pad';
  const habitat: Building = { id: 'habitat', kind: 'habitat', pos: { ...h }, size: 3, hp: BUILDINGS.habitat.hp, maxHp: BUILDINGS.habitat.hp, destroyed: false, droppedAfter: 0 };
  placeBuilding(map, habitat);
  for (const st of STARTING_BASE.structures) tileAt(map, st.x, st.y).structure = { kind: st.kind, overgrowth: 0 };
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
  const c: Campaign = {
    seed,
    rng: makeRng(seed),
    map,
    buildings: [habitat],
    colonists,
    stores: START_STORES,
    salvage: 0,
    attack: 1,
    totalAttacks: TOTAL_ATTACKS,
    adaptations: [],
    kills: [],
    battle: null,
    nextIntent: null,
    build: null,
    history: [],
    lastGrowth: 0,
  };
  startBuildPhase(c);
  return c;
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
  c.lastGrowth = growWorld(c);
  if (!campaignOver(c)) startBuildPhase(c);
  return summary;
}

export function campaignOver(c: Campaign): 'won' | 'fallen' | null {
  if (c.colonists.every((x) => x.status === 'dead')) return 'fallen';
  if (c.history.length >= c.totalAttacks) return 'won';
  return null;
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
        if (t.growth || t.burned || t.base === 'rock' || t.base === 'tree' || t.base === 'pad' || t.base === 'water' || t.base === 'ford' || t.buildingId || t.structure) continue;
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

// ---------------------------------------------------------------- the build phase
//
// Between missions (and before the first) each colonist gets one job. Builders supply
// build points; placing walls, clearing growth and repairing spend them, plus material.
// Everything placed this phase can be undone until the next mission starts.

export const JOB_LABEL: Record<Job['kind'], string> = {
  rest: 'Rest',
  build: 'Build',
  heal: 'Heal',
  staff: 'Staff',
  train: 'Train',
};

export function startBuildPhase(c: Campaign): void {
  const lab = c.buildings.find((b) => b.kind === 'lab' && !b.destroyed);
  const jobs: Record<string, Job> = {};
  for (const col of c.colonists) {
    if (col.status !== 'active') continue;
    if (col.role === 'xenobiologist' && lab) jobs[col.id] = { kind: 'staff', buildingId: lab.id };
    else if (col.hp < col.maxHp && col.role !== 'engineer') jobs[col.id] = { kind: 'heal' };
    else jobs[col.id] = { kind: 'build' };
  }
  c.build = { jobs, spent: 0, placed: [] };
  c.battle = null;
  // During the build phase, `attack` already names the mission being prepared for.
  c.attack = c.history.length + 1;
}

function phase(c: Campaign): BuildPhase {
  if (!c.build) throw new Error('not in a build phase');
  return c.build;
}

export function material(c: Campaign): number {
  return c.stores + c.salvage;
}

export function buildPointsTotal(c: Campaign, jobs = phase(c).jobs): number {
  let n = 0;
  for (const [id, j] of Object.entries(jobs)) {
    const col = c.colonists.find((x) => x.id === id);
    if (j.kind === 'build' && col && col.status === 'active') n += ROLES[col.role].buildPoints;
  }
  return n;
}

export function buildPointsLeft(c: Campaign): number {
  return buildPointsTotal(c) - phase(c).spent;
}

export function workshopStaffed(c: Campaign, jobs = phase(c).jobs): boolean {
  const ws = c.buildings.find((b) => b.kind === 'workshop' && !b.destroyed);
  if (!ws) return false;
  return Object.entries(jobs).some(([id, j]) => j.kind === 'staff' && j.buildingId === ws.id && c.colonists.find((x) => x.id === id)?.role === 'engineer');
}

/** The xeno lab is standing, staffed by a xenobiologist, and there are bodies from the last mission. */
export function reportAvailable(c: Campaign): boolean {
  if (!c.build) return false;
  const lab = c.buildings.find((b) => b.kind === 'lab' && !b.destroyed);
  const last = c.history[c.history.length - 1];
  if (!lab || !last || last.kills === 0) return false;
  return Object.entries(c.build.jobs).some(([id, j]) => j.kind === 'staff' && j.buildingId === lab.id && c.colonists.find((x) => x.id === id)?.role === 'xenobiologist');
}

export function canTrain(col: Colonist): boolean {
  return col.status === 'active' && col.scars.length > 0;
}

/** Change a colonist's job. Returns a reason if it cannot be done. */
export function setJob(c: Campaign, colonistId: string, job: Job): string | null {
  const b = phase(c);
  const col = c.colonists.find((x) => x.id === colonistId);
  if (!col || col.status !== 'active') return 'They cannot work.';
  if (job.kind === 'train' && (!canTrain(col) || job.role === col.role)) return 'Only a scarred colonist can retrain, and only into a different role.';
  if (job.kind === 'staff' && !c.buildings.some((x) => x.id === job.buildingId && !x.destroyed)) return 'That building is not standing.';
  const jobs = { ...b.jobs, [colonistId]: job };
  const total = buildPointsTotal(c, jobs);
  if (total < b.spent) return `${b.spent} build points are already spent. Undo some work first.`;
  if (!workshopStaffed(c, jobs) && b.placed.some((p) => p.kind === 'wall' && p.wall === 'wall')) return 'Full walls placed this phase need the workshop staffed. Undo them first.';
  b.jobs = jobs;
  return null;
}

/** Pay from salvage first, then stores. */
function pay(c: Campaign, amount: number): { salvage: number; stores: number } | null {
  if (material(c) < amount) return null;
  const salvage = Math.min(c.salvage, amount);
  c.salvage -= salvage;
  c.stores -= amount - salvage;
  return { salvage, stores: amount - salvage };
}

/** Why a wall cannot go here, or null if it can. Does not check points or material. */
export function buildBlocked(c: Campaign, p: Vec, wall: StructureKind): string | null {
  if (!inBounds(c.map, p.x, p.y)) return 'Off the map.';
  if (!inColony(p)) return 'Outside the colony. You can only build inside the marked area.';
  const t = tileAt(c.map, p.x, p.y);
  if (t.base === 'water' || t.base === 'ford') return 'Not in the water.';
  if (t.base === 'rock' || t.base === 'tree') return 'Something is already standing there.';
  if (t.buildingId) return 'A building stands there.';
  if (t.growth) return 'Thorn grows there. Clear it first.';
  if (wall === 'crate') return 'Crates cannot be built.';
  // Building over an existing wall repairs overgrowth, or raises a low wall to a full one.
  if (t.structure && !(t.structure.kind !== 'wall' && wall === 'wall') && t.structure.overgrowth === 0) return 'There is already a wall there.';
  return null;
}

export function canBuildAt(c: Campaign, p: Vec, wall: StructureKind): boolean {
  return buildBlocked(c, p, wall) === null;
}

/** Place a low or full wall. Returns a reason if it cannot be done. */
export function placeWall(c: Campaign, p: Vec, wall: 'lowwall' | 'wall'): string | null {
  const b = phase(c);
  const why = buildBlocked(c, p, wall);
  if (why) return why;
  if (wall === 'wall' && !workshopStaffed(c)) return 'Full walls need a workshop staffed by the engineer.';
  const cost = COSTS[wall];
  if (buildPointsLeft(c) < cost.bp) return 'No build points left. Put more people on Build.';
  const paid = pay(c, cost.material);
  if (!paid) return 'Not enough material.';
  const t = tileAt(c.map, p.x, p.y);
  b.spent += cost.bp;
  b.placed.push({ kind: 'wall', pos: { ...p }, wall, bp: cost.bp, ...paid, replaced: t.structure?.kind ?? null });
  t.structure = { kind: wall, overgrowth: 0 };
  t.rubble = false;
  return null;
}

/** Cut back thorn. Allowed a little beyond the colony, to open sight lines. */
export function clearGrowth(c: Campaign, p: Vec): string | null {
  const b = phase(c);
  if (!inBounds(c.map, p.x, p.y) || chebyshev(p, CENTER) > COLONY_RADIUS + 4) return 'Too far out to work safely.';
  const t = tileAt(c.map, p.x, p.y);
  if (!t.growth) return 'No growth there.';
  if (buildPointsLeft(c) < COSTS.clear.bp) return 'No build points left. Put more people on Build.';
  b.spent += COSTS.clear.bp;
  b.placed.push({ kind: 'clear', pos: { ...p }, bp: COSTS.clear.bp });
  t.growth = false;
  return null;
}

export function repairBuilding(c: Campaign, buildingId: string): string | null {
  const b = phase(c);
  const bld = c.buildings.find((x) => x.id === buildingId);
  if (!bld || bld.destroyed) return 'Nothing left to repair.';
  if (bld.hp >= bld.maxHp) return 'It is not damaged.';
  if (buildPointsLeft(c) < COSTS.repair.bp) return 'No build points left. Put more people on Build.';
  const paid = pay(c, COSTS.repair.material);
  if (!paid) return 'Not enough material.';
  const hp = Math.min(REPAIR_HP, bld.maxHp - bld.hp);
  bld.hp += hp;
  b.spent += COSTS.repair.bp;
  b.placed.push({ kind: 'repair', buildingId, hp, bp: COSTS.repair.bp, ...paid });
  return null;
}

/** Undo something placed this phase at `p` (a wall or a cleared patch). */
export function undoAt(c: Campaign, p: Vec): boolean {
  const b = phase(c);
  for (let i = b.placed.length - 1; i >= 0; i--) {
    const pl = b.placed[i];
    if (pl.kind === 'repair' || !samePos(pl.pos, p)) continue;
    undoPlacement(c, i);
    return true;
  }
  return false;
}

/** Undo the most recent placement of any kind. */
export function undoLast(c: Campaign): boolean {
  const b = phase(c);
  if (!b.placed.length) return false;
  undoPlacement(c, b.placed.length - 1);
  return true;
}

function undoPlacement(c: Campaign, i: number) {
  const b = phase(c);
  const pl = b.placed[i];
  b.placed.splice(i, 1);
  b.spent -= pl.bp;
  if (pl.kind === 'wall') {
    const t = tileAt(c.map, pl.pos.x, pl.pos.y);
    t.structure = pl.replaced ? { kind: pl.replaced, overgrowth: 0 } : null;
    c.salvage += pl.salvage;
    c.stores += pl.stores;
  } else if (pl.kind === 'clear') {
    tileAt(c.map, pl.pos.x, pl.pos.y).growth = true;
  } else {
    const bld = c.buildings.find((x) => x.id === pl.buildingId)!;
    bld.hp -= pl.hp;
    c.salvage += pl.salvage;
    c.stores += pl.stores;
  }
}

export function canDrop(c: Campaign, kind: BuildingKind, pos: Vec): boolean {
  if (kind === 'habitat' || !c.build) return false;
  if (c.buildings.some((b) => b.kind === kind)) return false;
  if (c.stores < BUILDINGS[kind].cost) return false;
  return canPlaceBuilding(c.map, pos, BUILDINGS[kind].size);
}

/** Drop a building from orbit. Irreversible, and the world notices. */
export function dropBuilding(c: Campaign, kind: BuildingKind, pos: Vec): Building | null {
  if (!canDrop(c, kind, pos)) return null;
  const def = BUILDINGS[kind];
  c.stores -= def.cost;
  const b: Building = { id: kind, kind, pos: { ...pos }, size: def.size, hp: def.hp, maxHp: def.hp, destroyed: false, droppedAfter: c.history.length };
  placeBuilding(c.map, b);
  c.buildings.push(b);
  return b;
}

/**
 * End the build phase: jobs take effect (healing, rest, training), and the colony is
 * ready for the next mission. Returns what happened, for the log.
 */
export function finishBuildPhase(c: Campaign): string[] {
  const b = phase(c);
  const lines: string[] = [];
  const infirmary = c.buildings.some((x) => x.kind === 'infirmary' && !x.destroyed);
  for (const col of c.colonists) {
    if (col.status !== 'active') continue;
    const j = b.jobs[col.id] ?? { kind: 'rest' };
    const first = col.name.split(' ')[0];
    if (j.kind === 'heal') {
      col.hp = infirmary ? col.maxHp : Math.min(col.maxHp, col.hp + 3);
      lines.push(infirmary ? `${first} is treated in the infirmary.` : `${first} nurses their wounds. There is no infirmary.`);
    } else if (j.kind === 'rest') {
      col.hp = Math.min(col.maxHp, col.hp + 2);
    } else if (j.kind === 'train' && canTrain(col)) {
      const old = ROLES[col.role].name.toLowerCase();
      col.role = j.role;
      col.maxHp = ROLES[j.role].hp;
      col.hp = Math.min(col.hp, col.maxHp);
      lines.push(`${first} is no longer a ${old}. They are a ${ROLES[j.role].name.toLowerCase()} now.`);
    }
    col.hp = Math.min(col.maxHp, col.hp + 1);
  }
  c.build = null;
  c.attack = c.history.length + 1;
  return lines;
}

