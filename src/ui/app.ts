import {
  JOB_LABEL,
  buildBlocked,
  buildPointsLeft,
  buildPointsTotal,
  campaignOver,
  canDrop,
  canTrain,
  clearGrowth,
  concludeAttack,
  dropBuilding,
  finishBuildPhase,
  material,
  newCampaign,
  placeWall,
  repairBuilding,
  reportAvailable,
  setJob,
  undoAt,
  undoLast,
  workshopStaffed,
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
  nextWave,
  overwatch,
  shotBreakdown,
  stabilize,
  startBattle,
  throwArea,
  unitStats,
  waveSchedule,
  type BattleEvent,
} from '../sim/combat';
import { ADAPTATIONS, BUILDINGS, COSTS, DROPPABLE, PARTS, PART_ORDER, REPAIR_HP, ROLES, SCARS, SPECIES, WEAPONS } from '../sim/data';
import { CENTER, COLONY_RADIUS, adjacent, inColony, samePos, tileAt } from '../sim/map';
import { chooseIntent, dissectionReport } from '../sim/mind';
import { canStand, pathTo, reach } from '../sim/path';
import type { AdaptationId, AttackSummary, BodyPart, BuildingKind, Campaign, Job, RoleId, Vec, WeaponId } from '../sim/types';
import { Scene3D, type OverlaySpec } from '../render/scene';
import { icon } from './icons';
import { drawPortrait } from './portrait';

type Mode = 'title' | 'build' | 'deploy' | 'battle' | 'aftermath' | 'ending';
type Aim = { kind: 'move' } | { kind: 'aim'; weapon: WeaponId } | { kind: 'throw'; weapon: WeaponId };
type Tool = 'lowwall' | 'wall' | 'clear' | 'repair' | `drop:${BuildingKind}`;

const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T;

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[ch]!);
}

const ZONE = { x0: CENTER.x - COLONY_RADIUS, y0: CENTER.y - COLONY_RADIUS, x1: CENTER.x + COLONY_RADIUS, y1: CENTER.y + COLONY_RADIUS };

export class App {
  c!: Campaign;
  scene: Scene3D;
  mode: Mode = 'title';

  // Battle state.
  selected: string | null = null;
  aim: Aim = { kind: 'move' };
  target: string | null = null;
  targetWeapon: WeaponId | null = null;
  hoverPart: BodyPart = 'torso';
  hover: Vec | null = null;
  busy = false;
  /** Adaptations the player has learned about, from reports or from seeing them in battle. */
  known = new Set<AdaptationId>();

  // Build state.
  tool: Tool | null = null;
  painting: 'add' | 'remove' | null = null;
  lastPainted: string | null = null;

  lastSummary: AttackSummary | null = null;
  logOpen = false;

  constructor(opts: { lowQuality?: boolean; instant?: boolean } = {}) {
    this.scene = new Scene3D($('viewport'), { lowQuality: opts.lowQuality });
    this.scene.instant = !!opts.instant;
    const canvas = this.scene.domElement;
    canvas.addEventListener('pointermove', (e) => this.onPointerMove(e));
    canvas.addEventListener('pointerdown', (e) => this.onPointerDown(e));
    window.addEventListener('pointerup', () => {
      this.painting = null;
      this.lastPainted = null;
    });
    canvas.addEventListener('click', (e) => this.onClick(e));
    canvas.addEventListener('pointerleave', () => {
      this.hover = null;
      $('tooltip').hidden = true;
      this.updateOverlay();
    });
    window.addEventListener('keydown', (e) => this.onKey(e));
    $('logbtn').innerHTML = icon('log', 18);
    $('logbtn').onclick = () => this.toggleLog();
  }

  start(seed: number) {
    this.c = newCampaign(seed);
    this.known.clear();
    this.mode = 'title';
    this.tool = null;
    this.scene.clearUnits();
    this.scene.buildTerrain(this.c);
    this.scene.focus({ x: 24, y: 26 });
    $('log-lines').innerHTML = '';
    $('feed').innerHTML = '';
    this.renderAll();
    this.showTitle();
  }

  // ---------------------------------------------------------------- flow

  showTitle() {
    this.modal(`
      <div class="kicker">Prototype · seed ${this.c.seed}</div>
      <h1>FOOTHOLD</h1>
      <p>Four colonists, a habitat module, a few walls. A world that wants you gone.</p>
      <p>Each attack is a mission. Between missions you build. The world remembers how you killed it and changes in response: your best tactic stops working <i>because</i> it worked.</p>
      <div class="keys">
        <kbd>Left click</kbd><span>Select, move, target, place (drag to paint walls)</span>
        <kbd>Right drag · WASD</kbd><span>Pan</span>
        <kbd>Q / E · Wheel</kbd><span>Rotate · zoom</span>
        <kbd>1–9</kbd><span>Abilities and tools · body parts when aiming</span>
        <kbd>Tab · Space</kbd><span>Next colonist · end turn</span>
        <kbd>Z · L · Esc</kbd><span>Undo build · log · cancel</span>
      </div>
      <p class="credits">Built with three.js (MIT licence). No third-party art yet.</p>
      <div class="actions"><button class="btn primary" data-act="begin">Land</button></div>
    `, { begin: () => this.enterBuild() });
  }

  enterBuild() {
    this.closeModal();
    this.mode = 'build';
    this.selected = null;
    this.target = null;
    this.tool = null;
    this.scene.clearUnits();
    this.scene.buildTerrain(this.c);
    const n = this.c.attack;
    this.logRule(n === 1 ? 'Landing · build phase' : `Build phase · before mission ${n}`);
    this.feed(n === 1 ? 'You have landed. Set out the colony before they come.' : 'Build, heal, study the dead. Press Next mission when you are ready.');
    this.renderAll();
  }

