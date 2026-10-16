// Tactical combat. Player actions and the enemy phase mutate the campaign's battle
// and return a list of events for the renderer to play back and the log to print.

import {
  BLEED_TURNS,
  EARLY_TURNS,
  OVERWATCH_PENALTY,
  PARTS,
  ROLES,
  SIGHT,
  SPECIES,
  TURN_LIMIT,
  WEAPONS,
  adaptationDef,
  MISSIONS,
  type WaveDef,
} from './data';
import { chooseIntent, goalTiles, rankApproaches } from './mind';
import {
  CENTER,
  COLONY_RADIUS,
  adjacent,
  chebyshev,
  coverAgainst,
  destroyBuilding,
  dist,
  hasLos,
  inBounds,
  key,
  samePos,
  tileAt,
  touchesBuilding,
} from './map';
import { canStand, destinations, pathTo, reach, stepCost, type MoveOpts } from './path';
import { int, pick, rollPct } from './rng';
import type {
  AdaptationId,
  Battle,
  BodyPart,
  Building,
  Campaign,
  Colonist,
  Creature,
  KillSource,
  PositionBucket,
  UnitState,
  Vec,
  Wave,
  WeaponId,
} from './types';

// ---------------------------------------------------------------- events

export type BattleEvent =
  | { t: 'move'; id: string; path: Vec[] }
  | { t: 'shot'; from: string; to: string; weapon: WeaponId; part: BodyPart; chance: number; roll: number; hit: boolean; damage: number; reaction: boolean }
  | { t: 'area'; from: string; weapon: WeaponId; at: Vec; radius: number }
  | { t: 'strike'; from: string; to: string; kind: 'bite' | 'quills' | 'slam'; chance: number; roll: number; hit: boolean; damage: number }
  | { t: 'gnaw'; from: string; building: string; damage: number }
  | { t: 'damage'; id: string; amount: number }
  | { t: 'death'; id: string }
  | { t: 'downed'; id: string }
  | { t: 'surface'; id: string; at: Vec }
  | { t: 'arrive'; id: string; at: Vec }
  | { t: 'stabilize'; from: string; to: string }
  | { t: 'destroyed'; building: string }
  | { t: 'terrain' }
  | { t: 'log'; text: string; tone?: 'world' | 'colony' | 'neutral' }
  | { t: 'phase'; phase: Battle['phase']; turn: number }
  | { t: 'end'; outcome: NonNullable<Battle['outcome']> };

class Out {
  events: BattleEvent[] = [];
  constructor(private b: Battle) {}
  push(e: BattleEvent) {
    this.events.push(e);
    if (e.t === 'log') this.b.log.push(e.text);
  }
  log(text: string, tone: 'world' | 'colony' | 'neutral' = 'neutral') {
    this.push({ t: 'log', text, tone });
  }
}

// ---------------------------------------------------------------- lookups

export function battleOf(c: Campaign): Battle {
  if (!c.battle) throw new Error('no battle');
  return c.battle;
}

export function colonistOf(c: Campaign, id: string): Colonist {
  const x = c.colonists.find((k) => k.id === id);
  if (!x) throw new Error(`no colonist ${id}`);
  return x;
}

export function unitOf(b: Battle, id: string): UnitState {
  const u = b.units.find((k) => k.colonistId === id);
  if (!u) throw new Error(`no unit ${id}`);
  return u;
}

export function creatureOf(b: Battle, id: string): Creature {
  const x = b.creatures.find((k) => k.id === id);
  if (!x) throw new Error(`no creature ${id}`);
  return x;
}

function has(c: Campaign, id: AdaptationId): boolean {
  return c.adaptations.some((a) => a.id === id);
}

/** Log an adaptation's battle notice the first time it matters. */
function notice(c: Campaign, out: Out, id: AdaptationId) {
  const b = battleOf(c);
  if (b.noticed.includes(id)) return;
  b.noticed.push(id);
  out.log(adaptationDef(id).notice, 'world');
}

export function nameOf(c: Campaign, id: string): string {
  const col = c.colonists.find((k) => k.id === id);
  if (col) return col.name.split(' ')[0];
  const cr = c.battle?.creatures.find((k) => k.id === id);
  if (cr) return SPECIES[cr.species].name.toLowerCase();
  return id;
}

export function liveCreatures(b: Battle): Creature[] {
  return b.creatures.filter((k) => k.alive && k.arrived);
}

function standingUnits(b: Battle): UnitState[] {
  return b.units.filter((u) => !u.downed);
}

// ---------------------------------------------------------------- derived stats

export interface UnitStats {
  aim: number;
  mobility: number;
  sight: number;
  overwatchMod: number;
  canDash: boolean;
  weapons: WeaponId[];
}

export function unitStats(col: Colonist): UnitStats {
  const role = ROLES[col.role];
  const s = new Set(col.scars);
  let weapons = role.weapons.filter((w) => !(s.has('nerve_damage') && WEAPONS[w].heavy));
  if (col.retired) weapons = [];
  return {
    aim: role.aim,
    mobility: role.mobility - (s.has('shattered_knee') ? 1 : 0),
    sight: SIGHT - (s.has('lost_eye') ? 4 : 0),
    overwatchMod: -OVERWATCH_PENALTY - (s.has('lost_eye') ? 10 : 0) - (s.has('tremor') ? 30 : 0),
    canDash: !s.has('burned_lungs'),
    weapons,
  };
}

// ---------------------------------------------------------------- occupancy

// Dead colonists are removed from b.units, so every unit occupies its tile (downed ones too).
function unitTiles(b: Battle): Set<number> {
  return new Set(b.units.map((u) => key(u.pos)));
}

function creatureTiles(b: Battle, except?: string): Set<number> {
  return new Set(liveCreatures(b).filter((k) => !k.burrowed && k.id !== except).map((k) => key(k.pos)));
}

export function colonistMoveOpts(b: Battle): MoveOpts {
  return { mover: 'colonist', blocked: creatureTiles(b), occupied: unitTiles(b) };
}

export function occupiedAt(b: Battle, p: Vec): boolean {
  return unitTiles(b).has(key(p)) || creatureTiles(b).has(key(p));
}

