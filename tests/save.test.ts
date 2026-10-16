import { describe, expect, it } from 'vitest';
import { finishBuildPhase, newCampaign, placeWall } from '../src/sim/campaign';
import { beginBattle, endTurn, overwatch, startBattle } from '../src/sim/combat';
import { SAVE_VERSION, describeSave, deserialize, serialize } from '../src/sim/save';
import type { Campaign } from '../src/sim/types';

/** The same scripted turns for both copies: everyone on overwatch, then end the turn. */
function playTurns(c: Campaign, n: number) {
  for (let i = 0; i < n && c.battle!.phase === 'player'; i++) {
    for (const u of c.battle!.units) if (!u.downed && u.actions > 0) overwatch(c, u.colonistId);
    endTurn(c);
  }
}

describe('save', () => {
  it('a restored mid-battle campaign continues exactly like the original', () => {
    const a = newCampaign(21);
    placeWall(a, { x: 18, y: 30 }, 'lowwall');
    finishBuildPhase(a);
    startBattle(a);
    beginBattle(a);
    playTurns(a, 2);
    const restored = deserialize(serialize(a, ['resist_ballistic']))!;
    expect(restored.known).toEqual(['resist_ballistic']);
    const b = restored.campaign;
    playTurns(a, 4);
    playTurns(b, 4);
    expect(b.battle!.log).toEqual(a.battle!.log);
    expect(b.rng.state).toBe(a.rng.state);
  });

  it('rejects damaged or incompatible saves', () => {
    expect(deserialize(null)).toBeNull();
    expect(deserialize('{not json')).toBeNull();
    const good = JSON.parse(serialize(newCampaign(1), []));
    expect(deserialize(JSON.stringify({ ...good, version: SAVE_VERSION + 1 }))).toBeNull();
    expect(deserialize(JSON.stringify({ ...good, campaign: { ...good.campaign, colonists: null } }))).toBeNull();
  });

  it('describes where the campaign stands', () => {
    const c = newCampaign(3);
    expect(describeSave(deserialize(serialize(c, []))!)).toMatch(/^Building before mission 1 of 3 · 4 of 4 colonists · seed 3$/);
  });
});
