import type { Rng } from './rng';

export interface Vec {
  x: number;
  y: number;
}

// ---------------------------------------------------------------- map

export type Base = 'ground' | 'sand' | 'rock' | 'tree' | 'pad' | 'water' | 'ford';
/** Walls are built by the colony; crates came down with the landing and act like low walls. */
export type StructureKind = 'lowwall' | 'wall' | 'crate';
export type CoverLevel = 0 | 1 | 2; // none, half, full

export interface Structure {
  kind: StructureKind;
  /** Turns of growth contact; at 2 a wall loses one cover level (growth eats cover). */
  overgrowth: number;
}

export interface Tile {
  base: Base;
  elevation: number; // 0..3; a step of 2 or more is a cliff
  structure: Structure | null;
  buildingId: string | null;
  /** Thorn mat grown by the world. Half cover, blocks sight, slows colonists. */
  growth: boolean;
  /** Burned ground. Growth will not return here for the rest of the campaign. */
  burned: boolean;
  /** Rubble left by a destroyed building or wall. Cosmetic + half cover. */
  rubble: boolean;
}

export interface GameMap {
  w: number;
  h: number;
  tiles: Tile[];
  approaches: Approach[];
}

export type ApproachId = 'ravine' | 'ridge' | 'forest' | 'ford';

export interface Approach {
  id: ApproachId;
  name: string;
  /** Tiles creatures spawn on. */
  entry: Vec[];
}

// ---------------------------------------------------------------- buildings

export type BuildingKind = 'habitat' | 'lab' | 'infirmary' | 'workshop';

export interface Building {
  id: string;
  kind: BuildingKind;
  pos: Vec; // top-left corner
  size: number;
  hp: number;
  maxHp: number;
  destroyed: boolean;
  /** Number of attacks fought before it was dropped (0 = before the first attack, or on landing). */
  droppedAfter: number;
}

// ---------------------------------------------------------------- colonists

export type RoleId = 'rifleman' | 'marksman' | 'engineer' | 'xenobiologist';
export type ScarId = 'lost_eye' | 'shattered_knee' | 'tremor' | 'burned_lungs' | 'nerve_damage' | 'shell_shock';

export type WeaponCategory = 'ballistic' | 'fire' | 'explosive' | 'blade';
export type BodyPart = 'legs' | 'torso' | 'head' | 'sense';
export type PositionBucket = 'high_ground' | 'cover' | 'close' | 'long';
export type TimeBucket = 'early' | 'late';

export type WeaponId = 'rifle' | 'longrifle' | 'pistol' | 'grenade' | 'flamer' | 'knife';

export interface Colonist {
  id: string;
  name: string;
  role: RoleId;
  hp: number;
  maxHp: number;
  scars: ScarId[];
  downings: number;
  status: 'active' | 'dead';
  /** Two scars of the same kind: may never fight again. Still on the map. */
  retired: boolean;
  /** Training progress toward a new role (days). */
  training: { role: RoleId; days: number } | null;
  portraitSeed: number;
}

// ---------------------------------------------------------------- creatures

export type SpeciesId = 'grazer' | 'rootcrawler';

export type AdaptationId =
  | 'resist_ballistic'
  | 'resist_fire'
  | 'resist_explosive'
  | 'barbed_hide'
  | 'leg_plates'
  | 'torso_plates'
  | 'sunken_head'
  | 'hooded_senses'
  | 'climbers'
  | 'hooked_limbs'
  | 'lunge'
  | 'mottled_skin'
  | 'staggered'
  | 'surge';

export type KillCategory = 'weapon' | 'part' | 'position' | 'time';

export interface KillRecord {
  attack: number;
  species: SpeciesId;
  weapon: WeaponCategory;
  part: BodyPart | null; // null for area weapons
  position: PositionBucket;
  time: TimeBucket;
  by: string; // colonist id
}

export interface Adaptation {
  id: AdaptationId;
  category: KillCategory;
  value: string;
  /** Attack after which it was pushed. */
  after: number;
}

// ---------------------------------------------------------------- battle

export type Intent =
  | { kind: 'building'; buildingId: string; reason: string }
  | { kind: 'colonists'; reason: string };

export interface Creature {
  id: string;
  species: SpeciesId;
  pos: Vec;
  hp: number;
  maxHp: number;
  burrowed: boolean;
  slowed: boolean;
  /** Enemy turns left blinded. A blind creature wanders and only strikes what is next to it. */
  blinded: number;
  burning: { turns: number; source: KillSource } | null;
  /** Turn on which its wave arrives. */
  arrivesOn: number;
  arrived: boolean;
  alive: boolean;
}

export interface KillSource {
  colonistId: string;
  weapon: WeaponCategory;
  part: BodyPart | null;
  position: PositionBucket;
}

export interface UnitState {
  colonistId: string;
  pos: Vec;
  actions: number;
  overwatch: boolean;
  downed: boolean;
  bleed: number; // enemy turns left before bleeding out
  stabilized: boolean;
  charges: Partial<Record<WeaponId, number>>;
  everDowned: boolean;
}

export interface Battle {
  attack: number;
  turn: number;
  phase: 'deploy' | 'player' | 'enemy' | 'over';
  intent: Intent;
  approach: ApproachId;
  /** Later waves come from here. */
  secondApproach: ApproachId;
  units: UnitState[];
  /** Colonists on the map when the attack began. */
  startCount: number;
  creatures: Creature[];
  /** The fixed arrival schedule for this attack. Shown to the player; never depends on kills. */
  waves: Wave[];
  kills: KillRecord[];
  outcome: null | 'held' | 'intent_reached' | 'fallen' | 'withdrew';
  log: string[];
  /** Adaptations the player has already seen in action this campaign (for one-time battle notices). */
  noticed: AdaptationId[];
}

export interface Wave {
  turn: number;
  approach: ApproachId;
  creatureIds: string[];
  arrived: boolean;
}

// ---------------------------------------------------------------- between attacks

export type Job =
  | { kind: 'rest' }
  | { kind: 'build' }
  | { kind: 'heal' }
  | { kind: 'staff'; buildingId: string }
  | { kind: 'train'; role: RoleId };

/** Something placed this build phase, kept so it can be undone until the next mission starts. */
export type Placement =
  | { kind: 'wall'; pos: Vec; wall: StructureKind; bp: number; salvage: number; stores: number; replaced: StructureKind | null }
  | { kind: 'clear'; pos: Vec; bp: number }
  | { kind: 'repair'; buildingId: string; hp: number; bp: number; salvage: number; stores: number };

export interface BuildPhase {
  jobs: Record<string, Job>;
  spent: number;
  placed: Placement[];
}

export interface Campaign {
  seed: number;
  rng: Rng;
  map: GameMap;
  buildings: Building[];
  colonists: Colonist[];
  stores: number;
  salvage: number;
  attack: number; // number of the next / current attack (1-based)
  totalAttacks: number;
  adaptations: Adaptation[];
  kills: KillRecord[];
  battle: Battle | null;
  nextIntent: Intent | null;
  /** Set while the colony is building between missions (and before the first). */
  build: BuildPhase | null;
  history: AttackSummary[];
  /** How many tiles the world grew after each attack (for the aftermath screen). */
  lastGrowth: number;
}

export interface AttackSummary {
  attack: number;
  outcome: NonNullable<Battle['outcome']>;
  intent: Intent;
  kills: number;
  creatures: number;
  downed: string[];
  died: string[];
  newScars: { colonistId: string; scar: ScarId }[];
  adaptation: Adaptation | null;
}