// ---------------------------------------------------------------- setup

export function startBattle(c: Campaign): Battle {
  const intent = chooseIntent(c);
  c.nextIntent = intent;
  const ranked = rankApproaches(c, intent);
  const approach = ranked[0].id;
  const secondApproach = ranked[1].id;

  // Default deployment: a ring around the centre.
  const ring: Vec[] = [];
  for (let r = 3; r <= COLONY_RADIUS && ring.length < 20; r++) {
    for (let y = CENTER.y - r; y <= CENTER.y + r; y++) {
      for (let x = CENTER.x - r; x <= CENTER.x + r; x++) {
        if (chebyshev({ x, y }, CENTER) !== r) continue;
        if (canStand(c.map, { x, y })) ring.push({ x, y });
      }
    }
  }
  const units: UnitState[] = [];
  const present = c.colonists.filter((k) => k.status === 'active');
  present.forEach((col, i) => {
    const pos = ring[Math.floor((i * ring.length) / Math.max(1, present.length)) % ring.length];
    units.push({
      colonistId: col.id,
      pos: { ...pos },
      actions: 2,
      overwatch: false,
      downed: false,
      bleed: 0,
      stabilized: false,
      charges: { ...ROLES[col.role].charges },
      everDowned: false,
    });
  });

  // Creatures, wave by wave on a fixed schedule. The mind decides bodies, not numbers.
  const creatures: Creature[] = [];
  const waves: Wave[] = [];
  let n = 0;
  for (const w of waveSchedule(c)) {
    const ids: string[] = [];
    for (const group of w.creatures) {
      for (let i = 0; i < group.count; i++) {
        const def = SPECIES[group.species];
        const id = `${group.species}-${c.attack}-${n++}`;
        ids.push(id);
        creatures.push({
          id,
          species: group.species,
          pos: { x: -1, y: -1 },
          hp: def.hp,
          maxHp: def.hp,
          burrowed: def.burrows,
          slowed: false,
          blinded: 0,
          burning: null,
          arrivesOn: w.turn,
          arrived: false,
          alive: true,
        });
      }
    }
    waves.push({ turn: w.turn, approach: w.from === 'first' ? approach : secondApproach, creatureIds: ids, arrived: false });
  }

  const b: Battle = {
    attack: c.attack,
    turn: 0,
    phase: 'deploy',
    intent,
    approach,
    secondApproach,
    units,
    startCount: units.length,
    creatures,
    waves,
    kills: [],
    outcome: null,
    log: [],
    noticed: [],
  };
  c.battle = b;
  return b;
}

/**
 * This attack's arrival schedule. Fixed per attack; the time adaptations shift it, and
 * the result is shown to the player before the attack starts. Kills never change it.
 */
export function waveSchedule(c: Campaign, attack = c.attack): WaveDef[] {
  const base = MISSIONS[attack] ?? MISSIONS[3];
  return base.map((w, i) => {
    let turn = w.turn;
    if (i > 0 && has(c, 'staggered')) turn += i;
    if (i > 0 && has(c, 'surge')) turn = Math.max(1, turn - 1);
    return { ...w, turn };
  });
}

export function canDeployAt(c: Campaign, p: Vec, ignoreId?: string): boolean {
  const b = battleOf(c);
  if (!inBounds(c.map, p.x, p.y) || !canStand(c.map, p)) return false;
  if (chebyshev(p, CENTER) > COLONY_RADIUS) return false;
  return !b.units.some((u) => u.colonistId !== ignoreId && samePos(u.pos, p));
}

export function deploy(c: Campaign, id: string, p: Vec): boolean {
  const b = battleOf(c);
  if (b.phase !== 'deploy' || !canDeployAt(c, p, id)) return false;
  unitOf(b, id).pos = { ...p };
  return true;
}

export function beginBattle(c: Campaign): BattleEvent[] {
  const b = battleOf(c);
  const out = new Out(b);
  b.turn = 1;
  b.phase = 'player';
  const target = b.intent.kind === 'building' ? buildingName(c, b.intent.buildingId) : 'the colonists';
  out.log(`Attack ${b.attack}. They are coming from ${approachName(c, b.approach)}, for ${target}.`, 'world');
  out.log(b.intent.reason, 'world');
  arrivals(c, out);
  out.push({ t: 'phase', phase: 'player', turn: 1 });
  return out.events;
}

function approachName(c: Campaign, id: string): string {
  return c.map.approaches.find((a) => a.id === id)!.name;
}

export function buildingName(c: Campaign, id: string): string {
  const b = c.buildings.find((x) => x.id === id);
  if (!b) return id;
  return { habitat: 'the habitat', lab: 'the xeno lab', infirmary: 'the infirmary', workshop: 'the workshop' }[b.kind];
}

function arrivals(c: Campaign, out: Out) {
  const b = battleOf(c);
  for (const w of b.waves) {
    if (w.arrived || w.turn > b.turn) continue;
    const ap = c.map.approaches.find((a) => a.id === w.approach)!;
    let placed = 0;
    for (const id of w.creatureIds) {
      const k = creatureOf(b, id);
      if (k.arrived || !k.alive) continue;
      const spot = freeTileNear(c, ap.entry, k.burrowed);
      if (!spot) continue; // the entry is crowded: try again next turn
      k.pos = spot;
      k.arrived = true;
      placed += 1;
      out.push({ t: 'arrive', id: k.id, at: { ...spot } });
    }
    w.arrived = w.creatureIds.every((id) => creatureOf(b, id).arrived);
    if (placed && b.turn > 1) {
      if (has(c, 'staggered')) notice(c, out, 'staggered');
      out.log(`Wave: ${placed} more from ${approachName(c, w.approach)}.`, 'world');
    }
  }
  if (b.turn === 1 && has(c, 'surge')) notice(c, out, 'surge');
}

/** The next wave still to come, if any. */
export function nextWave(b: Battle): Wave | null {
  return b.waves.find((w) => !w.arrived) ?? null;
}

/**
 * Whether the player can see where a wave will come from. The first wave is known at
 * deployment; every later wave shows its approach one turn before it arrives.
 */
