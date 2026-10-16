import {
  ASSIGNMENT_LABEL,
  advanceToNextAttack,
  buildBlocked,
  buildRate,
  campaignOver,
  canDrop,
  canTrain,
  concludeAttack,
  dropBuilding,
  newCampaign,
  runDay,
  type Assignment,
} from '../sim/campaign';
import {
  areaTiles,
  beginBattle,
  buildingName,
  canDeployAt,
  canStabilize,
  canTarget,
  canThrow,
  colonistMoveOpts,
  deploy,
  endTurn,
  fire,
  liveCreatures,
  moveRange,
  moveUnit,
  overwatch,
  shotBreakdown,
  stabilize,
  startBattle,
  throwArea,
  unitStats,
  type BattleEvent,
} from '../sim/combat';
import { ADAPTATIONS, BUILDINGS, DAYS_BETWEEN, DROPPABLE, PARTS, PART_ORDER, ROLES, SCARS, SPECIES, WEAPONS } from '../sim/data';
import { CENTER, COLONY_RADIUS, adjacent, samePos, tileAt } from '../sim/map';
import { dissectionReport } from '../sim/mind';
import { canStand, pathTo, reach } from '../sim/path';
import type { AdaptationId, AttackSummary, BodyPart, BuildingKind, Campaign, RoleId, Vec, WeaponId } from '../sim/types';
import { Scene3D, type OverlaySpec } from '../render/scene';
import { drawPortrait } from './portrait';

type Mode = 'title' | 'deploy' | 'battle' | 'aftermath' | 'between' | 'ending';
type Aim = { kind: 'move' } | { kind: 'aim'; weapon: WeaponId } | { kind: 'throw'; weapon: WeaponId };

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
}

export class App {
  c!: Campaign;
  scene: Scene3D;
  mode: Mode = 'title';

  // Battle UI state.
  selected: string | null = null;
  aim: Aim = { kind: 'move' };
  target: string | null = null;
  targetWeapon: WeaponId | null = null;
  hoverPart: BodyPart = 'torso';
  hover: Vec | null = null;
  busy = false;
  /** Adaptations the player has learned about, from reports or seeing them in battle. */
  known = new Set<AdaptationId>();

  // Between-attack UI state.
  day = 0;
  plan: Record<string, Assignment> = {};
  picking: { colonistId: string; kind: 'build' | 'clear' } | null = null;
  dropping: BuildingKind | null = null;
  dayLines: string[] = [];
  lastSummary: AttackSummary | null = null;

