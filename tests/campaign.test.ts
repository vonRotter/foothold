import { describe, expect, it } from 'vitest';
import { advanceToNextAttack, campaignOver, concludeAttack, newCampaign, runDay } from '../src/sim/campaign';
import {
  beginBattle,
  canTarget,
  endTurn,
  fire,
  liveCreatures,
  moveRange,
  moveUnit,
  overwatch,
  shotBreakdown,
  startBattle,
  throwArea,
  unitStats,
} from '../src/sim/combat';
import { dist } from '../src/sim/map';
import type { BodyPart, Campaign } from '../src/sim/types';

/** A simple bot: shoot what it can see, otherwise step toward the nearest creature and watch. */
function playBattle(c: Campaign, part: BodyPart = 'torso'): void {
  startBattle(c);
  beginBattle(c);
  let guard = 0;
  while (c.battle!.phase !== 'over' && guard++ < 200) {
    const b = c.battle!;
    for (const u of [...b.units]) {
      if (b.phase !== 'player' || u.downed) continue;
      const col = c.colonists.find((x) => x.id === u.colonistId)!;
      const st = unitStats(col);
      const targets = liveCreatures(b).filter((k) => !k.burrowed);
      let shot = false;
      for (const w of st.weapons) {
        const t = targets.find((k) => canTarget(c, u.colonistId, w, k.id));
        if (t) {
          fire(c, u.colonistId, w, t.id, part);
          shot = true;
          break;
        }
      }
      if (shot || b.phase !== 'player') continue;
      const nearest = targets.sort((p, q) => dist(p.pos, u.pos) - dist(q.pos, u.pos))[0];
      if (nearest) {
        const r = moveRange(c, u.colonistId);
        const dest = r.walk.sort((p, q) => dist(p, nearest.pos) - dist(q, nearest.pos))[0];
        if (dest && dist(dest, nearest.pos) > 4) moveUnit(c, u.colonistId, dest);
      }
      overwatch(c, u.colonistId);
    }
    if (c.battle!.phase === 'player') endTurn(c);
  }
  expect(c.battle!.phase).toBe('over');
}

describe('campaign', () => {
  it('is deterministic for a seed', () => {
    const a = newCampaign(42);
    const b = newCampaign(42);
    playBattle(a);
    playBattle(b);
    expect(a.battle!.log).toEqual(b.battle!.log);
  });

  it('plays three attacks to an ending on many seeds', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const c = newCampaign(seed);
      while (!campaignOver(c)) {
        playBattle(c);
        concludeAttack(c);
        if (campaignOver(c)) break;
        for (let d = 0; d < 3; d++) runDay(c, {});
        advanceToNextAttack(c);
      }
      expect(c.history.length).toBeGreaterThan(0);
      expect(['won', 'fallen']).toContain(campaignOver(c));
    }
  });

  it('records every kill and pushes an adaptation traceable to them', () => {
    const c = newCampaign(7);
    playBattle(c, 'legs');
    const s = concludeAttack(c);
    if (s.kills > 0) {
      expect(s.adaptation).not.toBeNull();
      const k = c.kills;
      const value = s.adaptation!.value;
      expect(k.some((x) => x[s.adaptation!.category] === value)).toBe(true);
    }
  });

  it('shows an honest, itemised hit chance', () => {
    const c = newCampaign(3);
    startBattle(c);
    beginBattle(c);
    const b = c.battle!;
    const k = liveCreatures(b)[0];
    const u = b.units[0];
    // Put the creature in the open 6 tiles away.
    k.pos = { x: u.pos.x, y: u.pos.y - 6 };
    const bd = shotBreakdown(c, u.colonistId, 'rifle', k.id, 'head');
    expect(bd.chance).toBe(Math.max(0, Math.min(100, bd.parts.reduce((s, p) => s + p.value, 0))));
    expect(bd.parts.find((p) => p.label === 'Head')!.value).toBe(-30);
  });

  it('a third downing kills', () => {
    const c = newCampaign(5);
    c.colonists[0].downings = 2;
    startBattle(c);
    beginBattle(c);
    const b = c.battle!;
    // Damage the unit to zero through the public path: a grenade at their feet.
    c.colonists[0].hp = 1;
    const thrower = b.units.find((u) => u.colonistId === 'okafor')!;
    // Okafor throws at a tile next to themself, within the blast.
    const at = { x: thrower.pos.x + 1, y: thrower.pos.y };
    expect(throwArea(c, 'okafor', 'grenade', at)).not.toBeNull();
    expect(c.colonists[0].status).toBe('dead');
  });
});