export function waveRevealed(b: Battle, w: Wave): boolean {
  return !w.arrived && w.turn - b.turn <= 1;
}

function freeTileNear(c: Campaign, entry: Vec[], burrowed: boolean): Vec | null {
  const b = battleOf(c);
  const taken = new Set([...b.units.map((u) => key(u.pos)), ...liveCreatures(b).map((k) => key(k.pos))]);
  const queue = entry.map((p) => ({ ...p }));
  const seen = new Set(queue.map(key));
  while (queue.length) {
    const p = queue.shift()!;
    const ok = burrowed ? tileAt(c.map, p.x, p.y).base !== 'rock' : canStand(c.map, p);
    if (ok && !taken.has(key(p))) return p;
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const n = { x: p.x + dx, y: p.y + dy };
      if (!inBounds(c.map, n.x, n.y) || seen.has(key(n))) continue;
      seen.add(key(n));
      queue.push(n);
    }
  }
  return null;
}

// ---------------------------------------------------------------- player: movement

export interface MoveRange {
  /** Reachable with one action. */
  walk: Vec[];
  /** Reachable only with both actions. */
  dash: Vec[];
}

export function moveRange(c: Campaign, id: string): MoveRange {
  const b = battleOf(c);
  const u = unitOf(b, id);
  const col = colonistOf(c, id);
  const st = unitStats(col);
  if (u.downed || u.actions === 0) return { walk: [], dash: [] };
  const canDash = u.actions >= 2 && st.canDash;
  const opts = colonistMoveOpts(b);
  const r = reach(c.map, u.pos, st.mobility * (canDash ? 2 : 1), opts);
  const walk: Vec[] = [];
  const dash: Vec[] = [];
  const shellShock = col.scars.includes('shell_shock');
  for (const p of destinations(c.map, r, opts)) {
    if (samePos(p, u.pos)) continue;
    if (shellShock && liveCreatures(b).some((k) => !k.burrowed && adjacent(k.pos, p))) continue;
    const cost = r.cost.get(key(p))!;
    (cost <= st.mobility ? walk : dash).push(p);
  }
  return { walk, dash };
}

/** Why this colonist cannot move to this tile right now, or null if they can. */
export function moveProblem(c: Campaign, id: string, to: Vec): string | null {
  const b = battleOf(c);
  if (b.phase !== 'player') return 'Wait: the world is moving.';
  const u = unitOf(b, id);
  const col = colonistOf(c, id);
  const who = col.name.split(' ')[0];
  if (u.downed) return `${who} is down and cannot move.`;
  if (u.actions === 0) return `${who} has no actions left this turn. Shooting and overwatch end a colonist's turn.`;
  if (samePos(to, u.pos)) return `${who} is already there.`;
  if (!inBounds(c.map, to.x, to.y) || !canStand(c.map, to)) return 'No one can stand there.';
  if (occupiedAt(b, to)) return 'Someone is already standing there.';
  const range = moveRange(c, id);
  if (range.walk.some((p) => samePos(p, to)) || range.dash.some((p) => samePos(p, to))) return null;
  if (col.scars.includes('shell_shock') && liveCreatures(b).some((k) => !k.burrowed && adjacent(k.pos, to))) return `Shell shock: ${who} will not stop next to a creature.`;
  if (u.actions === 1) return `Out of reach with one action left. ${who} can only use the blue tiles now.`;
  if (!unitStats(col).canDash) return `Out of reach. Burned lungs: ${who} cannot dash, so only the blue tiles are in reach.`;
  return 'Out of reach. Blue tiles cost one action; yellow tiles cost both.';
}

export function moveUnit(c: Campaign, id: string, to: Vec): BattleEvent[] | null {
  const b = battleOf(c);
  if (b.phase !== 'player') return null;
  const u = unitOf(b, id);
  const range = moveRange(c, id);
  const isWalk = range.walk.some((p) => samePos(p, to));
  const isDash = range.dash.some((p) => samePos(p, to));
  if (!isWalk && !isDash) return null;
  const st = unitStats(colonistOf(c, id));
  const r = reach(c.map, u.pos, st.mobility * (isDash ? 2 : 1), colonistMoveOpts(b));
  const path = pathTo(r, to);
  const out = new Out(b);
  u.pos = { ...to };
  u.actions -= isDash ? 2 : 1;
  out.push({ t: 'move', id, path });
  return out.events;
}

// ---------------------------------------------------------------- player: shooting

export interface ShotBreakdown {
  chance: number;
  parts: { label: string; value: number }[];
  damage: number;
  effect: string;
}

function positionBucket(c: Campaign, from: Vec, to: Vec): PositionBucket {
  const ef = tileAt(c.map, from.x, from.y).elevation;
  const et = tileAt(c.map, to.x, to.y).elevation;
  const d = dist(from, to);
  if (ef > et) return 'high_ground';
  if (d <= 3) return 'close';
  if (d >= 10) return 'long';
  return 'cover';
}

/** Can this unit shoot this creature with this weapon right now (ignoring actions)? */
export function canTarget(c: Campaign, id: string, weapon: WeaponId, targetId: string): boolean {
  return targetProblem(c, id, weapon, targetId) === null;
}

/**
 * Why this colonist cannot shoot this creature with this weapon right now, or null if they
 * can. `from` asks the same question as if they stood somewhere else (for move previews).
 */
export function targetProblem(c: Campaign, id: string, weapon: WeaponId, targetId: string, from?: Vec): string | null {
  const b = battleOf(c);
  const u = unitOf(b, id);
  const at = from ?? u.pos;
  const k = creatureOf(b, targetId);
  const w = WEAPONS[weapon];
  const col = colonistOf(c, id);
  const st = unitStats(col);
  const who = col.name.split(' ')[0];
  if (!k.alive || !k.arrived) return 'There is nothing there to shoot.';
  if (k.burrowed) return 'It is underground. It can be shot once it surfaces.';
  if (u.downed) return `${who} is down.`;
  if (col.retired) return `${who} can no longer fight.`;
  if (!st.weapons.includes(weapon)) return `${who} cannot use the ${w.name.toLowerCase()}.`;
  if (w.area) return `The ${w.name.toLowerCase()} is aimed at a tile, not a creature.`;
  if (w.melee) return adjacent(at, k.pos) ? null : 'The knife only reaches a creature on a neighbouring tile.';
  const d = dist(at, k.pos);
  if (d > w.range) return `Out of range: it is ${Math.round(d)} tiles away and the ${w.name.toLowerCase()} reaches ${w.range}.`;
  if (d > st.sight) return `Too far for ${who} to see: ${st.sight} tiles with a lost eye.`;
  if (!hasLos(c.map, at, k.pos, st.sight)) return 'No line of sight: rock, a wall, a building, thorn or higher ground is in the way.';
  return null;
}