  briefing() {
    const c = this.c;
    const intent = chooseIntent(c);
    const what = intent.kind === 'building' ? buildingName(c, intent.buildingId) : 'the colonists';
    const sched = waveSchedule(c)
      .map((w) => `<div>Turn <b>${w.turn}</b> · ${w.creatures.map((g) => `${g.count} ${SPECIES[g.species].name.toLowerCase()}${g.count > 1 ? 's' : ''}`).join(', ')}</div>`)
      .join('');
    const unspent = buildPointsLeft(c);
    this.modal(`
      <div class="kicker">Mission ${c.attack} of ${c.totalAttacks}</div>
      <h2>They will come for ${esc(what)}.</h2>
      <p class="muted">${esc(intent.reason)}</p>
      <p>Arrival schedule. Waves come on these turns whatever you kill; you will see where they come from when they arrive.</p>
      <div class="schedule">${sched}</div>
      ${unspent > 0 ? `<p class="muted">${unspent} build points are unspent. They do not carry over.</p>` : ''}
      <div class="actions"><button class="btn" data-act="back">Keep building</button><button class="btn primary" data-act="go">Deploy</button></div>
    `, { back: () => this.closeModal(), go: () => this.enterDeploy() });
  }

  enterDeploy() {
    this.closeModal();
    for (const l of finishBuildPhase(this.c)) this.log(l, 'colony');
    startBattle(this.c);
    this.mode = 'deploy';
    this.tool = null;
    this.selected = this.c.battle!.units[0]?.colonistId ?? null;
    this.aim = { kind: 'move' };
    this.scene.sync(this.c);
    const b = this.c.battle!;
    this.logRule(`Mission ${b.attack} of ${this.c.totalAttacks}`);
    this.feed('Everyone is on the map. Choose where each of them stands.');
    this.renderAll();
  }

  async startMission() {
    if (this.mode !== 'deploy') return;
    this.mode = 'battle';
    await this.run(beginBattle(this.c));
  }

