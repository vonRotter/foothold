import type {
  AdaptationId,
  BodyPart,
  BuildingKind,
  KillCategory,
  PositionBucket,
  RoleId,
  ScarId,
  SpeciesId,
  TimeBucket,
  WeaponCategory,
  WeaponId,
} from './types';

// ---------------------------------------------------------------- roles

export interface RoleDef {
  id: RoleId;
  name: string;
  combat: boolean;
  hp: number;
  aim: number;
  mobility: number;
  weapons: WeaponId[];
  /** Charges per battle for limited weapons. */
  charges: Partial<Record<WeaponId, number>>;
  /** Wall segments per day when assigned to Build. */
  buildRate: number;
  blurb: string;
}

export const ROLES: Record<RoleId, RoleDef> = {
  rifleman: {
    id: 'rifleman',
    name: 'Rifleman',
    combat: true,
    hp: 7,
    aim: 70,
    mobility: 5,
    weapons: ['rifle', 'grenade', 'knife'],
    charges: { grenade: 1 },
    buildRate: 1,
    blurb: 'The dependable standard.',
  },
  marksman: {
    id: 'marksman',
    name: 'Marksman',
    combat: true,
    hp: 5,
    aim: 76,
    mobility: 5,
    weapons: ['longrifle', 'pistol', 'knife'],
    charges: {},
    buildRate: 1,
    blurb: 'Long range, poor up close.',
  },
  engineer: {
    id: 'engineer',
    name: 'Engineer',
    combat: false,
    hp: 6,
    aim: 58,
    mobility: 5,
    weapons: ['pistol', 'flamer', 'knife'],
    charges: { flamer: 2 },
    buildRate: 2,
    blurb: 'Builds and repairs between attacks.',
  },
  xenobiologist: {
    id: 'xenobiologist',
    name: 'Xenobiologist',
    combat: false,
    hp: 4,
    aim: 48,
    mobility: 5,
    weapons: ['pistol', 'knife'],
    charges: {},
    buildRate: 1,
    blurb: 'Dissects the dead and predicts the next adaptation.',
  },
};

// ---------------------------------------------------------------- weapons

export interface WeaponDef {
  id: WeaponId;
  name: string;
  category: WeaponCategory;
  damage: number;
  range: number;
  /** Area weapons always land on the chosen tile; no body part, no roll. */
  area: boolean;
  radius: number;
  melee: boolean;
  heavy: boolean;
  /** Aim modifier as a function of distance in tiles. */
  rangeMod: (d: number) => number;
}

export const WEAPONS: Record<WeaponId, WeaponDef> = {
  rifle: {
    id: 'rifle', name: 'Rifle', category: 'ballistic', damage: 3, range: 14, area: false, radius: 0, melee: false, heavy: false,
    rangeMod: (d) => (d > 10 ? -3 * (d - 10) : 0),
  },
  longrifle: {
    id: 'longrifle', name: 'Long rifle', category: 'ballistic', damage: 4, range: 18, area: false, radius: 0, melee: false, heavy: true,
    rangeMod: (d) => (d <= 3 ? -20 : d >= 8 ? 5 : 0),
  },
  pistol: {
    id: 'pistol', name: 'Pistol', category: 'ballistic', damage: 2, range: 9, area: false, radius: 0, melee: false, heavy: false,
    rangeMod: (d) => (d > 5 ? -5 * (d - 5) : 5),
  },
  grenade: {
    id: 'grenade', name: 'Grenade', category: 'explosive', damage: 3, range: 8, area: true, radius: 1, melee: false, heavy: false,
    rangeMod: () => 0,
  },
  flamer: {
    id: 'flamer', name: 'Flamer', category: 'fire', damage: 2, range: 4, area: true, radius: 1, melee: false, heavy: true,
    rangeMod: () => 0,
  },
  knife: {
    id: 'knife', name: 'Knife', category: 'blade', damage: 3, range: 1, area: false, radius: 0, melee: true, heavy: false,
    rangeMod: () => 20,
  },
};

// ---------------------------------------------------------------- body parts

export interface PartDef {
  id: BodyPart;
  name: string;
  aim: number;
  effect: string;
}

export const PARTS: Record<BodyPart, PartDef> = {
  torso: { id: 'torso', name: 'Torso', aim: 0, effect: '+1 damage' },
  legs: { id: 'legs', name: 'Legs', aim: -5, effect: '-1 damage, slows it' },
  sense: { id: 'sense', name: 'Sense organ', aim: -20, effect: '-1 damage, blinds it' },
  head: { id: 'head', name: 'Head', aim: -30, effect: 'kills outright' },
};

export const PART_ORDER: BodyPart[] = ['torso', 'legs', 'sense', 'head'];

// ---------------------------------------------------------------- species

export interface SpeciesDef {
  id: SpeciesId;
  name: string;
  hp: number;
  mobility: number;
  attackDamage: number;
  attackAim: number;
  /** Damage to a building per gnaw. */
  gnaw: number;
  /** Short-range ranged attack, reduced by cover. */
  ranged: { damage: number; aim: number; range: number } | null;
  burrows: boolean;
  blurb: string;
}