export function shotBreakdown(c: Campaign, id: string, weapon: WeaponId, targetId: string, part: BodyPart, reaction = false, from?: Vec): ShotBreakdown {
  const b = battleOf(c);
  const u = unitOf(b, id);
  const at = from ?? u.pos;
  const k = creatureOf(b, targetId);
  const w = WEAPONS[weapon];
  const st = unitStats(colonistOf(c, id));
  const d = dist(at, k.pos);
  const climbers = has(c, 'climbers');
  const parts: { label: string; value: number }[] = [{ label: 'Aim', value: st.aim }];
  const rm = Math.round(w.rangeMod(d));
  if (rm) parts.push({ label: `Range (${d.toFixed(1)})`, value: rm });
  if (PARTS[part].aim) parts.push({ label: PARTS[part].name, value: PARTS[part].aim });
  const cover = w.melee ? 0 : coverAgainst(c.map, k.pos, at, { ignoreElevation: climbers });
  if (cover === 1) parts.push({ label: 'Half cover', value: -20 });
  if (cover === 2) parts.push({ label: 'Full cover', value: -40 });
  if (!climbers && tileAt(c.map, at.x, at.y).elevation > tileAt(c.map, k.pos.x, k.pos.y).elevation) {
    parts.push({ label: 'Height', value: 10 });
  }
  if (part === 'legs' && has(c, 'leg_plates')) parts.push({ label: 'Leg plates', value: -15 });
  if (part === 'head' && has(c, 'sunken_head')) parts.push({ label: 'Sunken head', value: -15 });
  if (part === 'sense' && has(c, 'hooded_senses')) parts.push({ label: 'Hooded senses', value: -10 });
  if (d >= 10 && has(c, 'mottled_skin')) parts.push({ label: 'Mottled skin', value: -20 });
  if (reaction) parts.push({ label: 'Overwatch', value: st.overwatchMod });
  const raw = parts.reduce((s, p) => s + p.value, 0);
  const chance = Math.max(0, Math.min(100, raw));
  const { damage, effect } = previewDamage(c, w.id, part);
  return { chance, parts, damage, effect };
}

function weaponDamage(c: Campaign, weapon: WeaponId): number {
  const w = WEAPONS[weapon];
  let dmg = w.damage;
  if (w.category === 'ballistic' && has(c, 'resist_ballistic')) dmg -= 1;
  if (w.category === 'fire' && has(c, 'resist_fire')) dmg -= 1;
  if (w.category === 'explosive' && has(c, 'resist_explosive')) dmg -= 2;
  if (w.category === 'blade' && has(c, 'barbed_hide')) dmg -= 1;
  return Math.max(1, dmg);
}

function previewDamage(c: Campaign, weapon: WeaponId, part: BodyPart): { damage: number; effect: string } {
  let dmg = weaponDamage(c, weapon);
  let effect = '';
  switch (part) {
    case 'torso':
      dmg += has(c, 'torso_plates') ? 0 : 1;
      break;
    case 'legs':
      dmg -= 1;
      effect = has(c, 'leg_plates') ? '' : 'slows';
      break;
    case 'sense':
      dmg -= 1;
      effect = has(c, 'hooded_senses') ? '' : 'blinds';
      break;
    case 'head':
      return { damage: 99, effect: 'kills' };
  }
  return { damage: Math.max(1, dmg), effect };
}

function noticeWeapon(c: Campaign, out: Out, weapon: WeaponId) {
  const cat = WEAPONS[weapon].category;
  if (cat === 'ballistic' && has(c, 'resist_ballistic')) notice(c, out, 'resist_ballistic');
  if (cat === 'fire' && has(c, 'resist_fire')) notice(c, out, 'resist_fire');
  if (cat === 'explosive' && has(c, 'resist_explosive')) notice(c, out, 'resist_explosive');
  if (cat === 'blade' && has(c, 'barbed_hide')) notice(c, out, 'barbed_hide');
}

function resolveShot(c: Campaign, out: Out, id: string, weapon: WeaponId, targetId: string, part: BodyPart, reaction: boolean) {
  const b = battleOf(c);
  const u = unitOf(b, id);
  const k = creatureOf(b, targetId);
  const bd = shotBreakdown(c, id, weapon, targetId, part, reaction);
  const { hit, roll } = rollPct(c.rng, bd.chance);
  const w = WEAPONS[weapon];
  out.push({ t: 'shot', from: id, to: targetId, weapon, part, chance: bd.chance, roll, hit, damage: hit ? Math.min(bd.damage, k.hp) : 0, reaction });
  const who = nameOf(c, id);
  const what = SPECIES[k.species].name.toLowerCase();
  if (!hit) {
    out.log(`${who}${reaction ? ' (overwatch)' : ''} misses the ${what}'s ${PARTS[part].name.toLowerCase()}. ${bd.chance}% — rolled ${roll}.`, 'colony');
    if (part === 'legs' && has(c, 'leg_plates')) notice(c, out, 'leg_plates');
    if (part === 'head' && has(c, 'sunken_head')) notice(c, out, 'sunken_head');
    if (part === 'sense' && has(c, 'hooded_senses')) notice(c, out, 'hooded_senses');
    if (dist(u.pos, k.pos) >= 10 && has(c, 'mottled_skin')) notice(c, out, 'mottled_skin');
    return;
  }
  out.log(`${who}${reaction ? ' (overwatch)' : ''} hits the ${what}'s ${PARTS[part].name.toLowerCase()}. ${bd.chance}% — rolled ${roll}.`, 'colony');
  noticeWeapon(c, out, weapon);
  if (part === 'torso' && has(c, 'torso_plates')) notice(c, out, 'torso_plates');
  const source: KillSource = { colonistId: id, weapon: w.category, part, position: positionBucket(c, u.pos, k.pos) };
  if (part === 'legs' && !has(c, 'leg_plates')) k.slowed = true;
  if (part === 'sense' && !has(c, 'hooded_senses')) k.blinded = 2;
  damageCreature(c, out, k, bd.damage, source);
  if (w.melee && has(c, 'barbed_hide')) {
    notice(c, out, 'barbed_hide');
    damageUnit(c, out, u, 1);
  }
}

