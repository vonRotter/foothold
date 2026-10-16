import { describe, expect, it } from 'vitest';
import {
  buildPointsLeft,
  buildPointsTotal,
  clearGrowth,
  dropBuilding,
  finishBuildPhase,
  material,
  newCampaign,
  placeWall,
  setJob,
  undoAt,
  undoLast,
} from '../src/sim/campaign';
import { beginBattle, endTurn, startBattle, waveSchedule } from '../src/sim/combat';
import { tileAt } from '../src/sim/map';

describe('build phase', () => {
  it('the game starts in a build phase with a habitat and some defences', () => {
    const c = newCampaign(1);
    expect(c.build).not.toBeNull();
    expect(c.buildings.map((b) => b.kind)).toEqual(['habitat']);
    let walls = 0;
    for (const t of c.map.tiles) if (t.structure) walls += 1;
    expect(walls).toBeGreaterThan(8);
  });

  it('builders supply build points; walls spend points and material, and undo refunds both', () => {
    const c = newCampaign(1);
    const total = buildPointsTotal(c);
    expect(total).toBeGreaterThan(0);
    const mat = material(c);
    expect(placeWall(c, { x: 18, y: 30 }, 'lowwall')).toBeNull();
    expect(buildPointsLeft(c)).toBe(total - 1);
    expect(material(c)).toBe(mat - 1);
    expect(tileAt(c.map, 18, 30).structure?.kind).toBe('lowwall');
    expect(undoAt(c, { x: 18, y: 30 })).toBe(true);
    expect(buildPointsLeft(c)).toBe(total);
    expect(material(c)).toBe(mat);
    expect(tileAt(c.map, 18, 30).structure).toBeNull();
  });

  it('cannot build outside the colony, or full walls without a staffed workshop', () => {
    const c = newCampaign(1);
    expect(placeWall(c, { x: 3, y: 3 }, 'lowwall')).toMatch(/Outside/);
    expect(placeWall(c, { x: 18, y: 30 }, 'wall')).toMatch(/workshop/);
    dropBuilding(c, 'workshop', { x: 30, y: 24 });
    expect(setJob(c, 'haddad', { kind: 'staff', buildingId: 'workshop' })).toBeNull();
    expect(placeWall(c, { x: 18, y: 30 }, 'wall')).toBeNull();
  });

  it('will not take builders off a job whose points are already spent', () => {
    const c = newCampaign(1);
    for (const id of ['okafor', 'lindqvist', 'moreau']) setJob(c, id, { kind: 'rest' });
    expect(buildPointsTotal(c)).toBe(6); // the engineer alone
    for (let i = 0; i < 6; i++) expect(placeWall(c, { x: 15 + i, y: 31 }, 'lowwall')).toBeNull();
    expect(placeWall(c, { x: 22, y: 31 }, 'lowwall')).toMatch(/build points/);
    expect(setJob(c, 'haddad', { kind: 'rest' })).toMatch(/already spent/);
    expect(undoLast(c)).toBe(true);
    expect(buildPointsLeft(c)).toBe(1);
  });

  it('clearing growth costs a point and can be undone', () => {
    const c = newCampaign(1);
    tileAt(c.map, 15, 15).growth = true;
    expect(clearGrowth(c, { x: 15, y: 15 })).toBeNull();
    expect(tileAt(c.map, 15, 15).growth).toBe(false);
    undoAt(c, { x: 15, y: 15 });
    expect(tileAt(c.map, 15, 15).growth).toBe(true);
  });
});

describe('waves', () => {
  it('arrive on their scheduled turns whatever is killed', () => {
    const c = newCampaign(2);
    finishBuildPhase(c);
    const schedule = waveSchedule(c).map((w) => w.turn);
    startBattle(c);
    beginBattle(c);
    const b = c.battle!;
    expect(b.waves.map((w) => w.turn)).toEqual(schedule);
    // Kill nothing; just end turns. Each wave arrives exactly on its turn.
    for (let turn = 1; turn <= 4 && b.phase !== 'over'; turn++) {
      for (const w of b.waves) expect(w.arrived).toBe(w.turn <= b.turn);
      endTurn(c);
    }
  });

  it('the time adaptations shift the schedule, and only them', () => {
    const c = newCampaign(2);
    c.attack = 2;
    const plain = waveSchedule(c).map((w) => w.turn);
    c.adaptations.push({ id: 'staggered', category: 'time', value: 'early', after: 1 });
    expect(waveSchedule(c).map((w) => w.turn)).toEqual(plain.map((t, i) => t + i));
  });
});
