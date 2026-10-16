// Balance probe: plays many seeded campaigns with two simple bots and prints outcomes.
// Not part of `npm test`. Run with `npm run probe`.
import { it } from 'vitest';
import { campaignOver, concludeAttack, finishBuildPhase, newCampaign, repairBuilding } from '../src/sim/campaign';
import {
  beginBattle,
  canDeployAt,
  canTarget,
  deploy,
  endTurn,
  fire,
  liveCreatures,
  moveRange,
  moveUnit,
  overwatch,
  shotBreakdown,
  startBattle,
  unitStats,
} from '../src/sim/combat';
import { dist } from '../src/sim/map';
import { goalTiles } from '../src/sim/mind';
import type { BodyPart, Campaign, WeaponId } from '../src/sim/types';

const SEEDS = 50;

/** Stays where it deployed, shoots the first thing it can at the torso, otherwise overwatches. */
function stationary(c: Campaign) {
  startBattle(c);
  beginBattle(c);
  turns(c, (u) => {
    const b = c.battle!;
    const st = unitStats(c.colonists.find((x) => x.id === u)!);
    for (const w of st.weapons) {
      const t = liveCreatures(b).find((k) => !k.burrowed && canTarget(c, u, w, k.id));
      if (t) return void fire(c, u, w, t.id, 'torso');
    }
    overwatch(c, u);
  });
}

/** Deploys next to the target, takes the best expected shot (any part), prioritises rootcrawlers. */
function guard(c: Campaign) {
  const b0 = startBattle(c);
  const goals = goalTiles(c, b0.intent).filter((p) => canDeployAt(c, p));
  b0.units.forEach((u, i) => {
    const g = goals[(i * 3) % Math.max(1, goals.length)];
    if (g) deploy(c, u.colonistId, g);
  });
  beginBattle(c);
  turns(c, (u) => {
    const b = c.battle!;
    const unit = b.units.find((x) => x.colonistId === u)!;
    const st = unitStats(c.colonists.find((x) => x.id === u)!);
    const ts = liveCreatures(b).filter((k) => !k.burrowed);
    let best: { w: WeaponId; k: string; part: BodyPart; ev: number } | null = null;
    for (const w of st.weapons)
      for (const k of ts) {
        if (!canTarget(c, u, w, k.id)) continue;
        for (const part of ['torso', 'head', 'legs'] as BodyPart[]) {
          const bd = shotBreakdown(c, u, w, k.id, part);
          const ev = ((bd.chance / 100) * Math.min(bd.damage, k.hp)) / k.hp + (k.species === 'rootcrawler' ? 0.2 : 0);
          if (!best || ev > best.ev) best = { w, k: k.id, part, ev };
        }
      }
    if (best) return void fire(c, u, best.w, best.k, best.part);
    const near = ts.sort((p, q) => dist(p.pos, unit.pos) - dist(q.pos, unit.pos))[0];
    if (near && dist(near.pos, unit.pos) > 10) {
      const d = moveRange(c, u).walk.sort((p, q) => dist(p, near.pos) - dist(q, near.pos))[0];
      if (d) moveUnit(c, u, d);
    }
    overwatch(c, u);
  });
}

function turns(c: Campaign, act: (colonistId: string) => void) {
  let guardN = 0;
  while (c.battle!.phase !== 'over' && guardN++ < 200) {
    for (const u of [...c.battle!.units]) {
      if (c.battle!.phase !== 'player' || u.downed || u.actions === 0) continue;
      act(u.colonistId);
    }
    if (c.battle!.phase === 'player') endTurn(c);
  }
}

function run(name: string, bot: (c: Campaign) => void, between: (c: Campaign) => void) {
  const outcomes: Record<number, Record<string, number>> = { 1: {}, 2: {}, 3: {} };
  const adaptations: Record<string, number> = {};
  let dead = 0;
  let fell = 0;
  for (let s = 1; s <= SEEDS; s++) {
    const c = newCampaign(s);
    while (!campaignOver(c)) {
      between(c);
      finishBuildPhase(c);
      bot(c);
      const sm = concludeAttack(c);
      outcomes[sm.attack][sm.outcome] = (outcomes[sm.attack][sm.outcome] ?? 0) + 1;
      if (sm.adaptation) adaptations[`${sm.attack}:${sm.adaptation.id}`] = (adaptations[`${sm.attack}:${sm.adaptation.id}`] ?? 0) + 1;
    }
    dead += c.colonists.filter((x) => x.status === 'dead').length;
    if (campaignOver(c) === 'fallen') fell += 1;
  }
  console.log(`\n${name} (${SEEDS} seeds)`);
  for (const a of [1, 2, 3]) console.log(`  attack ${a}: ${JSON.stringify(outcomes[a])}`);
  console.log(`  colonists dead per campaign: ${(dead / SEEDS).toFixed(2)} · campaigns fallen: ${fell}`);
  console.log(`  adaptations: ${JSON.stringify(adaptations)}`);
}

it('balance', () => {
  run('stationary, torso only, builds nothing', stationary, () => {});
  run('guards the target, best shot, repairs the habitat', guard, (c) => {
    while (repairBuilding(c, 'habitat') === null);
  });
});