export function fire(c: Campaign, id: string, weapon: WeaponId, targetId: string, part: BodyPart): BattleEvent[] | null {
  const b = battleOf(c);
  if (b.phase !== 'player') return null;
  const u = unitOf(b, id);
  if (u.actions < 1 || !canTarget(c, id, weapon, targetId)) return null;
  const out = new Out(b);
  u.actions = 0;
  resolveShot(c, out, id, weapon, targetId, part, false);
  checkEnd(c, out);
  return out.events;
}

/** Area weapons (grenade, flamer): land on the chosen tile, no roll. */
export function canThrow(c: Campaign, id: string, weapon: WeaponId, at: Vec): boolean {
  const b = battleOf(c);
  const u = unitOf(b, id);
  const w = WEAPONS[weapon];
  const st = unitStats(colonistOf(c, id));
  if (!w.area || !st.weapons.includes(weapon) || u.downed) return false;
  if ((u.charges[weapon] ?? 0) <= 0) return false;
  if (!inBounds(c.map, at.x, at.y) || samePos(at, u.pos)) return false;
  if (dist(u.pos, at) > w.range) return false;
  return hasLos(c.map, u.pos, at, st.sight);
}

export function areaTiles(c: Campaign, at: Vec, radius: number): Vec[] {
  const out: Vec[] = [];
  for (let y = at.y - radius; y <= at.y + radius; y++)
    for (let x = at.x - radius; x <= at.x + radius; x++) if (inBounds(c.map, x, y)) out.push({ x, y });
  return out;
}

export function throwArea(c: Campaign, id: string, weapon: WeaponId, at: Vec): BattleEvent[] | null {
  const b = battleOf(c);
  if (b.phase !== 'player') return null;
  const u = unitOf(b, id);
  if (u.actions < 1 || !canThrow(c, id, weapon, at)) return null;
  const out = new Out(b);
  const w = WEAPONS[weapon];
  u.actions = 0;
  u.charges[weapon] = (u.charges[weapon] ?? 0) - 1;
  out.push({ t: 'area', from: id, weapon, at: { ...at }, radius: w.radius });
  out.log(`${nameOf(c, id)} uses the ${w.name.toLowerCase()}.`, 'colony');
  const tiles = areaTiles(c, at, w.radius);
  const inArea = (p: Vec) => tiles.some((t) => samePos(t, p));
  const dmg = weaponDamage(c, weapon);
  let hitAny = false;
  for (const k of liveCreatures(b)) {
    if (k.burrowed || !inArea(k.pos)) continue;
    hitAny = true;
    const source: KillSource = { colonistId: id, weapon: w.category, part: null, position: positionBucket(c, u.pos, k.pos) };
    if (weapon === 'flamer' && !has(c, 'resist_fire')) k.burning = { turns: 2, source };
    damageCreature(c, out, k, dmg, source);
  }
  if (hitAny) noticeWeapon(c, out, weapon);
  for (const other of [...b.units]) {
    if (other.downed || !inArea(other.pos)) continue;
    out.log(`${nameOf(c, other.colonistId)} is caught in it.`, 'colony');
    damageUnit(c, out, other, dmg);
  }
  // Battle damage stays.
  for (const p of tiles) {
    const t = tileAt(c.map, p.x, p.y);
    if (weapon === 'grenade') {
      if (t.structure?.kind === 'lowwall') {
        t.structure = null;
        t.rubble = true;
      }
      t.growth = false;
    }
    if (weapon === 'flamer') {
      if (t.growth || t.base === 'tree') t.burned = true;
      t.growth = false;
      if (t.base === 'tree') t.base = 'ground';
    }
  }
  out.push({ t: 'terrain' });
  checkEnd(c, out);
  return out.events;
}

export function overwatch(c: Campaign, id: string): BattleEvent[] | null {
  const b = battleOf(c);
  const u = unitOf(b, id);
  const st = unitStats(colonistOf(c, id));
  if (b.phase !== 'player' || u.actions < 1 || u.downed || !st.weapons.some((w) => !WEAPONS[w].area && !WEAPONS[w].melee)) return null;
  const out = new Out(b);
  u.actions = 0;
  u.overwatch = true;
  out.log(`${nameOf(c, id)} watches.`, 'colony');
  return out.events;
}

export function canStabilize(c: Campaign, id: string, targetId: string): boolean {
  const b = battleOf(c);
  const u = unitOf(b, id);
  const t = unitOf(b, targetId);
  return b.phase === 'player' && u.actions >= 1 && !u.downed && t.downed && !t.stabilized && adjacent(u.pos, t.pos);
}

export function stabilize(c: Campaign, id: string, targetId: string): BattleEvent[] | null {
  if (!canStabilize(c, id, targetId)) return null;
  const b = battleOf(c);
  const out = new Out(b);
  const u = unitOf(b, id);
  const t = unitOf(b, targetId);
  u.actions -= 1;
  t.stabilized = true;
  out.push({ t: 'stabilize', from: id, to: targetId });
  out.log(`${nameOf(c, id)} stops ${nameOf(c, targetId)}'s bleeding.`, 'colony');
  return out.events;
}

// ---------------------------------------------------------------- damage