  constructor(opts: { lowQuality?: boolean; instant?: boolean } = {}) {
    this.scene = new Scene3D($('viewport'), { lowQuality: opts.lowQuality });
    this.scene.instant = !!opts.instant;
    const canvas = this.scene.domElement;
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    canvas.addEventListener('click', (e) => this.onClick(e));
    canvas.addEventListener('pointerleave', () => {
      this.hover = null;
      $('tooltip').hidden = true;
      this.updateOverlay();
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
  }

  start(seed: number) {
    this.c = newCampaign(seed);
    this.known.clear();
    this.mode = 'title';
    this.scene.clearUnits();
    this.scene.buildTerrain(this.c);
    this.scene.focus({ x: 20, y: 22 });
    $('log-lines').innerHTML = '';
    this.renderAll();
    this.showTitle();
  }

  // ---------------------------------------------------------------- top-level flow

  showTitle() {
    this.modal(`
      <h1>FOOTHOLD</h1>
      <p class="muted">Prototype · seed ${this.c.seed}</p>
      <p>Four colonists. One landing site. A world that wants you gone.</p>
      <p>The world remembers how you killed it and changes in response. Your best tactic stops working <i>because</i> it worked.</p>
      <p class="muted">This prototype: one map, four colonists, three attacks, two species, and the world's adaptation working. Nothing resets between attacks.</p>
      <div class="keys">
        <kbd>Left click</kbd><span>Select, move, target</span>
        <kbd>Right drag · WASD</kbd><span>Pan</span>
        <kbd>Q / E</kbd><span>Rotate camera</span>
        <kbd>Wheel</kbd><span>Zoom</span>
        <kbd>Tab</kbd><span>Next colonist</span>
        <kbd>O</kbd><span>Overwatch</span>
        <kbd>1–4</kbd><span>Body part, when aiming</span>
        <kbd>Space</kbd><span>End turn</span>
        <kbd>Esc</kbd><span>Cancel</span>
      </div>
      <div class="actions"><button class="btn primary" data-act="begin">Land</button></div>
    `, { begin: () => this.enterDeploy() });
  }

  enterDeploy() {
    this.closeModal();
    startBattle(this.c);
    this.mode = 'deploy';
    this.selected = this.c.battle!.units[0]?.colonistId ?? null;
    this.aim = { kind: 'move' };
    this.scene.sync(this.c);
    const b = this.c.battle!;
    this.logRule(`Attack ${b.attack} of ${this.c.totalAttacks}`);
    const what = b.intent.kind === 'building' ? buildingName(this.c, b.intent.buildingId) : 'the colonists';
    this.log(`Something is coming for ${what}. ${b.intent.reason}`, 'world');
    this.log('Everyone is on the map. Choose where each of them stands.', 'neutral');
    this.renderAll();
  }

  async beginAttack() {
    if (this.mode !== 'deploy') return;
    this.mode = 'battle';
    const ev = beginBattle(this.c);
    await this.run(ev);
  }

  async run(events: BattleEvent[] | null) {
    if (!events) return;
    this.busy = true;
    this.target = null;
    this.renderAll();
    await this.scene.play(this.c, events, (e) => {
      if (e.t === 'log') this.log(e.text, e.tone ?? 'neutral');
      if (e.t === 'phase') {
        if (e.phase === 'enemy') this.logRule(`Turn ${e.turn} · the world moves`);
        else this.logRule(`Turn ${e.turn}`);
      }
      this.scene.refreshLabels(this.c);
      this.renderRoster();
      this.renderTopbar();
    });
    for (const id of this.c.battle?.noticed ?? []) this.known.add(id);
    this.busy = false;
    const b = this.c.battle!;
    if (b.phase === 'over') {
      this.showAftermath();
      return;
    }
    const sel = this.selected ? b.units.find((u) => u.colonistId === this.selected) : null;
    if (!sel || sel.downed || sel.actions === 0) this.selectNext();
    this.aim = { kind: 'move' };
    this.renderAll();
  }

  showAftermath() {
    this.mode = 'aftermath';
    this.selected = null;
    const s = concludeAttack(this.c);
    this.lastSummary = s;
    this.scene.buildTerrain(this.c);
    const name = (id: string) => this.c.colonists.find((x) => x.id === id)!.name;
    const intentText = s.intent.kind === 'building' ? buildingName(this.c, s.intent.buildingId) : 'the colonists';
    const headline = {
      held: 'The colony held.',
      withdrew: 'They pulled back.',
      intent_reached: `They reached ${intentText}.`,
      fallen: 'The colony fell.',
    }[s.outcome];
    const rows: string[] = [];
    rows.push(`<tr><td>Came for</td><td>${esc(intentText)}</td></tr>`);
    rows.push(`<tr><td>Killed</td><td>${s.kills} of ${s.creatures}</td></tr>`);
    for (const sc of s.newScars) {
      const col = this.c.colonists.find((x) => x.id === sc.colonistId)!;
      const extra = col.retired ? ' The same wound twice. They will not fight again.' : '';
      rows.push(`<tr><td>${esc(name(sc.colonistId))}</td><td>Downed. Survived with a scar: <b>${SCARS[sc.scar].name}</b> (${SCARS[sc.scar].effect}).${extra}</td></tr>`);
    }
    for (const id of s.died) rows.push(`<tr><td>${esc(name(id))}</td><td>Dead.</td></tr>`);
    if (this.c.lastGrowth) rows.push(`<tr><td>The world</td><td>Thorn spread across ${this.c.lastGrowth} more tiles while you buried the dead.</td></tr>`);
    const over = campaignOver(this.c);
    this.modal(`
      <h2>${headline}</h2>
      <table>${rows.join('')}</table>
      <div class="actions"><button class="btn primary" data-act="next">${over ? 'Continue' : 'The days after'}</button></div>
    `, { next: () => (over ? this.showEnding() : this.enterBetween()) });
    this.renderAll();
  }

  enterBetween() {
    this.closeModal();
    this.mode = 'between';
    this.day = 0;
    this.dayLines = [];
    this.plan = {};
    const lab = this.c.buildings.find((b) => b.kind === 'lab' && !b.destroyed);
    for (const col of this.c.colonists) {
      if (col.status !== 'active') continue;
      // Default: the xenobiologist goes to the lab if there is one; everyone else rests.
      this.plan[col.id] = lab && col.role === 'xenobiologist' ? { kind: 'staff', buildingId: lab.id } : { kind: 'rest' };
    }
    this.scene.clearUnits();
    this.logRule('Between attacks');
    this.renderAll();
  }

  endDay(confirmed = false) {
    const idle = Object.entries(this.plan)
      .filter(([, a]) => (a.kind === 'build' || a.kind === 'clear') && a.tiles.length === 0)
      .map(([id]) => this.c.colonists.find((x) => x.id === id)!.name.split(' ')[0]);
    if (idle.length && !confirmed) {
      this.modal(`
        <h2>Nothing chosen</h2>
        <p>${esc(idle.join(' and '))} ${idle.length > 1 ? 'have' : 'has'} no tiles chosen and will waste the day.</p>
        <div class="actions"><button class="btn" data-act="back">Choose tiles</button><button class="btn primary" data-act="go">End the day anyway</button></div>
      `, { back: () => this.closeModal(), go: () => { this.closeModal(); this.endDay(true); } });
      return;
    }
    const res = runDay(this.c, this.plan);
    this.day += 1;
    this.dayLines.push(`Day ${this.day}`, ...res.lines);
    this.log(`Day ${this.day}.`, 'neutral');
    for (const l of res.lines) this.log(l, 'colony');
    for (const [id, a] of Object.entries(this.plan)) {
      if (a.kind === 'build' || a.kind === 'clear') this.plan[id] = { ...a, tiles: [] };
    }
    for (const col of this.c.colonists) if (col.status === 'active' && !this.plan[col.id]) this.plan[col.id] = { kind: 'rest' };
    this.picking = null;
    this.dropping = null;
    this.scene.buildTerrain(this.c);
    this.renderAll();
  }

  awaitAttack() {
    advanceToNextAttack(this.c);
    this.picking = null;
    this.dropping = null;
    this.enterDeploy();
  }

  showEnding() {
    this.mode = 'ending';
    this.scene.clearUnits();
    const result = campaignOver(this.c);
    const rows = this.c.colonists.map((col) => {
      const died = this.c.history.find((h) => h.died.includes(col.id));
      const fate = col.status === 'dead' ? `Died in attack ${died?.attack ?? '?'}.` : col.retired ? 'Lived. Will not fight again.' : 'Lived.';
      const scars = col.scars.map((s) => SCARS[s].name).join(', ');
      return `<tr><td>${esc(col.name)}</td><td>${ROLES[col.role].name}. ${fate}${scars ? ` Scars: ${scars}.` : ''}</td></tr>`;
    });
    const standing = this.c.buildings.filter((b) => !b.destroyed).map((b) => BUILDINGS[b.kind].name);
    const lost = this.c.buildings.filter((b) => b.destroyed).map((b) => BUILDINGS[b.kind].name);
    const changes = this.c.adaptations.map((a) => ADAPTATIONS.find((d) => d.id === a.id)!.name);
    const quiet = result === 'won' ? 'Earth\'s ship is still on its way. The world is still here.' : 'No one is left. The growth closes over the landing site.';
    this.modal(`
      <h2>${result === 'won' ? 'Three attacks.' : 'The colony fell.'}</h2>
      <table>${rows.join('')}
        <tr><td>Standing</td><td>${standing.join(', ') || 'Nothing.'}</td></tr>
        <tr><td>Lost</td><td>${lost.join(', ') || 'Nothing.'}</td></tr>
        <tr><td>What it became</td><td>${changes.join(', ') || 'Unchanged.'}</td></tr>
      </table>
      <p class="quiet">${quiet}</p>
      <div class="actions"><button class="btn" data-act="again">Land again</button></div>
    `, { again: () => this.start((this.c.seed * 7 + 13) % 100000) });
    this.renderAll();
  }

  // ---------------------------------------------------------------- input

  private onKey(e: KeyboardEvent) {
    if ((e.target as HTMLElement)?.tagName === 'SELECT') return;
    const k = e.key.toLowerCase();
    if (k === 'escape') {
      this.target = null;
      this.aim = { kind: 'move' };
      this.picking = null;
      this.dropping = null;
      this.renderAll();
      return;
    }
    if (this.mode !== 'battle' || this.busy) return;
    if (k === 'tab') {
      e.preventDefault();
      this.selectNext(true);
      this.renderAll();
    } else if (k === ' ' || k === 'enter') {
      e.preventDefault();
      void this.run(endTurn(this.c));
    } else if (k === 'o' && this.selected) {
      void this.run(overwatch(this.c, this.selected));
    } else if (['1', '2', '3', '4'].includes(k) && this.target && this.targetWeapon && this.selected) {
      const part = PART_ORDER[Number(k) - 1];
      void this.run(fire(this.c, this.selected, this.targetWeapon, this.target, part));
    } else if (k === 'f') {
      this.scene.speed = this.scene.speed === 1 ? 2.5 : 1;
      this.renderTopbar();
    }
  }

  private onPointerMove(e: PointerEvent) {
    const t = this.scene.pickTile(e.clientX, e.clientY);
    const changed = !this.hover || !t || !samePos(this.hover, t);
    this.hover = t;
    if (changed) this.updateOverlay();
    this.updateTooltip(e.clientX, e.clientY);
  }

  private onClick(e: MouseEvent) {
    const t = this.scene.pickTile(e.clientX, e.clientY);
    if (!t || this.busy) return;
    if (this.mode === 'deploy') return this.clickDeploy(t);
    if (this.mode === 'battle') return this.clickBattle(t);
    if (this.mode === 'between') return this.clickBetween(t);
  }

  private clickDeploy(t: Vec) {
    const b = this.c.battle!;
    const who = b.units.find((u) => samePos(u.pos, t));
    if (who) {
      this.selected = who.colonistId;
    } else if (this.selected && deploy(this.c, this.selected, t)) {
      this.scene.sync(this.c);
      // Move on to the next colonist for quick placement.
      const i = b.units.findIndex((u) => u.colonistId === this.selected);
      this.selected = b.units[(i + 1) % b.units.length].colonistId;
    }
    this.renderAll();
  }

  private clickBattle(t: Vec) {
    const b = this.c.battle!;
    if (b.phase !== 'player') return;
    const unit = b.units.find((u) => samePos(u.pos, t));
    const creature = liveCreatures(b).find((k) => samePos(k.pos, t) && !k.burrowed);

    if (this.aim.kind === 'throw' && this.selected) {
      if (canThrow(this.c, this.selected, this.aim.weapon, t)) void this.run(throwArea(this.c, this.selected, this.aim.weapon, t));
      else this.toast('Out of range or out of sight.');
      return;
    }
    if (creature && this.selected) {
      const u = b.units.find((x) => x.colonistId === this.selected)!;
      if (u.actions < 1) return this.toast('No actions left.');
      const weapons = this.weaponsFor(creature.id);
      if (!weapons.length) return this.toast('No shot: out of range or out of sight.');
      this.target = creature.id;
      this.targetWeapon = this.aim.kind === 'aim' && weapons.includes(this.aim.weapon) ? this.aim.weapon : weapons[0];
      this.renderAll();
      return;
    }
    if (unit) {
      if (this.selected && unit.downed && canStabilize(this.c, this.selected, unit.colonistId)) {
        void this.run(stabilize(this.c, this.selected, unit.colonistId));
        return;
      }
      this.selected = unit.colonistId;
      this.target = null;
      this.aim = { kind: 'move' };
      this.renderAll();
      return;
    }
    if (this.selected && this.aim.kind === 'move') {
      this.target = null;
      void this.run(moveUnit(this.c, this.selected, t));
    }
  }

  private clickBetween(t: Vec) {
    if (this.dropping) {
      const kind = this.dropping;
      if (!canDrop(this.c, kind, t)) return this.toast('It cannot go there: it must sit on clear, level ground inside the colony.');
      const name = BUILDINGS[kind].name;
      this.modal(`
        <h2>Drop the ${esc(name.toLowerCase())} here?</h2>
        <p>Dropping is irreversible. It stays where it lands for the rest of the campaign, and the world will notice something new.</p>
        <p class="muted">Costs ${BUILDINGS[kind].cost} stores.</p>
        <div class="actions"><button class="btn" data-act="no">Not yet</button><button class="btn primary" data-act="yes">Drop it</button></div>
      `, {
        yes: () => {
          dropBuilding(this.c, kind, t);
          this.dropping = null;
          this.scene.buildTerrain(this.c);
          this.log(`The ${name.toLowerCase()} comes down from orbit.`, 'colony');
          this.closeModal();
          this.renderAll();
        },
        no: () => this.closeModal(),
      });
      return;
    }
    if (this.picking) {
      const a = this.plan[this.picking.colonistId];
      if (!a || (a.kind !== 'build' && a.kind !== 'clear')) return;
      const col = this.c.colonists.find((x) => x.id === this.picking!.colonistId)!;
      const limit = a.kind === 'build' ? buildRate(col) : buildRate(col) + 1;
      const i = a.tiles.findIndex((p) => samePos(p, t));
      if (i >= 0) a.tiles.splice(i, 1);
      else {
        if (this.allMarks().some((p) => samePos(p, t))) return this.toast('Someone is already working there today.');
        const why = a.kind === 'build' ? buildBlocked(this.c, t, a.wall) : tileAt(this.c.map, t.x, t.y).growth ? null : 'No growth there.';
        if (why) return this.toast(why);
        if (a.tiles.length >= limit) a.tiles.shift();
        a.tiles.push({ ...t });
      }
      this.renderAll();
    }
  }

  // ---------------------------------------------------------------- helpers

  private weaponsFor(creatureId: string): WeaponId[] {
    if (!this.selected) return [];
    const st = unitStats(this.c.colonists.find((x) => x.id === this.selected)!);
    return st.weapons.filter((w) => !WEAPONS[w].area && canTarget(this.c, this.selected!, w, creatureId));
  }

  private selectNext(cycle = false) {
    const b = this.c.battle;
    if (!b) return;
    const ready = b.units.filter((u) => !u.downed && u.actions > 0);
    if (!ready.length) {
      this.selected = this.selected && b.units.some((u) => u.colonistId === this.selected) ? this.selected : b.units[0]?.colonistId ?? null;
      return;
    }
    const i = ready.findIndex((u) => u.colonistId === this.selected);
    this.selected = cycle || i < 0 ? ready[(i + 1) % ready.length].colonistId : ready[i].colonistId;
    this.target = null;
    const u = b.units.find((x) => x.colonistId === this.selected);
    if (u && cycle) this.scene.focus(u.pos);
  }

  private allMarks(): Vec[] {
    const out: Vec[] = [];
    for (const a of Object.values(this.plan)) if (a.kind === 'build' || a.kind === 'clear') out.push(...a.tiles);
    return out;
  }

  private toast(text: string) {
    const el = $('toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout((el as unknown as { _t: number })._t);
    (el as unknown as { _t: number })._t = window.setTimeout(() => (el.hidden = true), 2200);
  }

  private log(text: string, tone: string) {
    const el = document.createElement('div');
    el.className = tone;
    el.textContent = text;
    const box = $('log-lines');
    box.appendChild(el);
    box.scrollTop = box.scrollHeight;
  }

  private logRule(text: string) {
    const el = document.createElement('div');
    el.className = 'rule';
    el.textContent = text;
    $('log-lines').appendChild(el);
  }

  private modal(html: string, actions: Record<string, () => void>) {
    const m = $('modal');
    m.innerHTML = `<div class="mbox">${html}</div>`;
    m.hidden = false;
    m.querySelectorAll<HTMLButtonElement>('[data-act]').forEach((b) => (b.onclick = () => actions[b.dataset.act!]?.()));
  }

  private closeModal() {
    $('modal').hidden = true;
  }

  // ---------------------------------------------------------------- rendering

  renderAll() {
    this.renderTopbar();
    this.renderRoster();
    this.renderActionbar();
    this.renderTargetPanel();
    this.renderPanel();
    this.updateOverlay();
  }

  private renderTopbar() {
    const c = this.c;
    const parts: string[] = ['<span class="title">FOOTHOLD</span>'];
    const b = c.battle;
    parts.push(`<span class="item">Attack <b>${Math.min(c.attack, c.totalAttacks)}</b> of ${c.totalAttacks}</span>`);
    if ((this.mode === 'battle' || this.mode === 'deploy') && b) {
      if (this.mode === 'battle') parts.push(`<span class="item">Turn <b>${b.turn}</b> · ${b.phase === 'enemy' ? 'the world moves' : 'your move'}</span>`);
      const what = b.intent.kind === 'building' ? buildingName(c, b.intent.buildingId) : 'the colonists';
      const bld = b.intent.kind === 'building' ? c.buildings.find((x) => x.id === (b.intent as { buildingId: string }).buildingId) : null;
      parts.push(`<span class="item intent">Coming for <b>${esc(what)}</b>${bld ? ` (${bld.hp}/${bld.maxHp})` : ''}</span>`);
      if (this.mode === 'battle') {
        const left = b.creatures.filter((k) => k.alive).length;
        parts.push(`<span class="item">Creatures left <b>${left}</b></span>`);
      }
    }
    parts.push(`<span class="item">Stores <b>${c.stores}</b> · Salvage <b>${c.salvage}</b></span>`);
    parts.push('<span class="spacer"></span>');
    if (this.mode === 'battle') parts.push(`<button id="speed">Speed ${this.scene.speed === 1 ? '1×' : '2.5×'} (F)</button>`);
    $('topbar').innerHTML = parts.join('');
    const sp = document.getElementById('speed');
    if (sp) sp.onclick = () => {
      this.scene.speed = this.scene.speed === 1 ? 2.5 : 1;
      this.renderTopbar();
    };
  }

  private renderRoster() {
    const c = this.c;
    const root = $('roster');
    root.innerHTML = '';
    if (this.mode === 'title') return;
    for (const col of c.colonists) {
      const u = c.battle?.units.find((x) => x.colonistId === col.id);
      const card = document.createElement('div');
      const downed = u?.downed && (this.mode === 'battle' || this.mode === 'deploy');
      card.className = `card${this.selected === col.id ? ' selected' : ''}${col.status === 'dead' ? ' dead' : ''}${downed ? ' downed' : ''}`;
      const canvas = document.createElement('canvas');
      drawPortrait(canvas, col);
      const info = document.createElement('div');
      const role = col.retired ? `${ROLES[col.role].name} · cannot fight` : ROLES[col.role].name;
      const status = col.status === 'dead' ? 'Dead' : downed ? (u!.stabilized ? 'Down · stable' : `Down · bleeding (${u!.bleed})`) : role;
      const ap = this.mode === 'battle' && u && !u.downed ? `<div class="ap">${[0, 1].map((i) => `<i class="${i < u.actions ? 'on' : ''}"></i>`).join('')}${u.overwatch ? '<span class="chip">overwatch</span>' : ''}</div>` : '';
      const scars = col.scars.map((s) => `<span class="chip scar" title="${esc(SCARS[s].effect)}">${SCARS[s].name}</span>`).join('');
      const training = col.training ? `<span class="chip">training: ${ROLES[col.training.role].name}</span>` : '';
      info.innerHTML = `<div class="name">${esc(col.name)}</div><div class="role">${esc(status)} · ${col.hp}/${col.maxHp}</div>
        <div class="hp"><div style="width:${(100 * col.hp) / col.maxHp}%"></div></div>${ap}<div class="chips">${scars}${training}</div>`;
      card.append(canvas, info);
      card.onclick = () => {
        if (col.status === 'dead' || !(this.mode === 'battle' || this.mode === 'deploy')) return;
        this.selected = col.id;
        this.target = null;
        this.aim = { kind: 'move' };
        if (u) this.scene.focus(u.pos);
        this.renderAll();
      };
      root.appendChild(card);
    }
  }

  private renderActionbar() {
    const bar = $('actionbar');
    bar.innerHTML = '';
    const btn = (label: string, sub: string, onClick: () => void, opts: { disabled?: boolean; active?: boolean; cls?: string } = {}) => {
      const b = document.createElement('button');
      b.className = `btn${opts.active ? ' active' : ''}${opts.cls ? ` ${opts.cls}` : ''}`;
      b.innerHTML = `<span>${label}</span><small>${sub}</small>`;
      b.disabled = !!opts.disabled;
      b.onclick = onClick;
      bar.appendChild(b);
    };
    if (this.mode === 'deploy') {
      btn('Begin the attack', 'positions are final', () => void this.beginAttack(), { cls: 'primary' });
      return;
    }
    if (this.mode !== 'battle') return;
    const b = this.c.battle!;
    const u = this.selected ? b.units.find((x) => x.colonistId === this.selected) : null;
    const idle = this.busy || b.phase !== 'player';
    if (u && !u.downed) {
      const col = this.c.colonists.find((x) => x.id === u.colonistId)!;
      const st = unitStats(col);
      for (const w of st.weapons) {
        const def = WEAPONS[w];
        const charges = u.charges[w];
        const sub = def.area ? `${charges ?? 0} left · no roll` : def.melee ? 'adjacent' : `range ${def.range}`;
        const active = (this.aim.kind === 'aim' || this.aim.kind === 'throw') && this.aim.weapon === w;
        btn(def.name, `${def.category} · ${sub}`, () => {
          this.target = null;
          this.aim = active ? { kind: 'move' } : def.area ? { kind: 'throw', weapon: w } : { kind: 'aim', weapon: w };
          this.renderAll();
        }, { disabled: idle || u.actions < 1 || (def.area && (charges ?? 0) <= 0), active });
      }
      btn('Overwatch', 'O · −15 aim', () => void this.run(overwatch(this.c, u.colonistId)), { disabled: idle || u.actions < 1 || st.weapons.every((w) => WEAPONS[w].area || WEAPONS[w].melee) });
      const hurt = b.units.find((x) => x.downed && canStabilize(this.c, u.colonistId, x.colonistId));
      if (hurt) btn('Stabilise', this.c.colonists.find((x) => x.id === hurt.colonistId)!.name.split(' ')[0], () => void this.run(stabilize(this.c, u.colonistId, hurt.colonistId)), { disabled: idle });
    }
    btn('End turn', 'Space', () => void this.run(endTurn(this.c)), { disabled: idle, cls: 'end' });
  }

  private renderTargetPanel() {
    const p = $('targetpanel');
    if (this.mode !== 'battle' || !this.target || !this.selected || !this.targetWeapon || this.busy) {
      p.hidden = true;
      return;
    }
    const b = this.c.battle!;
    const k = b.creatures.find((x) => x.id === this.target);
    if (!k || !k.alive) {
      p.hidden = true;
      return;
    }
    const weapons = this.weaponsFor(k.id);
    if (!weapons.includes(this.targetWeapon)) this.targetWeapon = weapons[0] ?? null;
    if (!this.targetWeapon) {
      p.hidden = true;
      return;
    }
    const w = this.targetWeapon;
    const sp = SPECIES[k.species];
    const flags = [k.slowed ? 'slowed' : '', k.blinded > 0 ? 'blind' : '', k.burning ? 'burning' : ''].filter(Boolean).join(', ');
    const parts = PART_ORDER.map((part, i) => {
      const bd = shotBreakdown(this.c, this.selected!, w, k.id, part);
      const dmg = bd.damage >= 99 ? 'kills' : `${bd.damage} dmg`;
      return `<button class="part" data-part="${part}"><kbd>${i + 1}</kbd><div class="pname">${PARTS[part].name}</div><div class="pct">${bd.chance}%</div><div class="eff">${dmg}${bd.effect && bd.effect !== 'kills' ? ` · ${bd.effect}` : ''}</div></button>`;
    }).join('');
    const bd = shotBreakdown(this.c, this.selected, w, k.id, this.hoverPart);
    const brk = bd.parts.map((x) => `<span class="${x.value < 0 ? 'neg' : x.value > 0 && x.label !== 'Aim' ? 'pos' : ''}">${esc(x.label)} ${x.value > 0 && x.label !== 'Aim' ? '+' : ''}${x.value}</span>`).join('');
    p.innerHTML = `
      <h3>${sp.name} · ${k.hp}/${k.maxHp}${flags ? ` · ${flags}` : ''}</h3>
      <div class="sub">Choose where to aim. The number is the chance. The roll is honest.</div>
      <div class="weapons">${weapons.map((x) => `<button data-w="${x}" class="${x === w ? 'active' : ''}">${WEAPONS[x].name} <span class="muted">(${WEAPONS[x].category})</span></button>`).join('')}</div>
      <div class="parts">${parts}</div>
      <div class="breakdown">${PARTS[this.hoverPart].name}: ${brk} = <b>${bd.chance}%</b></div>`;
    p.hidden = false;
    p.querySelectorAll<HTMLButtonElement>('[data-w]').forEach((el) => (el.onclick = () => {
      this.targetWeapon = el.dataset.w as WeaponId;
      this.renderTargetPanel();
    }));
    p.querySelectorAll<HTMLButtonElement>('[data-part]').forEach((el) => {
      el.onmouseenter = () => {
        this.hoverPart = el.dataset.part as BodyPart;
        const bd2 = shotBreakdown(this.c, this.selected!, w, k.id, this.hoverPart);
        p.querySelector('.breakdown')!.innerHTML = `${PARTS[this.hoverPart].name}: ${bd2.parts.map((x) => `<span class="${x.value < 0 ? 'neg' : x.value > 0 && x.label !== 'Aim' ? 'pos' : ''}">${esc(x.label)} ${x.value > 0 && x.label !== 'Aim' ? '+' : ''}${x.value}</span>`).join('')} = <b>${bd2.chance}%</b>`;
      };
      el.onclick = () => void this.run(fire(this.c, this.selected!, w, k.id, el.dataset.part as BodyPart));
    });
  }

  private renderPanel() {
    const p = $('panel');
    $('log').style.display = this.mode === 'between' ? 'none' : '';
    if (this.mode !== 'between') {
      p.hidden = true;
      return;
    }
    p.hidden = false;
    const c = this.c;
    const last = c.history[c.history.length - 1];
    const lab = c.buildings.find((b) => b.kind === 'lab');
    const xeno = c.colonists.find((x) => x.role === 'xenobiologist' && x.status === 'active');
    let report: string;
    if (c.reportReady && last) {
      const lines = dissectionReport(c.kills.filter((k) => k.attack === last.attack), last.adaptation);
      if (last.adaptation) this.known.add(last.adaptation.id);
      report = `<div class="report">${lines.map((l) => `<p>${esc(l)}</p>`).join('')}<p class="muted">— ${esc(xeno?.name ?? 'the lab')}</p></div>`;
    } else if (!lab || lab.destroyed) {
      report = `<div class="report none">There is no xeno lab. Whatever they are becoming, you will find out when they come.</div>`;
    } else if (!xeno) {
      report = `<div class="report none">No one left can read the bodies.</div>`;
    } else {
      report = `<div class="report none">The bodies are in the lab. Staff it with ${esc(xeno.name.split(' ')[0])} to read them.</div>`;
    }

    const rows = c.colonists.filter((x) => x.status === 'active').map((col) => {
      const a = this.plan[col.id] ?? { kind: 'rest' };
      const opts = this.assignmentOptions(col.id).map((o) => `<option value="${o.value}" ${o.value === this.assignmentValue(a) ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
      const needsTiles = a.kind === 'build' || a.kind === 'clear';
      const limit = a.kind === 'build' ? buildRate(col) : buildRate(col) + 1;
      const picking = this.picking?.colonistId === col.id;
      const pick = needsTiles ? `<button class="pick${picking ? ' active' : ''}" data-pick="${col.id}">${picking ? 'Click tiles on the map…' : 'Choose tiles'} (${(a as { tiles: Vec[] }).tiles.length}/${limit})</button>` : '';
      const scars = col.scars.map((s) => SCARS[s].name).join(', ');
      return `<div class="assign"><div class="who"><b>${esc(col.name)}</b><span>${ROLES[col.role].name}${col.retired ? ' · cannot fight' : ''} · ${col.hp}/${col.maxHp}${scars ? ` · ${esc(scars)}` : ''}</span></div>
        <select data-col="${col.id}">${opts}</select>${pick}</div>`;
    }).join('');

    const drops = DROPPABLE.map((kind) => {
      const def = BUILDINGS[kind];
      const existing = c.buildings.find((b) => b.kind === kind);
      const status = existing ? (existing.destroyed ? 'Destroyed' : 'Dropped') : '';
      const active = this.dropping === kind;
      const btn = existing ? `<span class="muted">${status}</span>` : `<button data-drop="${kind}" class="${active ? 'active' : ''}" ${c.stores < def.cost ? 'disabled' : ''}>${active ? 'Place it…' : `Drop · ${def.cost} stores`}</button>`;
      return `<div class="drop${existing ? ' done' : ''}"><b>${def.name}</b>${btn}<div class="desc">${esc(def.gives)}${def.needs ? ` Needs a ${ROLES[def.needs].name.toLowerCase()}.` : ''}</div></div>`;
    }).join('');

    const done = this.day >= DAYS_BETWEEN;
    p.innerHTML = `
      <div class="phead"><h2>${done ? 'The days are spent' : `Day ${this.day + 1} of ${DAYS_BETWEEN}`}</h2>
        <div class="res"><span>Stores <b>${c.stores}</b></span><span>Salvage <b>${c.salvage}</b></span><span class="muted">Walls use salvage first.</span></div></div>
      <div class="pbody">
        <section><h4>Dissection</h4>${report}</section>
        ${done ? '' : `<section><h4>Assignments</h4>${rows}</section>`}
        <section><h4>In orbit</h4><div class="drops">${drops}</div></section>
        ${this.dayLines.length ? `<section><h4>So far</h4><div class="daylines">${this.dayLines.map((l) => `<p>${esc(l)}</p>`).join('')}</div></section>` : ''}
      </div>
      <div class="pfoot">${done ? '<button class="btn primary" data-act="await">Wait for them</button>' : '<button class="btn primary" data-act="day">End the day</button>'}</div>`;

    p.querySelectorAll<HTMLSelectElement>('select[data-col]').forEach((s) => (s.onchange = () => {
      this.plan[s.dataset.col!] = this.parseAssignment(s.value);
      const a = this.plan[s.dataset.col!];
      this.picking = a.kind === 'build' || a.kind === 'clear' ? { colonistId: s.dataset.col!, kind: a.kind } : null;
      this.dropping = null;
      this.renderAll();
    }));
    p.querySelectorAll<HTMLButtonElement>('[data-pick]').forEach((b) => (b.onclick = () => {
      const id = b.dataset.pick!;
      const a = this.plan[id];
      this.picking = this.picking?.colonistId === id ? null : { colonistId: id, kind: a.kind as 'build' | 'clear' };
      this.dropping = null;
      this.renderAll();
    }));
    p.querySelectorAll<HTMLButtonElement>('[data-drop]').forEach((b) => (b.onclick = () => {
      const kind = b.dataset.drop as BuildingKind;
      this.dropping = this.dropping === kind ? null : kind;
      this.picking = null;
      this.renderAll();
    }));
    const day = p.querySelector<HTMLButtonElement>('[data-act="day"]');
    if (day) day.onclick = () => this.endDay();

    const aw = p.querySelector<HTMLButtonElement>('[data-act="await"]');
    if (aw) aw.onclick = () => this.awaitAttack();
  }

  private assignmentOptions(colId: string): { value: string; label: string }[] {
    const c = this.c;
    const col = c.colonists.find((x) => x.id === colId)!;
    const infirmary = c.buildings.some((b) => b.kind === 'infirmary' && !b.destroyed);
    const workshop = c.buildings.some((b) => b.kind === 'workshop' && !b.destroyed);
    const rate = buildRate(col);
    const out = [
      { value: 'rest', label: `${ASSIGNMENT_LABEL.rest} (+2 health)` },
      { value: 'heal', label: infirmary ? 'Heal in the infirmary (full health)' : 'Heal (+2, no infirmary)' },
      { value: 'build:lowwall', label: `Build low walls (${rate}/day, 1 each)` },
    ];
    if (workshop) out.push({ value: 'build:wall', label: `Build full walls (${rate}/day, 2 each)` });
    out.push({ value: 'clear', label: `Clear growth (${rate + 1}/day)` });
    for (const b of c.buildings) {
      if (b.destroyed || b.kind === 'pod') continue;
      out.push({ value: `staff:${b.id}`, label: `Staff the ${BUILDINGS[b.kind].name.toLowerCase()}` });
    }
    for (const b of c.buildings) {
      if (b.destroyed || b.hp >= b.maxHp) continue;
      out.push({ value: `repair:${b.id}`, label: `Repair the ${BUILDINGS[b.kind].name.toLowerCase()} (${b.hp}/${b.maxHp})` });
    }
    if (canTrain(col)) {
      for (const r of Object.keys(ROLES) as RoleId[]) {
        if (r !== col.role) out.push({ value: `train:${r}`, label: `Train as ${ROLES[r].name.toLowerCase()} (2 days)` });
      }
    }
    return out;
  }

  private assignmentValue(a: Assignment): string {
    switch (a.kind) {
      case 'build': return `build:${a.wall}`;
      case 'staff': return `staff:${a.buildingId}`;
      case 'repair': return `repair:${a.buildingId}`;
      case 'train': return `train:${a.role}`;
      default: return a.kind;
    }
  }

  private parseAssignment(v: string): Assignment {
    const [k, arg] = v.split(':');
    switch (k) {
      case 'build': return { kind: 'build', wall: arg as 'lowwall' | 'wall', tiles: [] };
      case 'staff': return { kind: 'staff', buildingId: arg };
      case 'repair': return { kind: 'repair', buildingId: arg };
      case 'train': return { kind: 'train', role: arg as RoleId };
      case 'clear': return { kind: 'clear', tiles: [] };
      case 'heal': return { kind: 'heal' };
      default: return { kind: 'rest' };
    }
  }

  // ---------------------------------------------------------------- overlay + tooltip

  updateOverlay() {
    const c = this.c;
    if (!c) return;
    const o: OverlaySpec = { hover: this.hover };
    if (this.mode === 'deploy' && c.battle) {
      const zone: Vec[] = [];
      for (let y = CENTER.y - COLONY_RADIUS; y <= CENTER.y + COLONY_RADIUS; y++)
        for (let x = CENTER.x - COLONY_RADIUS; x <= CENTER.x + COLONY_RADIUS; x++) if (canStand(c.map, { x, y })) zone.push({ x, y });
      o.zone = zone;
      const u = c.battle.units.find((x) => x.colonistId === this.selected);
      o.selected = u?.pos ?? null;
      if (this.hover && canDeployAt(c, this.hover, this.selected ?? undefined)) o.cover = this.hover;
    }
    if (this.mode === 'battle' && c.battle && !this.busy && c.battle.phase === 'player') {
      const b = c.battle;
      const u = b.units.find((x) => x.colonistId === this.selected);
      if (u && !u.downed) {
        o.selected = u.pos;
        if (this.aim.kind === 'move' && u.actions > 0) {
          const r = moveRange(c, u.colonistId);
          o.walk = r.walk;
          o.dash = r.dash;
          const h = this.hover;
          if (h && (r.walk.some((p) => samePos(p, h)) || r.dash.some((p) => samePos(p, h)))) {
            const st = unitStats(c.colonists.find((x) => x.id === u.colonistId)!);
            const rr = reach(c.map, u.pos, st.mobility * 2, colonistMoveOpts(b));
            o.path = pathTo(rr, h);
            o.cover = h;
          }
          o.targets = liveCreatures(b).filter((k) => !k.burrowed && this.weaponsFor(k.id).length > 0).map((k) => k.pos);
        } else if (this.aim.kind === 'aim') {
          const w = this.aim.weapon;
          o.targets = liveCreatures(b).filter((k) => canTarget(c, u.colonistId, w, k.id)).map((k) => k.pos);
        } else if (this.aim.kind === 'throw' && this.hover) {
          o.area = areaTiles(c, this.hover, WEAPONS[this.aim.weapon].radius);
          o.areaValid = canThrow(c, u.colonistId, this.aim.weapon, this.hover);
        }
      }
      if (this.target) {
        const k = b.creatures.find((x) => x.id === this.target);
        if (k) o.targets = [k.pos];
      }
    }
    if (this.mode === 'between') {
      o.marks = this.allMarks();
      if (this.dropping && this.hover) {
        const size = BUILDINGS[this.dropping].size;
        const tiles: Vec[] = [];
        for (let y = this.hover.y; y < this.hover.y + size; y++) for (let x = this.hover.x; x < this.hover.x + size; x++) tiles.push({ x, y });
        o.footprint = { tiles, valid: canDrop(c, this.dropping, this.hover) };
      }
      if (this.picking || this.dropping) {
        const zone: Vec[] = [];
        for (let y = CENTER.y - COLONY_RADIUS; y <= CENTER.y + COLONY_RADIUS; y++)
          for (let x = CENTER.x - COLONY_RADIUS; x <= CENTER.x + COLONY_RADIUS; x++) zone.push({ x, y });
        o.zone = zone;
      }
    }
    this.scene.setOverlay(c, o);
  }

  private updateTooltip(x: number, y: number) {
    const tip = $('tooltip');
    const h = this.hover;
    const c = this.c;
    if (!h || !c || this.mode === 'title') {
      tip.hidden = true;
      return;
    }
    let html = '';
    const b = c.battle;
    const k = b && (this.mode === 'battle') ? liveCreatures(b).find((q) => samePos(q.pos, h)) : null;
    if (k) {
      const sp = SPECIES[k.species];
      const known = [...this.known].map((id) => ADAPTATIONS.find((a) => a.id === id)!);
      html = k.burrowed
        ? `<b class="world">Something underground</b><span class="muted">It cannot be shot until it surfaces.</span>`
        : `<b class="world">${sp.name} · ${k.hp}/${k.maxHp}</b><div class="muted">${esc(sp.blurb)}</div>` +
          (known.length ? `<div>What you know it has become:</div>${known.map((a) => `<div class="world">${a.name}: ${esc(a.effect)}</div>`).join('')}` : '');
    } else {
      const t = tileAt(c.map, h.x, h.y);
      const bits: string[] = [];
      if (t.buildingId) {
        const bld = c.buildings.find((q) => q.id === t.buildingId)!;
        bits.push(`<b>${BUILDINGS[bld.kind].name} · ${bld.hp}/${bld.maxHp}</b><div class="muted">${esc(BUILDINGS[bld.kind].gives)}</div>`);
      }
      if (t.structure) bits.push(`<b>${t.structure.kind === 'wall' ? 'Wall · full cover' : 'Low wall · half cover, vaultable'}</b>${t.structure.overgrowth >= 2 ? '<div class="world">Overgrown: one level less cover.</div>' : t.structure.overgrowth ? '<div class="world">Growth is reaching it.</div>' : ''}`);
      if (t.growth) bits.push('<b class="world">Thorn mat</b><div class="muted">Half cover. Blocks sight. Slows colonists, not creatures.</div>');
      if (t.burned) bits.push('<div class="muted">Burned ground. Nothing will grow here.</div>');
      if (t.rubble) bits.push('<div class="muted">Rubble · half cover.</div>');
      if (t.base === 'tree') bits.push('<b>Tree</b><div class="muted">Half cover. Blocks movement.</div>');
      if (t.base === 'rock') bits.push('<b>Rock</b><div class="muted">Full cover. Blocks sight.</div>');
      if (t.elevation) bits.push(`<div class="muted">Height ${t.elevation}: +10 aim on shots downhill, and targets below lose a level of cover.</div>`);
      const u = b?.units.find((q) => samePos(q.pos, h));
      if (u && (this.mode === 'battle' || this.mode === 'deploy')) {
        const col = c.colonists.find((q) => q.id === u.colonistId)!;
        bits.unshift(`<b>${esc(col.name)}</b><div class="muted">${ROLES[col.role].name} · ${col.hp}/${col.maxHp}</div>`);
      }
      html = bits.join('');
      if (this.mode === 'battle' && this.selected && b && !k) {
        const u2 = b.units.find((q) => q.colonistId === this.selected);
        if (u2 && adjacent(u2.pos, h)) {
          const down = b.units.find((q) => samePos(q.pos, h) && q.downed);
          if (down) html += '<div>Click to stabilise.</div>';
        }
      }
    }
    if (!html) {
      tip.hidden = true;
      return;
    }
    tip.innerHTML = html;
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.left = `${Math.min(window.innerWidth - r.width - 8, x + 16)}px`;
    tip.style.top = `${Math.min(window.innerHeight - r.height - 8, y + 16)}px`;
  }
}
