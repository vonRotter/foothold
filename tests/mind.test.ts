import { describe, expect, it } from 'vitest';
import { candidates, chooseAdaptation, chooseIntent } from '../src/sim/mind';
import { dropBuilding, newCampaign } from '../src/sim/campaign';
import type { Adaptation, KillRecord } from '../src/sim/types';

function kill(over: Partial<KillRecord>): KillRecord {
  return { attack: 1, species: 'grazer', weapon: 'ballistic', part: 'torso', position: 'cover', time: 'early', by: 'okafor', ...over };
}

describe('adaptation rule', () => {
  it('measures concentration so a 2-value category is not favoured', () => {
    // Kills split evenly across time (early/late) but 3/4 on one weapon.
    const kills = [
      kill({ weapon: 'ballistic', time: 'early', part: 'torso', position: 'cover' }),
      kill({ weapon: 'ballistic', time: 'late', part: 'legs', position: 'close' }),
      kill({ weapon: 'ballistic', time: 'early', part: 'head', position: 'long' }),
      kill({ weapon: 'fire', time: 'late', part: 'sense', position: 'high_ground' }),
    ];
    const c = candidates(kills);
    const time = c.find((x) => x.category === 'time' && x.value === 'early')!;
    const weapon = c.find((x) => x.category === 'weapon' && x.value === 'ballistic')!;
    expect(time.concentration).toBeCloseTo(0);
    expect(weapon.concentration).toBeCloseTo((0.75 - 0.25) / 0.75);
    expect(chooseAdaptation(kills, [], 1)!.adaptation.id).toBe('resist_ballistic');
  });

  it('breaks ties toward the category adapted least recently', () => {
    const kills = [kill({}), kill({})]; // all ballistic, all torso, all cover, all early: every category at 1.0
    const first = chooseAdaptation(kills, [], 1)!.adaptation;
    expect(first.category).toBe('weapon'); // nothing adapted yet: fixed order
    const second = chooseAdaptation(kills, [first], 2)!.adaptation;
    expect(second.category).toBe('part');
    expect(second.id).toBe('torso_plates');
  });

  it('never pushes the same adaptation twice', () => {
    const kills = [kill({ weapon: 'fire', part: null, position: 'close', time: 'late' })];
    const have: Adaptation[] = [
      { id: 'resist_fire', category: 'weapon', value: 'fire', after: 1 },
      { id: 'lunge', category: 'position', value: 'close', after: 1 },
    ];
    const next = chooseAdaptation(kills, have, 2)!.adaptation;
    expect(next.id).toBe('surge');
  });

  it('ignores area kills when tallying body parts', () => {
    const kills = [kill({ part: null, weapon: 'explosive' }), kill({ part: null, weapon: 'explosive' })];
    expect(candidates(kills).some((x) => x.category === 'part')).toBe(false);
  });

  it('feeding a false lesson works: a few deliberate fire kills outweigh spread-out bullets', () => {
    // Bullets spread across parts and positions; fire kills concentrated.
    const kills = [
      kill({ weapon: 'fire', part: null, position: 'close', time: 'early' }),
      kill({ weapon: 'fire', part: null, position: 'close', time: 'late' }),
      kill({ weapon: 'fire', part: null, position: 'cover', time: 'early' }),
      kill({ weapon: 'ballistic', part: 'legs', position: 'long', time: 'late' }),
    ];
    expect(chooseAdaptation(kills, [], 1)!.adaptation.id).toBe('resist_fire');
  });
});

describe('intent', () => {
  it('goes for the pod first, then the newest building', () => {
    const c = newCampaign(1);
    expect(chooseIntent(c)).toMatchObject({ kind: 'building', buildingId: 'pod' });
    c.history.push({ attack: 1, outcome: 'held', intent: chooseIntent(c), kills: 0, creatures: 0, downed: [], died: [], newScars: [], adaptation: null });
    const lab = dropBuilding(c, 'lab', { x: 15, y: 19 });
    expect(lab).not.toBeNull();
    c.attack = 2;
    const intent = chooseIntent(c);
    expect(intent).toMatchObject({ kind: 'building', buildingId: 'lab' });
    expect(intent.reason).toMatch(/newest/);
  });

  it('hunts the colonists when few are left', () => {
    const c = newCampaign(1);
    c.attack = 2;
    c.colonists[0].status = 'dead';
    c.colonists[1].status = 'dead';
    expect(chooseIntent(c).kind).toBe('colonists');
  });
});