function damageCreature(c: Campaign, out: Out, k: Creature, amount: number, source: KillSource) {
  const b = battleOf(c);
  const dealt = Math.min(amount, k.hp);
  k.hp -= dealt;
  out.push({ t: 'damage', id: k.id, amount: dealt });
  if (k.hp > 0) return;
  k.alive = false;
  k.burning = null;
  c.salvage += 1;
  b.kills.push({
    attack: b.attack,
    species: k.species,
    weapon: source.weapon,
    part: source.part,
    position: source.position,
    time: b.turn <= EARLY_TURNS ? 'early' : 'late',
    by: source.colonistId,
  });
  out.push({ t: 'death', id: k.id });
  out.log(`The ${SPECIES[k.species].name.toLowerCase()} dies.`, 'colony');
}

function damageUnit(c: Campaign, out: Out, u: UnitState, amount: number) {
  const col = colonistOf(c, u.colonistId);
  const dealt = Math.min(amount, col.hp);
  col.hp -= dealt;
  out.push({ t: 'damage', id: u.colonistId, amount: dealt });
  if (col.hp > 0 || u.downed) return;
  u.overwatch = false;
  u.actions = 0;
  if (col.downings >= 2) {
    // A third downing kills.
    killColonist(c, out, u, `${col.name} goes down for the third time and does not get up.`);
    return;
  }
  u.downed = true;
  u.everDowned = true;
  u.stabilized = false;
  u.bleed = BLEED_TURNS + (c.buildings.some((x) => x.kind === 'infirmary' && !x.destroyed) ? 1 : 0);
  out.push({ t: 'downed', id: u.colonistId });
  out.log(`${col.name} is down. ${u.bleed} turns to bleed out.`, 'colony');
}

function killColonist(c: Campaign, out: Out, u: UnitState, text: string) {
  const b = battleOf(c);
  const col = colonistOf(c, u.colonistId);
  col.status = 'dead';
  col.hp = 0;
  b.units = b.units.filter((x) => x !== u);
  out.push({ t: 'death', id: col.id });
  out.log(text, 'world');
}

// ---------------------------------------------------------------- the enemy phase

export function endTurn(c: Campaign): BattleEvent[] {
  const b = battleOf(c);
  if (b.phase !== 'player') return [];
  const out = new Out(b);
  b.phase = 'enemy';
  out.push({ t: 'phase', phase: 'enemy', turn: b.turn });

  // Burning.
  for (const k of liveCreatures(b)) {
    if (!k.burning) continue;
    const src = k.burning.source;
    k.burning.turns -= 1;
    if (k.burning.turns <= 0) k.burning = null;
    out.log(`The ${SPECIES[k.species].name.toLowerCase()} burns.`, 'colony');
    damageCreature(c, out, k, 1, src);
  }
  if (checkEnd(c, out)) return out.events;

  for (const k of [...liveCreatures(b)]) {
    if (!k.alive) continue;
    act(c, out, k);
    if (checkEnd(c, out)) return out.events;
  }

  // Bleeding.
  for (const u of [...b.units]) {
    if (!u.downed || u.stabilized) continue;
    u.bleed -= 1;
    if (u.bleed <= 0) killColonist(c, out, u, `${colonistOf(c, u.colonistId).name} bleeds out.`);
  }
  if (checkEnd(c, out)) return out.events;

  b.turn += 1;
  if (b.turn > TURN_LIMIT) {
    finish(c, out, 'withdrew');
    return out.events;
  }
  arrivals(c, out);
  for (const k of liveCreatures(b)) if (k.blinded > 0) k.blinded -= 1;
  for (const u of b.units) {
    u.overwatch = false;
    u.actions = u.downed ? 0 : 2;
  }
  b.phase = 'player';
  out.push({ t: 'phase', phase: 'player', turn: b.turn });
  return out.events;
}

function creatureMobility(c: Campaign, k: Creature): number {
  const b = battleOf(c);
  let m = SPECIES[k.species].mobility;
  if (k.burrowed) m += 1;
  if (k.slowed) m = Math.max(2, m - 3);
  if (has(c, 'lunge')) m += 1;
  if (has(c, 'surge') && b.turn <= 2) m += 2;
  return m;
}

/** Fixed tactical rules: the same species always behaves the same way. */
function act(c: Campaign, out: Out, k: Creature) {
  const b = battleOf(c);
  const sp = SPECIES[k.species];

  if (k.burrowed) {
    burrowedMove(c, out, k);
    return;
  }

  if (k.blinded > 0) {
    // A blind creature wanders and strikes only what is next to it.
    const steps = 2;
    const path: Vec[] = [{ ...k.pos }];
    for (let i = 0; i < steps; i++) {
      const opts: Vec[] = [];
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const n = { x: k.pos.x + dx, y: k.pos.y + dy };
        if (inBounds(c.map, n.x, n.y) && canStand(c.map, n) && !occupiedAt(b, n)) opts.push(n);
      }
      if (!opts.length) break;
      k.pos = pick(c.rng, opts);
      path.push({ ...k.pos });
    }
    if (path.length > 1) out.push({ t: 'move', id: k.id, path });
    const near = standingUnits(b).find((u) => adjacent(u.pos, k.pos));
    if (near) strike(c, out, k, near, 'bite');
    return;
  }

  const target = targetFor(c, k);
  if (strikeIfAble(c, out, k, target)) return;

  // Move toward the goal.
  const goals = target.goals;
  const opts: MoveOpts = {
    mover: 'creature',
    blocked: unitTiles(b),
    occupied: creatureTiles(b, k.id),
    climbers: has(c, 'climbers'),
  };
  const r = reach(c.map, k.pos, 400, opts);
  let best: Vec | null = null;
  let bestCost = Infinity;
  for (const g of goals) {
    const gk = key(g);
    if (opts.occupied.has(gk) || opts.blocked.has(gk)) continue;
    const cost = r.cost.get(gk);
    if (cost !== undefined && cost < bestCost) {
      bestCost = cost;
      best = g;
    }
  }
  if (!best) {
    // No way through: get as close as possible.
    let bd = Infinity;
    for (const kk of r.cost.keys()) {
      const p = { x: kk % 1000, y: Math.floor(kk / 1000) };
      if (opts.occupied.has(kk) || !canStand(c.map, p)) continue;
      const d = dist(p, target.center);
      if (d < bd) {
        bd = d;
        best = p;
      }
    }
  }
  if (best) {
    const full = pathTo(r, best);
    walk(c, out, k, full, creatureMobility(c, k), opts);
  }
  if (!k.alive) return;
  if (strikeIfAble(c, out, k, target)) return;
  // Grazers flick quills at anyone close.
  if (sp.ranged) {
    const inRange = standingUnits(b)
      .filter((u) => dist(u.pos, k.pos) <= sp.ranged!.range && hasLos(c.map, k.pos, u.pos, SIGHT))
      .sort((p, q) => dist(p.pos, k.pos) - dist(q.pos, k.pos));
    if (inRange.length) strike(c, out, k, inRange[0], 'quills');
  }
}