  async run(events: BattleEvent[] | null) {
    if (!events) return;
    this.busy = true;
    this.target = null;
    this.renderAll();
    await this.scene.play(this.c, events, (e) => {
      if (e.t === 'log') this.feed(e.text, e.tone ?? 'neutral');
      if (e.t === 'phase') this.logRule(e.phase === 'enemy' ? `Turn ${e.turn} · the world moves` : `Turn ${e.turn}`);
      this.scene.refreshLabels(this.c);
      this.renderObjective();
      this.renderHostiles();
      this.renderSquad();
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
      <div class="kicker">Mission ${s.attack} of ${this.c.totalAttacks} · over</div>
      <h2>${headline}</h2>
      <table>${rows.join('')}</table>
      <div class="actions"><button class="btn primary" data-act="next">${over ? 'Continue' : 'Back to the colony'}</button></div>
    `, { next: () => (over ? this.showEnding() : this.enterBuild()) });
    this.renderAll();
  }

  showEnding() {
    this.mode = 'ending';
    this.scene.clearUnits();
    const result = campaignOver(this.c);
    const rows = this.c.colonists.map((col) => {
      const died = this.c.history.find((h) => h.died.includes(col.id));
      const fate = col.status === 'dead' ? `Died in mission ${died?.attack ?? '?'}.` : col.retired ? 'Lived. Will not fight again.' : 'Lived.';
      const scars = col.scars.map((s) => SCARS[s].name).join(', ');
      return `<tr><td>${esc(col.name)}</td><td>${ROLES[col.role].name}. ${fate}${scars ? ` Scars: ${scars}.` : ''}</td></tr>`;
    });
    const standing = this.c.buildings.filter((b) => !b.destroyed).map((b) => BUILDINGS[b.kind].name);
    const lost = this.c.buildings.filter((b) => b.destroyed).map((b) => BUILDINGS[b.kind].name);
    const changes = this.c.adaptations.map((a) => ADAPTATIONS.find((d) => d.id === a.id)!.name);
    const quiet = result === 'won' ? "Earth's ship is still on its way. The world is still here." : 'No one is left. The growth closes over the landing site.';
    this.modal(`
      <div class="kicker">The end of the prototype</div>
      <h2>${result === 'won' ? 'Three missions.' : 'The colony fell.'}</h2>
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
    if (k === 'l') return this.toggleLog();
    if (k === 'escape') {
      this.target = null;
      this.aim = { kind: 'move' };
      this.tool = null;
      this.renderAll();
      return;
    }
    if (!$('modal').hidden) return;
    if (this.mode === 'build') {
      if (k === 'z') {
        if (undoLast(this.c)) this.afterBuildChange();
        return;
      }
      const tools = this.buildTools();
      const n = Number(k);
      if (n >= 1 && n <= tools.length && !tools[n - 1].disabled) this.setTool(tools[n - 1].tool);
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
    } else if (k === 'f') {
      this.scene.speed = this.scene.speed === 1 ? 2.5 : 1;
      this.renderCorner();
    } else if (/^[1-9]$/.test(k)) {
      const n = Number(k);
      if (this.target && this.targetWeapon && this.selected) {
        if (n <= 4) void this.run(fire(this.c, this.selected, this.targetWeapon, this.target, PART_ORDER[n - 1]));
        return;
      }
      const abs = this.abilities();
      if (n <= abs.length && !abs[n - 1].disabled) abs[n - 1].run();
    } else if (k === 'o' && this.selected) {
      void this.run(overwatch(this.c, this.selected));
    }
  }

  private onPointerMove(e: PointerEvent) {
    const t = this.scene.pickTile(e.clientX, e.clientY);
    const changed = !this.hover || !t || !samePos(this.hover, t);
    this.hover = t;
    if (changed) {
      if (this.painting && t) this.paint(t);
      this.updateOverlay();
    }
    this.updateTooltip(e.clientX, e.clientY);
  }

  private onPointerDown(e: PointerEvent) {
    if (e.button !== 0 || this.mode !== 'build' || !this.tool) return;
    if (this.tool !== 'lowwall' && this.tool !== 'wall' && this.tool !== 'clear') return;
    const t = this.scene.pickTile(e.clientX, e.clientY);
    if (!t) return;
    const placedHere = this.c.build?.placed.some((p) => p.kind !== 'repair' && samePos(p.pos, t));
    this.painting = placedHere ? 'remove' : 'add';
    this.paint(t, true);
  }

  private paint(t: Vec, first = false) {
    const k = `${t.x},${t.y}`;
    if (k === this.lastPainted) return;
    this.lastPainted = k;
    let why: string | null = null;
    if (this.painting === 'remove') {
      undoAt(this.c, t);
    } else if (this.tool === 'lowwall' || this.tool === 'wall') {
      why = placeWall(this.c, t, this.tool);
    } else if (this.tool === 'clear') {
      why = clearGrowth(this.c, t);
    }
    // While dragging, silently skip tiles that cannot take the tool; on a single click, say why.
    if (why && first) this.toast(why);
    this.afterBuildChange();
  }

  private afterBuildChange() {
    this.scene.buildTerrain(this.c);
    this.renderObjective();
    this.renderBar();
    this.renderJobs();
    this.updateOverlay();
  }

  private onClick(e: MouseEvent) {
    const t = this.scene.pickTile(e.clientX, e.clientY);
    if (!t || this.busy) return;
    if (this.mode === 'deploy') return this.clickDeploy(t);
    if (this.mode === 'battle') return this.clickBattle(t);
    if (this.mode === 'build') return this.clickBuild(t);
  }

  private clickBuild(t: Vec) {
    const c = this.c;
    if (this.tool === 'repair') {
      const id = tileAt(c.map, t.x, t.y).buildingId;
      if (!id) return this.toast('Click a building to repair it.');
      const why = repairBuilding(c, id);
      if (why) this.toast(why);
      this.afterBuildChange();
      return;
    }
    if (this.tool?.startsWith('drop:')) {
      const kind = this.tool.slice(5) as BuildingKind;
      if (!canDrop(c, kind, t)) return this.toast('It must land on clear, level ground inside the colony.');
      const name = BUILDINGS[kind].name;
      this.modal(`
        <h2>Drop the ${esc(name.toLowerCase())} here?</h2>
        <p>Dropping is irreversible. It stays where it lands for the rest of the campaign, and the world will notice something new.</p>
        <p class="muted">Costs ${BUILDINGS[kind].cost} stores.</p>
        <div class="actions"><button class="btn" data-act="no">Not yet</button><button class="btn primary" data-act="yes">Drop it</button></div>
      `, {
        yes: () => {
          dropBuilding(c, kind, t);
          this.tool = null;
          this.feed(`The ${name.toLowerCase()} comes down from orbit.`, 'colony');
          this.closeModal();
          this.afterBuildChange();
          this.renderAll();
        },
        no: () => this.closeModal(),
      });
    }
  }

  private clickDeploy(t: Vec) {
    const b = this.c.battle!;
    const who = b.units.find((u) => samePos(u.pos, t));
    if (who) this.selected = who.colonistId;
    else if (this.selected && deploy(this.c, this.selected, t)) {
      this.scene.sync(this.c);
      const i = b.units.findIndex((u) => u.colonistId === this.selected);
      this.selected = b.units[(i + 1) % b.units.length].colonistId;
    } else if (!inColony(t)) this.toast('Deploy inside the dashed line.');
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
    if (creature) return this.openTarget(creature.id);
    if (unit) {
      if (this.selected && unit.downed && canStabilize(this.c, this.selected, unit.colonistId)) {
        void this.run(stabilize(this.c, this.selected, unit.colonistId));
        return;
      }
      this.select(unit.colonistId);
      return;
    }
    if (this.selected && this.aim.kind === 'move') {
      this.target = null;
      void this.run(moveUnit(this.c, this.selected, t));
    }
  }

  private openTarget(creatureId: string) {
    const b = this.c.battle!;
    const k = b.creatures.find((x) => x.id === creatureId);
    if (!k) return;
    this.scene.focus(k.pos);
    if (!this.selected || this.mode !== 'battle' || b.phase !== 'player') return;
    const u = b.units.find((x) => x.colonistId === this.selected)!;
    if (u.actions < 1) return this.toast('No actions left.');
    const weapons = this.weaponsFor(creatureId);
    if (!weapons.length) return this.toast('No shot: out of range or out of sight.');
    this.target = creatureId;
    this.targetWeapon = this.aim.kind === 'aim' && weapons.includes(this.aim.weapon) ? this.aim.weapon : weapons[0];
    this.renderAll();
  }

  private select(id: string) {
    this.selected = id;
    this.target = null;
    this.aim = { kind: 'move' };
    const u = this.c.battle?.units.find((x) => x.colonistId === id);
    if (u) this.scene.focus(u.pos);
    this.renderAll();
  }

  private setTool(t: Tool | null) {
    this.tool = this.tool === t ? null : t;
    this.renderBar();
    this.updateOverlay();
  }

  // ---------------------------------------------------------------- helpers

  weaponsFor(creatureId: string): WeaponId[] {
    if (!this.selected) return [];
    const st = unitStats(this.c.colonists.find((x) => x.id === this.selected)!);
    return st.weapons.filter((w) => !WEAPONS[w].area && canTarget(this.c, this.selected!, w, creatureId));
  }

  private selectNext(cycle = false) {
    const b = this.c.battle;
    if (!b) return;
    const ready = b.units.filter((u) => !u.downed && u.actions > 0);
    if (!ready.length) return;
    const i = ready.findIndex((u) => u.colonistId === this.selected);
    this.selected = cycle || i < 0 ? ready[(i + 1) % ready.length].colonistId : ready[i].colonistId;
    this.target = null;
    const u = b.units.find((x) => x.colonistId === this.selected);
    if (u && cycle) this.scene.focus(u.pos);
  }

  private toast(text: string) {
    const el = $('toast');
    el.textContent = text;
    el.hidden = false;
    clearTimeout((el as unknown as { _t: number })._t);
    (el as unknown as { _t: number })._t = window.setTimeout(() => (el.hidden = true), 2400);
  }

  /** A short message at the top of the screen that fades; everything also goes to the log. */
  private feed(text: string, tone: string = 'neutral') {
    this.log(text, tone);
    const box = $('feed');
    const el = document.createElement('div');
    el.className = tone;
    el.textContent = text;
    box.appendChild(el);
    while (box.children.length > 3) box.firstElementChild!.remove();
    window.setTimeout(() => el.classList.add('fade'), 5000);
    window.setTimeout(() => el.remove(), 5700);
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

  private toggleLog() {
    this.logOpen = !this.logOpen;
    $('logdrawer').hidden = !this.logOpen;
    if (this.logOpen) $('log-lines').scrollTop = $('log-lines').scrollHeight;
    this.renderIntel();
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
    this.renderObjective();
    this.renderHostiles();
    this.renderSquad();
    this.renderBar();
    this.renderCorner();
    this.renderTargetPanel();
    this.renderJobs();
    this.renderIntel();
    this.updateOverlay();
  }

  private renderObjective() {
    const el = $('objective');
    const c = this.c;
    el.hidden = this.mode === 'title';
    if (this.mode === 'build' || this.mode === 'aftermath' || this.mode === 'ending') {
      const hab = c.buildings.find((b) => b.kind === 'habitat');
      const bp = c.build ? `${buildPointsLeft(c)} / ${buildPointsTotal(c)}` : '—';
      el.innerHTML = `
        <div class="kicker">${c.history.length === 0 ? 'Landing' : `After mission ${c.history.length}`} · build phase</div>
        <div class="main">Prepare for mission ${Math.min(c.attack, c.totalAttacks)} of ${c.totalAttacks}</div>
        <div class="row"><span>Build points</span><b>${bp}</b></div>
        <div class="row"><span>Stores · salvage</span><b>${c.stores} · ${c.salvage}</b></div>
        ${hab ? `<div class="row"><span>Habitat</span><b>${hab.destroyed ? 'destroyed' : `${hab.hp}/${hab.maxHp}`}</b></div>` : ''}`;
      return;
    }
    const b = c.battle;
    if (!b) return;
    const what = b.intent.kind === 'building' ? buildingName(c, b.intent.buildingId) : 'the colonists';
    const bld = b.intent.kind === 'building' ? c.buildings.find((x) => x.id === (b.intent as { buildingId: string }).buildingId) : null;
    const meter = bld ? `<div class="meter"><div style="width:${(100 * bld.hp) / bld.maxHp}%"></div></div>` : '';
    if (this.mode === 'deploy') {
      el.innerHTML = `
        <div class="kicker">Mission ${b.attack} of ${c.totalAttacks} · deployment</div>
        <div class="main">They are coming for <b>${esc(what)}</b></div>${meter}
        <div class="row"><span>Waves on turns</span><b>${b.waves.map((w) => w.turn).join(', ')}</b></div>
        <div class="row"><span>Place everyone inside the dashed line</span></div>`;
      return;
    }
    const nw = nextWave(b);
    const left = b.creatures.filter((k) => k.alive).length;
    el.innerHTML = `
      <div class="kicker">Mission ${b.attack} of ${c.totalAttacks} · turn ${b.turn}</div>
      <div class="main">Defend <b>${esc(what)}</b></div>${meter}
      <div class="row"><span>${b.phase === 'enemy' ? 'The world moves' : 'Your move'}</span><b>${left} hostile${left === 1 ? '' : 's'} left</b></div>
      <div class="row wave"><span>${nw ? `Next wave: turn ${nw.turn}` : 'No more waves'}</span><b>${nw ? `${nw.creatureIds.length} incoming` : ''}</b></div>`;
  }

  private renderHostiles() {
    const el = $('hostiles');
    el.innerHTML = '';
    const b = this.c.battle;
    if (!b || this.mode !== 'battle') return;
    for (const k of liveCreatures(b)) {
      const d = document.createElement('div');
      const targetable = !k.burrowed && this.weaponsFor(k.id).length > 0;
      d.className = `hostile${targetable ? ' targetable' : ''}${k.burrowed ? ' under' : ''}`;
      d.textContent = k.burrowed ? '?' : SPECIES[k.species].name[0];
      d.title = k.burrowed ? 'Something underground' : `${SPECIES[k.species].name} · ${k.hp}/${k.maxHp}`;
      if (!k.burrowed) d.onclick = () => this.openTarget(k.id);
      el.appendChild(d);
    }
  }

  private renderSquad() {
    const root = $('squad');
    root.innerHTML = '';
    if (this.mode === 'title' || this.mode === 'build') return;
    const c = this.c;
    const b = c.battle;
    const strip = document.createElement('div');
    strip.className = 'strip';
    for (const col of c.colonists) {
      const u = b?.units.find((x) => x.colonistId === col.id);
      const m = document.createElement('div');
      const done = u && !u.downed && u.actions === 0 && this.mode === 'battle';
      m.className = `mini${this.selected === col.id ? ' sel' : ''}${col.status === 'dead' ? ' dead' : ''}${u?.downed ? ' down' : ''}${done ? ' done' : ''}`;
      const cv = document.createElement('canvas');
      drawPortrait(cv, col);
      m.appendChild(cv);
      m.insertAdjacentHTML('beforeend', `<div class="hpbar"><div style="width:${(100 * col.hp) / col.maxHp}%"></div></div>`);
      if (u && this.mode === 'battle' && !u.downed) m.insertAdjacentHTML('beforeend', `<div class="ap">${[0, 1].map((i) => `<i class="${i < u.actions ? 'on' : ''}"></i>`).join('')}</div>`);
      m.title = col.name;
      if (u && col.status !== 'dead') m.onclick = () => this.select(col.id);
      strip.appendChild(m);
    }
    root.appendChild(strip);
    const col = c.colonists.find((x) => x.id === this.selected);
    const u = b?.units.find((x) => x.colonistId === this.selected);
    if (!col || !u) return;
    const card = document.createElement('div');
    card.className = 'card';
    const cv = document.createElement('canvas');
    drawPortrait(cv, col);
    const info = document.createElement('div');
    const status = u.downed ? (u.stabilized ? 'Down · stable' : `Down · bleeding out in ${u.bleed}`) : col.retired ? `${ROLES[col.role].name} · cannot fight` : ROLES[col.role].name;
    const scars = col.scars.map((s) => `<span class="chip scar" title="${esc(SCARS[s].effect)}">${SCARS[s].name}</span>`).join('');
    info.innerHTML = `<div class="name">${esc(col.name)}</div><div class="role">${esc(status)}</div>
      <div class="hp">${Array.from({ length: col.maxHp }, (_, i) => `<i class="${i < col.hp ? 'on' : ''}"></i>`).join('')}</div>
      <div class="chips">${u.overwatch ? '<span class="chip tac">overwatch</span>' : ''}${scars}</div>`;
    card.append(cv, info);
    root.appendChild(card);
  }

  private abilities(): { name: string; icon: string; sub: string; disabled: boolean; active: boolean; count?: number; run: () => void }[] {
    const b = this.c.battle;
    if (!b || !this.selected) return [];
    const u = b.units.find((x) => x.colonistId === this.selected);
    if (!u || u.downed) return [];
    const idle = this.busy || b.phase !== 'player';
    const st = unitStats(this.c.colonists.find((x) => x.id === u.colonistId)!);
    const out: ReturnType<App['abilities']> = [];
    for (const w of st.weapons) {
      const def = WEAPONS[w];
      const charges = u.charges[w];
      const active = (this.aim.kind === 'aim' || this.aim.kind === 'throw') && this.aim.weapon === w;
      out.push({
        name: def.name,
        icon: w,
        sub: def.area ? `${def.category}, lands on a tile, no roll, ${charges ?? 0} left` : def.melee ? `${def.category}, adjacent only` : `${def.category}, range ${def.range}`,
        disabled: idle || u.actions < 1 || (def.area && (charges ?? 0) <= 0),
        active,
        count: def.area ? charges ?? 0 : undefined,
        run: () => {
          this.target = null;
          if (active) this.aim = { kind: 'move' };
          else if (def.area) this.aim = { kind: 'throw', weapon: w };
          else {
            this.aim = { kind: 'aim', weapon: w };
            // Like XCOM: go straight to the nearest target you can hit.
            const k = liveCreatures(b).filter((q) => canTarget(this.c, u.colonistId, w, q.id)).sort((p, q) => Math.hypot(p.pos.x - u.pos.x, p.pos.y - u.pos.y) - Math.hypot(q.pos.x - u.pos.x, q.pos.y - u.pos.y))[0];
            if (k) return this.openTarget(k.id);
          }
          this.renderAll();
        },
      });
    }
    out.push({
      name: 'Overwatch',
      icon: 'overwatch',
      sub: 'Shoot the first creature that moves in sight. −15 aim.',
      disabled: idle || u.actions < 1 || st.weapons.every((w) => WEAPONS[w].area || WEAPONS[w].melee),
      active: u.overwatch,
      run: () => void this.run(overwatch(this.c, u.colonistId)),
    });
    const hurt = b.units.find((x) => x.downed && canStabilize(this.c, u.colonistId, x.colonistId));
    if (hurt) {
      out.push({
        name: 'Stabilise',
        icon: 'stabilise',
        sub: `Stop ${this.c.colonists.find((x) => x.id === hurt.colonistId)!.name.split(' ')[0]} bleeding out. 1 action.`,
        disabled: idle,
        active: false,
        run: () => void this.run(stabilize(this.c, u.colonistId, hurt.colonistId)),
      });
    }
    return out;
  }

  private buildTools(): { tool: Tool; name: string; icon: string; sub: string; disabled: boolean }[] {
    const c = this.c;
    const ws = workshopStaffed(c);
    const out: ReturnType<App['buildTools']> = [
      { tool: 'lowwall', name: 'Low wall', icon: 'lowwall', sub: `Half cover, can be vaulted. ${COSTS.lowwall.bp} build point, ${COSTS.lowwall.material} material. Drag to paint; click again to undo.`, disabled: false },
      { tool: 'wall', name: 'Full wall', icon: 'wall', sub: `Full cover, blocks movement and sight. ${COSTS.wall.bp} build points, ${COSTS.wall.material} material.${ws ? '' : ' Needs a workshop staffed by the engineer.'}`, disabled: !ws },
      { tool: 'clear', name: 'Clear thorn', icon: 'clear', sub: `Cut back the world's growth. ${COSTS.clear.bp} build point.`, disabled: false },
      { tool: 'repair', name: 'Repair', icon: 'repair', sub: `Click a building: +${REPAIR_HP} HP for ${COSTS.repair.bp} build point and ${COSTS.repair.material} material.`, disabled: false },
    ];
    for (const kind of DROPPABLE) {
      const def = BUILDINGS[kind];
      const exists = c.buildings.some((b) => b.kind === kind);
      out.push({
        tool: `drop:${kind}`,
        name: def.name.replace('Xeno ', ''),
        icon: kind,
        sub: exists ? 'Already dropped.' : `${def.gives}${def.needs ? ` Needs a ${ROLES[def.needs].name.toLowerCase()}.` : ''} ${def.cost} stores. Irreversible.`,
        disabled: exists || c.stores < def.cost,
      });
    }
    return out;
  }

  private renderBar() {
    const bar = $('bar');
    bar.innerHTML = '';
    const add = (o: { name: string; icon: string; sub: string; disabled: boolean; active: boolean; key: string; count?: number; onClick: () => void }) => {
      const b = document.createElement('button');
      b.className = `ab${o.active ? ' active' : ''}`;
      b.disabled = o.disabled;
      b.innerHTML = `<span class="key">${o.key}</span>${o.count !== undefined ? `<span class="cnt">${o.count}</span>` : ''}${icon(o.icon)}<span class="lbl">${esc(o.name)}</span>`;
      b.onclick = o.onClick;
      b.onmouseenter = (e) => this.showTip(`<b>${esc(o.name)}</b>${esc(o.sub)}`, e.clientX, e.clientY - 60);
      b.onmouseleave = () => ($('tooltip').hidden = true);
      bar.appendChild(b);
    };
    if (this.mode === 'build') {
      this.buildTools().forEach((t, i) => {
        if (i === 4) bar.insertAdjacentHTML('beforeend', '<span class="bar-sep"></span>');
        add({ ...t, active: this.tool === t.tool, key: String(i + 1), onClick: () => this.setTool(t.tool) });
      });
      bar.insertAdjacentHTML('beforeend', '<span class="bar-sep"></span>');
      add({ name: 'Undo', icon: 'undo', sub: 'Undo the last thing placed this phase (Z). Drops cannot be undone.', disabled: !this.c.build?.placed.length, active: false, key: 'Z', onClick: () => undoLast(this.c) && this.afterBuildChange() });
      if (this.tool) bar.insertAdjacentHTML('beforeend', `<div class="bar-note">${esc(this.buildTools().find((t) => t.tool === this.tool)?.name ?? '')} · Esc to put down</div>`);
      return;
    }
    if (this.mode === 'deploy') {
      bar.innerHTML = '<div class="bar-note" style="position:static;transform:none">Click a colonist, then a tile inside the dashed line.</div>';
      return;
    }
    if (this.mode !== 'battle') return;
    this.abilities().forEach((a, i) => add({ ...a, key: String(i + 1), onClick: a.run }));
  }

  private renderCorner() {
    const el = $('corner');
    el.innerHTML = '';
    const btn = (label: string, sub: string, ico: string, onClick: () => void, disabled = false) => {
      const b = document.createElement('button');
      b.className = 'commit';
      b.disabled = disabled;
      b.innerHTML = `${icon(ico, 20)}<span>${label}<small>${sub}</small></span>`;
      b.onclick = onClick;
      el.appendChild(b);
    };
    if (this.mode === 'build') btn('Next mission', `mission ${this.c.attack} of ${this.c.totalAttacks}`, 'next', () => this.briefing());
    if (this.mode === 'deploy') btn('Start mission', 'positions are final', 'next', () => void this.startMission());
    if (this.mode === 'battle') {
      const sp = document.createElement('button');
      sp.className = 'speed';
      sp.textContent = `Enemy speed ${this.scene.speed === 1 ? '1×' : '2.5×'} (F)`;
      sp.onclick = () => {
        this.scene.speed = this.scene.speed === 1 ? 2.5 : 1;
        this.renderCorner();
      };
      el.appendChild(sp);
      const b = this.c.battle!;
      btn('End turn', 'Space', 'endturn', () => void this.run(endTurn(this.c)), this.busy || b.phase !== 'player');
    }
  }

  private renderTargetPanel() {
    const p = $('targetpanel');
    if (this.mode !== 'battle' || !this.target || !this.selected || !this.targetWeapon || this.busy) {
      p.hidden = true;
      return;
    }
    const b = this.c.battle!;
    const k = b.creatures.find((x) => x.id === this.target);
    const weapons = k?.alive ? this.weaponsFor(k.id) : [];
    if (!k || !weapons.length) {
      p.hidden = true;
      return;
    }
    if (!weapons.includes(this.targetWeapon)) this.targetWeapon = weapons[0];
    const w = this.targetWeapon;
    const sp = SPECIES[k.species];
    const flags = [k.slowed ? 'slowed' : '', k.blinded > 0 ? 'blind' : '', k.burning ? 'burning' : ''].filter(Boolean).join(', ');
    const parts = PART_ORDER.map((part, i) => {
      const bd = shotBreakdown(this.c, this.selected!, w, k.id, part);
      const dmg = bd.damage >= 99 ? 'kills' : `${bd.damage} dmg`;
      return `<button class="part" data-part="${part}"><kbd>${i + 1}</kbd><div class="pname">${PARTS[part].name}</div><div class="pct">${bd.chance}%</div><div class="eff">${dmg}${bd.effect && bd.effect !== 'kills' ? ` · ${bd.effect}` : ''}</div></button>`;
    }).join('');
    const brk = (part: BodyPart) => {
      const bd = shotBreakdown(this.c, this.selected!, w, k.id, part);
      return `${PARTS[part].name}: ${bd.parts.map((x) => `<span class="${x.value < 0 ? 'neg' : x.value > 0 && x.label !== 'Aim' ? 'pos' : ''}">${esc(x.label)} ${x.value > 0 && x.label !== 'Aim' ? '+' : ''}${x.value}</span>`).join('')} = <b>${bd.chance}%</b>`;
    };
    p.innerHTML = `
      <h3>${sp.name} · ${k.hp}/${k.maxHp}${flags ? ` · ${flags}` : ''}<span>Esc to cancel · the roll is honest</span></h3>
      ${weapons.length > 1 ? `<div class="weapons">${weapons.map((x) => `<button data-w="${x}" class="${x === w ? 'active' : ''}">${WEAPONS[x].name}</button>`).join('')}</div>` : `<div class="weapons"><button class="active">${WEAPONS[w].name}</button></div>`}
      <div class="parts">${parts}</div>
      <div class="breakdown">${brk(this.hoverPart)}</div>`;
    p.hidden = false;
    p.querySelectorAll<HTMLButtonElement>('[data-w]').forEach((el) => (el.onclick = () => {
      this.targetWeapon = el.dataset.w as WeaponId;
      this.renderTargetPanel();
    }));
    p.querySelectorAll<HTMLButtonElement>('[data-part]').forEach((el) => {
      el.onmouseenter = () => {
        this.hoverPart = el.dataset.part as BodyPart;
        p.querySelector('.breakdown')!.innerHTML = brk(this.hoverPart);
      };
      el.onclick = () => void this.run(fire(this.c, this.selected!, w, k.id, el.dataset.part as BodyPart));
    });
  }

  private renderJobs() {
    const el = $('jobs');
    const c = this.c;
    if (this.mode !== 'build' || !c.build) {
      el.hidden = true;
      return;
    }
    el.hidden = false;
    const rows = c.colonists.filter((x) => x.status === 'active').map((col) => {
      const job = c.build!.jobs[col.id] ?? { kind: 'rest' };
      const opts = this.jobOptions(col.id).map((o) => `<option value="${o.value}" ${o.value === this.jobValue(job) ? 'selected' : ''}>${esc(o.label)}</option>`).join('');
      const scars = col.scars.length ? ` · ${col.scars.map((s) => SCARS[s].name).join(', ')}` : '';
      return `<div class="job"><canvas data-portrait="${col.id}"></canvas><div class="who">${esc(col.name.split(' ')[0])}<span>${ROLES[col.role].name} · ${col.hp}/${col.maxHp}${esc(scars)}</span></div><select data-col="${col.id}">${opts}</select></div>`;
    }).join('');
    el.innerHTML = `<h4>Jobs this phase</h4>${rows}`;
    el.querySelectorAll<HTMLCanvasElement>('canvas[data-portrait]').forEach((cv) => drawPortrait(cv, c.colonists.find((x) => x.id === cv.dataset.portrait)!));
    el.querySelectorAll<HTMLSelectElement>('select[data-col]').forEach((s) => (s.onchange = () => {
      const why = setJob(c, s.dataset.col!, this.parseJob(s.value));
      if (why) this.toast(why);
      this.renderAll();
    }));
  }

  private jobOptions(colId: string): { value: string; label: string }[] {
    const c = this.c;
    const col = c.colonists.find((x) => x.id === colId)!;
    const infirmary = c.buildings.some((b) => b.kind === 'infirmary' && !b.destroyed);
    const out = [
      { value: 'build', label: `${JOB_LABEL.build} (+${ROLES[col.role].buildPoints} points)` },
      { value: 'heal', label: infirmary ? 'Heal (full, infirmary)' : 'Heal (+3)' },
      { value: 'rest', label: `${JOB_LABEL.rest} (+2)` },
    ];
    for (const b of c.buildings) {
      if (b.destroyed || (b.kind !== 'lab' && b.kind !== 'workshop')) continue;
      out.push({ value: `staff:${b.id}`, label: `Staff ${BUILDINGS[b.kind].name.toLowerCase()}` });
    }
    if (canTrain(col)) {
      for (const r of Object.keys(ROLES) as RoleId[]) if (r !== col.role) out.push({ value: `train:${r}`, label: `Retrain: ${ROLES[r].name.toLowerCase()}` });
    }
    return out;
  }

  private jobValue(j: Job): string {
    if (j.kind === 'staff') return `staff:${j.buildingId}`;
    if (j.kind === 'train') return `train:${j.role}`;
    return j.kind;
  }

  private parseJob(v: string): Job {
    const [k, arg] = v.split(':');
    if (k === 'staff') return { kind: 'staff', buildingId: arg };
    if (k === 'train') return { kind: 'train', role: arg as RoleId };
    if (k === 'build' || k === 'heal') return { kind: k };
    return { kind: 'rest' };
  }

  private renderIntel() {
    const el = $('intel');
    const c = this.c;
    if (this.mode !== 'build') {
      el.hidden = true;
      return;
    }
    el.hidden = this.logOpen;
    const last = c.history[c.history.length - 1];
    const lab = c.buildings.find((b) => b.kind === 'lab');
    const xeno = c.colonists.find((x) => x.role === 'xenobiologist' && x.status === 'active');
    let report: string;
    if (!last) report = '<div class="report none">No bodies yet. Nothing has come.</div>';
    else if (reportAvailable(c)) {
      const lines = dissectionReport(c.kills.filter((k) => k.attack === last.attack), last.adaptation);
      if (last.adaptation) this.known.add(last.adaptation.id);
      report = `<div class="report">${lines.map((l) => `<p>${esc(l)}</p>`).join('')}<p class="muted">— ${esc(xeno?.name ?? 'the lab')}</p></div>`;
    } else if (!lab || lab.destroyed) report = '<div class="report none">There is no xeno lab. Whatever they are becoming, you will find out when they come.</div>';
    else if (!xeno) report = '<div class="report none">No one left can read the bodies.</div>';
    else report = `<div class="report none">The bodies are in the lab. Give ${esc(xeno.name.split(' ')[0])} the job of staffing it to read them.</div>`;
    const known = [...this.known].map((id) => ADAPTATIONS.find((a) => a.id === id)!);
    el.innerHTML = `<h4>Dissection</h4>${report}${known.length ? `<h4 style="margin-top:8px">What you know they have become</h4>${known.map((a) => `<div class="report">${a.name}: ${esc(a.effect)}</div>`).join('')}` : ''}`;
  }

  // ---------------------------------------------------------------- overlay + tooltip

  updateOverlay() {
    const c = this.c;
    if (!c) return;
    const o: OverlaySpec = { hover: this.hover };
    if (this.mode === 'build') {
      o.outline = ZONE;
      o.marks = (c.build?.placed ?? []).flatMap((p) => (p.kind === 'repair' ? [] : [p.pos]));
      const h = this.hover;
      if (h && this.tool) {
        if (this.tool.startsWith('drop:')) {
          const kind = this.tool.slice(5) as BuildingKind;
          const size = BUILDINGS[kind].size;
          const tiles: Vec[] = [];
          for (let y = h.y; y < h.y + size; y++) for (let x = h.x; x < h.x + size; x++) tiles.push({ x, y });
          o.footprint = { tiles, valid: canDrop(c, kind, h) };
        } else if (this.tool !== 'repair') {
          o.preview = { tiles: [h], valid: this.toolProblem(h) === null };
        }
      }
    }
    if (this.mode === 'deploy' && c.battle) {
      o.outline = ZONE;
      const zone: Vec[] = [];
      for (let y = ZONE.y0; y <= ZONE.y1; y++) for (let x = ZONE.x0; x <= ZONE.x1; x++) if (canStand(c.map, { x, y })) zone.push({ x, y });
      o.zone = zone;
      o.selected = c.battle.units.find((x) => x.colonistId === this.selected)?.pos ?? null;
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
            o.path = pathTo(reach(c.map, u.pos, st.mobility * 2, colonistMoveOpts(b)), h);
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
    this.scene.setOverlay(c, o);
  }

  /** What stops the current build tool acting on this tile, or null. */
  private toolProblem(p: Vec): string | null {
    const c = this.c;
    if (!c.build) return 'Not building.';
    if (this.tool === 'lowwall' || this.tool === 'wall') {
      const why = buildBlocked(c, p, this.tool);
      if (why) return why;
      if (this.tool === 'wall' && !workshopStaffed(c)) return 'Needs a workshop staffed by the engineer.';
      if (buildPointsLeft(c) < COSTS[this.tool].bp) return 'No build points left.';
      if (material(c) < COSTS[this.tool].material) return 'Not enough material.';
      return null;
    }
    if (this.tool === 'clear') {
      if (!tileAt(c.map, p.x, p.y).growth) return 'No growth there.';
      if (buildPointsLeft(c) < COSTS.clear.bp) return 'No build points left.';
      return null;
    }
    return null;
  }

  private showTip(html: string, x: number, y: number) {
    const tip = $('tooltip');
    tip.innerHTML = html;
    tip.hidden = false;
    const r = tip.getBoundingClientRect();
    tip.style.left = `${Math.max(8, Math.min(window.innerWidth - r.width - 8, x + 16))}px`;
    tip.style.top = `${Math.max(8, Math.min(window.innerHeight - r.height - 8, y + 16))}px`;
  }

  private updateTooltip(x: number, y: number) {
    const h = this.hover;
    const c = this.c;
    if (!h || !c || this.mode === 'title') {
      $('tooltip').hidden = true;
      return;
    }
    const bits: string[] = [];
    const b = c.battle;
    if (this.mode === 'build' && this.tool && this.tool !== 'repair' && !this.tool.startsWith('drop:')) {
      const why = this.toolProblem(h);
      const placed = c.build?.placed.some((p) => p.kind !== 'repair' && samePos(p.pos, h));
      bits.push(placed ? '<div class="good">Placed this phase. Click to undo.</div>' : why ? `<div class="bad">${esc(why)}</div>` : '<div class="good">Click or drag to place.</div>');
    }
    const k = b && this.mode === 'battle' ? liveCreatures(b).find((q) => samePos(q.pos, h)) : null;
    if (k) {
      const sp = SPECIES[k.species];
      const known = [...this.known].map((id) => ADAPTATIONS.find((a) => a.id === id)!);
      bits.push(k.burrowed
        ? '<b class="world">Something underground</b><span class="muted">It cannot be shot until it surfaces.</span>'
        : `<b class="world">${sp.name} · ${k.hp}/${k.maxHp}</b><div class="muted">${esc(sp.blurb)}</div>` +
          (known.length ? `<div>What you know it has become:</div>${known.map((a) => `<div class="world">${a.name}: ${esc(a.effect)}</div>`).join('')}` : ''));
    } else {
      const t = tileAt(c.map, h.x, h.y);
      const u = b?.units.find((q) => samePos(q.pos, h));
      if (u && (this.mode === 'battle' || this.mode === 'deploy')) {
        const col = c.colonists.find((q) => q.id === u.colonistId)!;
        bits.push(`<b>${esc(col.name)}</b><div class="muted">${ROLES[col.role].name} · ${col.hp}/${col.maxHp}</div>`);
        if (u.downed && this.selected && b?.units.some((q) => q.colonistId === this.selected && adjacent(q.pos, h))) bits.push('<div>Click to stabilise.</div>');
      }
      if (t.buildingId) {
        const bld = c.buildings.find((q) => q.id === t.buildingId)!;
        bits.push(`<b>${BUILDINGS[bld.kind].name} · ${bld.hp}/${bld.maxHp}</b><div class="muted">${esc(BUILDINGS[bld.kind].gives)}</div>`);
      }
      if (t.structure) {
        const label = { wall: 'Wall · full cover', lowwall: 'Low wall · half cover, vaultable', crate: 'Cargo crate · half cover, vaultable' }[t.structure.kind];
        bits.push(`<b>${label}</b>${t.structure.overgrowth >= 2 ? '<div class="world">Overgrown: one level less cover.</div>' : t.structure.overgrowth ? '<div class="world">Growth is reaching it.</div>' : ''}`);
      }
      if (t.base === 'water') bits.push('<b>Deep water</b><div class="muted">Cannot be crossed except at a ford. Does not block sight.</div>');
      if (t.base === 'ford') bits.push('<b>Ford</b><div class="muted">Shallow. Costs an extra move. No cover.</div>');
      if (t.growth) bits.push('<b class="world">Thorn mat</b><div class="muted">Half cover. Blocks sight. Slows colonists, not creatures.</div>');
      if (t.burned) bits.push('<div class="muted">Burned ground. Nothing will grow here.</div>');
      if (t.rubble) bits.push('<div class="muted">Rubble · half cover.</div>');
      if (t.base === 'tree') bits.push('<b>Tree</b><div class="muted">Half cover. Blocks movement.</div>');
      if (t.base === 'rock') bits.push('<b>Rock</b><div class="muted">Full cover. Blocks sight.</div>');
      if (t.elevation && (this.mode !== 'build' || !this.tool)) bits.push(`<div class="muted">Height ${t.elevation}. Shooting downhill: +10 aim, and the target loses a level of cover.</div>`);
    }
    if (!bits.length) {
      $('tooltip').hidden = true;
      return;
    }
    this.showTip(bits.join(''), x, y);
  }
}