export const SPECIES: Record<SpeciesId, SpeciesDef> = {
  grazer: {
    id: 'grazer',
    name: 'Grazer',
    hp: 4,
    mobility: 7,
    attackDamage: 2,
    attackAim: 75,
    gnaw: 1,
    ranged: { damage: 1, aim: 60, range: 4 },
    burrows: false,
    blurb: 'Fast, fragile, numerous. Runs for its target; flicks quills at anyone close.',
  },
  rootcrawler: {
    id: 'rootcrawler',
    name: 'Rootcrawler',
    hp: 7,
    mobility: 4,
    attackDamage: 3,
    attackAim: 75,
    gnaw: 2,
    ranged: null,
    burrows: true,
    blurb: 'Moves underground, ignoring walls. Cannot be shot until it surfaces.',
  },
};

// ---------------------------------------------------------------- scars

export interface ScarDef {
  id: ScarId;
  name: string;
  effect: string;
}

export const SCARS: Record<ScarId, ScarDef> = {
  lost_eye: { id: 'lost_eye', name: 'Lost eye', effect: 'Sight -4 tiles, overwatch -10' },
  shattered_knee: { id: 'shattered_knee', name: 'Shattered knee', effect: 'One less move' },
  tremor: { id: 'tremor', name: 'Tremor', effect: 'Overwatch -30' },
  burned_lungs: { id: 'burned_lungs', name: 'Burned lungs', effect: 'Cannot dash; coughing draws creatures within 8 tiles' },
  nerve_damage: { id: 'nerve_damage', name: 'Nerve damage', effect: 'Cannot use heavy weapons (long rifle, flamer)' },
  shell_shock: { id: 'shell_shock', name: 'Shell shock', effect: 'Cannot end a move next to a creature' },
};

export const SCAR_ORDER: ScarId[] = ['lost_eye', 'shattered_knee', 'tremor', 'burned_lungs', 'nerve_damage', 'shell_shock'];

// ---------------------------------------------------------------- buildings

export interface BuildingDef {
  kind: BuildingKind;
  name: string;
  size: number;
  hp: number;
  cost: number;
  gives: string;
  needs: RoleId | null;
}

export const BUILDINGS: Record<BuildingKind, BuildingDef> = {
  pod: { kind: 'pod', name: 'Landing pod', size: 3, hp: 20, cost: 0, gives: 'Holds the ship\'s stores. If it falls, half of what is left goes with it.', needs: null },
  lab: { kind: 'lab', name: 'Xeno lab', size: 2, hp: 12, cost: 4, gives: 'A staffed lab produces a dissection report before the next attack.', needs: 'xenobiologist' },
  infirmary: { kind: 'infirmary', name: 'Infirmary', size: 2, hp: 12, cost: 3, gives: 'Heal restores full health; downed colonists bleed out one turn slower.', needs: null },
  workshop: { kind: 'workshop', name: 'Workshop', size: 2, hp: 12, cost: 3, gives: 'A staffed workshop lets anyone build full walls.', needs: 'engineer' },
};

export const DROPPABLE: BuildingKind[] = ['lab', 'infirmary', 'workshop'];

// ---------------------------------------------------------------- the mind

export const CATEGORY_VALUES: Record<KillCategory, readonly string[]> = {
  weapon: ['ballistic', 'fire', 'explosive', 'blade'] satisfies WeaponCategory[],
  part: ['legs', 'torso', 'head', 'sense'] satisfies BodyPart[],
  position: ['high_ground', 'cover', 'close', 'long'] satisfies PositionBucket[],
  time: ['early', 'late'] satisfies TimeBucket[],
};

/** Fixed tie-break order when two categories have been adapted equally recently. */
export const CATEGORY_ORDER: KillCategory[] = ['weapon', 'part', 'position', 'time'];

export const VALUE_LABEL: Record<string, string> = {
  ballistic: 'bullets',
  fire: 'fire',
  explosive: 'explosives',
  blade: 'blades',
  legs: 'shots to the legs',
  torso: 'shots to the body',
  head: 'shots to the head',
  sense: 'shots to the sense organs',
  high_ground: 'fire from high ground',
  cover: 'mid-range fire from cover',
  close: 'close-range fire',
  long: 'long-range fire',
  early: 'deaths early in the attack',
  late: 'deaths late in the attack',
};

export interface AdaptationDef {
  id: AdaptationId;
  category: KillCategory;
  value: string;
  name: string;
  effect: string;
  /** What the xenobiologist writes in the dissection report. */
  report: string;
  /** What the battle log says the first time it matters, for colonies without a lab. */
  notice: string;
}