interface Target {
  goals: Vec[];
  center: Vec;
  building: Building | null;
  unit: UnitState | null;
}

function targetFor(c: Campaign, k: Creature): Target {
  const b = battleOf(c);
  const standing = standingUnits(b);
  // Coughing gives you away.
  const cougher = standing
    .filter((u) => colonistOf(c, u.colonistId).scars.includes('burned_lungs') && dist(u.pos, k.pos) <= 8)
    .sort((p, q) => dist(p.pos, k.pos) - dist(q.pos, k.pos))[0];
  // Climbers go for whoever shoots from above.
  const perched = has(c, 'climbers')
    ? standing.filter((u) => tileAt(c.map, u.pos.x, u.pos.y).elevation > 0 && dist(u.pos, k.pos) <= 10).sort((p, q) => dist(p.pos, k.pos) - dist(q.pos, k.pos))[0]
    : undefined;
  const hunted = cougher ?? perched ?? (b.intent.kind === 'colonists' ? standing.sort((p, q) => dist(p.pos, k.pos) - dist(q.pos, k.pos))[0] : undefined);
  if (hunted) {
    const goals: Vec[] = [];
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        const p = { x: hunted.pos.x + dx, y: hunted.pos.y + dy };
        if ((dx || dy) && inBounds(c.map, p.x, p.y) && canStand(c.map, p)) goals.push(p);
      }
    return { goals, center: hunted.pos, building: null, unit: hunted };
  }
  if (b.intent.kind === 'building') {
    const bid = b.intent.buildingId;
    const bld = c.buildings.find((x) => x.id === bid)!;
    return {
      goals: goalTiles(c, b.intent),
      center: { x: bld.pos.x + (bld.size - 1) / 2, y: bld.pos.y + (bld.size - 1) / 2 },
      building: bld,
      unit: null,
    };
  }
  return { goals: [{ ...CENTER }], center: CENTER, building: null, unit: null };
}

function strikeIfAble(c: Campaign, out: Out, k: Creature, target: Target): boolean {
  const b = battleOf(c);
  if (target.building && !target.building.destroyed && touchesBuilding(k.pos, target.building)) {
    gnaw(c, out, k, target.building);
    return true;
  }
  const near = standingUnits(b)
    .filter((u) => adjacent(u.pos, k.pos))
    .sort((p, q) => (p === target.unit ? -1 : q === target.unit ? 1 : 0))[0];
  if (near) {
    strike(c, out, k, near, SPECIES[k.species].burrows ? 'slam' : 'bite');
    return true;
  }
  return false;
}

function gnaw(c: Campaign, out: Out, k: Creature, bld: Building) {
  const dmg = Math.min(SPECIES[k.species].gnaw, bld.hp);
  bld.hp -= dmg;
  out.push({ t: 'gnaw', from: k.id, building: bld.id, damage: dmg });
  out.log(`A ${SPECIES[k.species].name.toLowerCase()} tears at ${buildingName(c, bld.id)} (${bld.hp}/${bld.maxHp}).`, 'world');
  if (bld.hp <= 0) {
    destroyBuilding(c.map, bld);
    out.push({ t: 'destroyed', building: bld.id });
    out.push({ t: 'terrain' });
    out.log(`${capitalise(buildingName(c, bld.id))} is destroyed.`, 'world');
    if (bld.kind === 'habitat' && c.stores > 0) {
      const lost = Math.ceil(c.stores / 2);
      c.stores -= lost;
      out.log(`Half the ship's stores go with it: ${lost} lost.`, 'world');
    }
  }
}