export const ADAPTATIONS: AdaptationDef[] = [
  { id: 'resist_ballistic', category: 'weapon', value: 'ballistic', name: 'Layered chitin', effect: 'Bullets do 1 less damage',
    report: 'The outer shell is laminating. Rounds will flatten on it.', notice: 'The round flattens against layered chitin.' },
  { id: 'resist_fire', category: 'weapon', value: 'fire', name: 'Wet hide', effect: 'Fire does 1 less damage and no longer burns',
    report: 'The skin is weeping a damp film. Fire will not take hold.', notice: 'The flames slide off a damp hide.' },
  { id: 'resist_explosive', category: 'weapon', value: 'explosive', name: 'Packed bodies', effect: 'Explosives do 2 less damage',
    report: 'The organs are packed in fibrous padding. Blasts will not carry through.', notice: 'The blast barely moves it.' },
  { id: 'barbed_hide', category: 'weapon', value: 'blade', name: 'Barbed hide', effect: 'Blades do 1 less damage; the attacker takes 1',
    report: 'The hide is growing hooked barbs. Anyone who gets close with a blade will bleed for it.', notice: 'The barbs cut back.' },
  { id: 'leg_plates', category: 'part', value: 'legs', name: 'Leg plates', effect: 'Leg shots -15 aim and no longer slow',
    report: 'The leg plates on these are thickening.', notice: 'The shot skips off a plated leg.' },
  { id: 'torso_plates', category: 'part', value: 'torso', name: 'Keeled chest', effect: 'Body shots do 1 less damage',
    report: 'The breastbone is growing forward into a keel. Body shots will glance.', notice: 'The shot glances off a keeled chest.' },
  { id: 'sunken_head', category: 'part', value: 'head', name: 'Sunken head', effect: 'Head shots -15 aim',
    report: 'The skull is drawing back into the shoulders. The head will be a smaller target.', notice: 'The head is sunk too deep to find.' },
  { id: 'hooded_senses', category: 'part', value: 'sense', name: 'Hooded senses', effect: 'Sense shots -10 aim and no longer blind',
    report: 'The sense pits are growing lids. Blinding them will stop working.', notice: 'A lid snaps shut over the sense pit.' },
  { id: 'climbers', category: 'position', value: 'high_ground', name: 'Climbers', effect: 'High ground gives no advantage against them',
    report: 'The forelimbs are lengthening. They will climb to whoever shoots from above.', notice: 'It scrambles up the slope without slowing.' },
  { id: 'hooked_limbs', category: 'position', value: 'cover', name: 'Hooked limbs', effect: 'Their attacks treat full cover as half and ignore half cover',
    report: 'The limbs end in long hooks. Walls will not keep them off you.', notice: 'A hooked limb reaches over the wall.' },
  { id: 'lunge', category: 'position', value: 'close', name: 'Lunge', effect: '+1 move and +1 damage up close',
    report: 'The hind muscles are swelling. They will close distance faster and hit harder when they do.', notice: 'It lunges further than it should.' },
  { id: 'mottled_skin', category: 'position', value: 'long', name: 'Mottled skin', effect: 'Shots from 10+ tiles -20 aim',
    report: 'The skin is mottling to match the ground. At distance they will be hard to pick out.', notice: 'It blurs into the ground at that distance.' },
  { id: 'staggered', category: 'time', value: 'early', name: 'Staggered arrival', effect: 'They arrive in three waves instead of two',
    report: 'The broods are hatching at different times. They will not all come at once.', notice: 'More are coming. They held back.' },
  { id: 'surge', category: 'time', value: 'late', name: 'Surge', effect: 'All arrive at once with +2 move on the first two turns',
    report: 'The broods are hatching together and hungry. They will come all at once, and fast.', notice: 'They are all coming at once.' },
];

export function adaptationFor(category: KillCategory, value: string): AdaptationDef {
  const def = ADAPTATIONS.find((a) => a.category === category && a.value === value);
  if (!def) throw new Error(`no adaptation for ${category}/${value}`);
  return def;
}

export function adaptationDef(id: AdaptationId): AdaptationDef {
  const def = ADAPTATIONS.find((a) => a.id === id);
  if (!def) throw new Error(`unknown adaptation ${id}`);
  return def;
}

// ---------------------------------------------------------------- campaign constants

export const TOTAL_ATTACKS = 3;
export const DAYS_BETWEEN = 3;
export const START_STORES = 7;
export const BLEED_TURNS = 3;
export const TURN_LIMIT = 14;
export const EARLY_TURNS = 3;
export const OVERWATCH_PENALTY = 15;
export const SIGHT = 15;

/** Colonists in the prototype. A fixed mix of combat and support. */
export const ROSTER: { id: string; name: string; role: RoleId }[] = [
  { id: 'okafor', name: 'Ines Okafor', role: 'rifleman' },
  { id: 'lindqvist', name: 'Tomas Lindqvist', role: 'marksman' },
  { id: 'haddad', name: 'Samira Haddad', role: 'engineer' },
  { id: 'moreau', name: 'Paul Moreau', role: 'xenobiologist' },
];

/** Creature counts per attack. The mind changes bodies, not numbers. */
export const ATTACK_WAVES: Record<number, { species: SpeciesId; count: number }[]> = {
  1: [{ species: 'grazer', count: 8 }],
  2: [{ species: 'grazer', count: 7 }, { species: 'rootcrawler', count: 2 }],
  3: [{ species: 'grazer', count: 7 }, { species: 'rootcrawler', count: 3 }],
};