function capitalise(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

function strike(c: Campaign, out: Out, k: Creature, u: UnitState, kind: 'bite' | 'quills' | 'slam') {
  const sp = SPECIES[k.species];
  let chance: number;
  let damage: number;
  if (kind === 'quills') {
    let cover = coverAgainst(c.map, u.pos, k.pos);
    if (has(c, 'hooked_limbs')) {
      if (cover > 0) notice(c, out, 'hooked_limbs');
      cover = Math.max(0, cover - 1) as 0 | 1 | 2;
    }
    chance = sp.ranged!.aim - (cover === 2 ? 40 : cover === 1 ? 20 : 0);
    damage = sp.ranged!.damage;
  } else {
    chance = sp.attackAim;
    damage = sp.attackDamage + (has(c, 'lunge') ? 1 : 0);
    if (has(c, 'lunge')) notice(c, out, 'lunge');
  }
  const { hit, roll } = rollPct(c.rng, chance);
  out.push({ t: 'strike', from: k.id, to: u.colonistId, kind, chance, roll, hit, damage: hit ? damage : 0 });
  const verb = { bite: 'bites', quills: 'flicks quills at', slam: 'slams into' }[kind];
  out.log(`A ${sp.name.toLowerCase()} ${verb} ${nameOf(c, u.colonistId)}: ${hit ? 'hit' : 'miss'}. ${chance}% — rolled ${roll}.`, 'world');
  if (hit) damageUnit(c, out, u, damage);
}

/**
 * Walk a creature along `path` as far as `budget` allows, stopping on a tile it can stand on.
 * Overwatch fires as it enters each tile.
 */
function walk(c: Campaign, out: Out, k: Creature, path: Vec[], budget: number, opts: MoveOpts) {
  const b = battleOf(c);
  // Work out where it will stop first.
  let spent = 0;
  let stopAt = 0;
  for (let i = 1; i < path.length; i++) {
    const a = path[i - 1];
    const n = path[i];
    spent += stepCost(c.map, a, n, opts);
    if (spent > budget) break;
    if (canStand(c.map, n) && !opts.occupied.has(key(n))) stopAt = i;
  }
  if (stopAt === 0) return;
  if (has(c, 'climbers') && path.slice(0, stopAt + 1).some((p, i) => i > 0 && tileAt(c.map, p.x, p.y).elevation > tileAt(c.map, path[i - 1].x, path[i - 1].y).elevation)) {
    notice(c, out, 'climbers');
  }
  let seg: Vec[] = [{ ...path[0] }];
  for (let i = 1; i <= stopAt; i++) {
    k.pos = { ...path[i] };
    seg.push({ ...k.pos });
    const watchers = b.units.filter((u) => u.overwatch && !u.downed);
    for (const u of watchers) {
      const weapon = reactionWeapon(c, u, k);
      if (!weapon) continue;
      out.push({ t: 'move', id: k.id, path: seg });
      seg = [{ ...k.pos }];
      u.overwatch = false;
      resolveShot(c, out, u.colonistId, weapon, k.id, 'torso', true);
      if (!k.alive) return;
    }
  }
  if (seg.length > 1) out.push({ t: 'move', id: k.id, path: seg });
}

function reactionWeapon(c: Campaign, u: UnitState, k: Creature): WeaponId | null {
  const st = unitStats(colonistOf(c, u.colonistId));
  for (const w of st.weapons) {
    const def = WEAPONS[w];
    if (def.area || def.melee) continue;
    if (dist(u.pos, k.pos) <= def.range && hasLos(c.map, u.pos, k.pos, st.sight)) return w;
  }
  return null;
}

function burrowedMove(c: Campaign, out: Out, k: Creature) {
  const b = battleOf(c);
  const target = targetFor(c, k);
  const budget = creatureMobility(c, k);
  // Underground: a straight line toward the target, under anything but rock.
  const path: Vec[] = [{ ...k.pos }];
  let pos = { ...k.pos };
  let spent = 0;
  const near = () =>
    target.building ? chebyshev(pos, target.center) <= Math.ceil(target.building.size / 2) + 2 : chebyshev(pos, target.center) <= 2;
  while (spent < budget && !near()) {
    const dx = Math.sign(Math.round(target.center.x) - pos.x);
    const dy = Math.sign(Math.round(target.center.y) - pos.y);
    const options: Vec[] = [
      { x: pos.x + dx, y: pos.y + dy },
      { x: pos.x + dx, y: pos.y },
      { x: pos.x, y: pos.y + dy },
    ].filter((p) => (p.x !== pos.x || p.y !== pos.y) && inBounds(c.map, p.x, p.y) && tileAt(c.map, p.x, p.y).base !== 'rock');
    if (!options.length) break;
    const nxt = options[0];
    spent += nxt.x !== pos.x && nxt.y !== pos.y ? 1.5 : 1;
    if (spent > budget) break;
    pos = nxt;
    path.push({ ...pos });
  }
  const tooCloseToUnit = standingUnits(b).some((u) => adjacent(u.pos, pos));
  const stuck = path.length === 1;
  if (!stuck) {
    k.pos = pos;
    out.push({ t: 'move', id: k.id, path });
  }
  if (near() || tooCloseToUnit || stuck) surface(c, out, k);
}

function surface(c: Campaign, out: Out, k: Creature) {
  const b = battleOf(c);
  // Find a tile it can come up on: here, or the nearest free standable tile.
  let spot: Vec | null = null;
  for (let r = 0; r <= 3 && !spot; r++) {
    const ring: Vec[] = [];
    for (let y = k.pos.y - r; y <= k.pos.y + r; y++)
      for (let x = k.pos.x - r; x <= k.pos.x + r; x++) {
        const p = { x, y };
        if (chebyshev(p, k.pos) !== r || !inBounds(c.map, x, y)) continue;
        if (canStand(c.map, p) && !occupiedAt(b, p)) ring.push(p);
      }
    if (ring.length) spot = ring[int(c.rng, ring.length)];
  }
  if (!spot) return;
  k.pos = spot;
  k.burrowed = false;
  out.push({ t: 'surface', id: k.id, at: { ...spot } });
  out.log(`A rootcrawler breaks the surface.`, 'world');
  for (const u of b.units.filter((x) => x.overwatch && !x.downed)) {
    const w = reactionWeapon(c, u, k);
    if (!w) continue;
    u.overwatch = false;
    resolveShot(c, out, u.colonistId, w, k.id, 'torso', true);
    if (!k.alive) return;
  }
}

// ---------------------------------------------------------------- ending

function checkEnd(c: Campaign, out: Out): boolean {
  const b = battleOf(c);
  if (b.outcome) return true;
  if (b.units.length === 0 || b.units.every((u) => u.downed)) return finish(c, out, 'fallen');
  if (b.intent.kind === 'building') {
    const bid = b.intent.buildingId;
    const bld = c.buildings.find((x) => x.id === bid);
    if (bld?.destroyed) return finish(c, out, 'intent_reached');
  } else {
    // Hunting the colonists: reached once half of those who started the attack are down or dead.
    const lost = b.startCount - b.units.filter((u) => !u.downed).length;
    if (lost > 0 && lost >= Math.ceil(b.startCount / 2)) return finish(c, out, 'intent_reached');
  }
  const pending = b.waves.some((w) => !w.arrived);
  if (!pending && liveCreatures(b).length === 0) return finish(c, out, 'held');
  return false;
}

function finish(c: Campaign, out: Out, outcome: NonNullable<Battle['outcome']>): true {
  const b = battleOf(c);
  b.outcome = outcome;
  b.phase = 'over';
  const text = {
    held: 'The last of them is dead. It is quiet.',
    withdrew: 'They pull back into the growth.',
    intent_reached: 'They got what they came for. The rest pull back.',
    fallen: 'No one is left standing.',
  }[outcome];
  out.log(text, outcome === 'held' || outcome === 'withdrew' ? 'colony' : 'world');
  out.push({ t: 'end', outcome });
  return true;
}
