import * as THREE from 'three';
import type { BattleEvent } from '../sim/combat';
import { ROLES, SPECIES, WEAPONS } from '../sim/data';
import { CENTER, COLONY_RADIUS, chebyshev, inBounds, tileAt } from '../sim/map';
import type { Building, Campaign, Creature, Vec } from '../sim/types';
import { PAL } from './palette';
import { WORLD_TIME, instanced, modelObject, type Assets, type FileKey, type Model, type Treatment } from './assets';

const ELEV = 0.55; // world height per elevation level
const WATER_LEVEL = -0.14;
const FORD_LEVEL = -0.06;

export interface OverlaySpec {
  walk?: Vec[];
  dash?: Vec[];
  zone?: Vec[];
  area?: Vec[];
  areaValid?: boolean;
  footprint?: { tiles: Vec[]; valid: boolean };
  marks?: Vec[]; // things placed this build phase
  /** Outline of the colony's build and deploy area. */
  outline?: { x0: number; y0: number; x1: number; y1: number };
  /** Tile under the cursor coloured by whether the current tool can act there. */
  preview?: { tiles: Vec[]; valid: boolean };
  /** Where the next wave will come from, once known. */
  incoming?: Vec[];
  path?: Vec[];
  hover?: Vec | null;
  selected?: Vec | null;
  targets?: Vec[];
  cover?: Vec | null; // show cover shields around this tile
}

interface Tween {
  t: number;
  dur: number;
  step: (k: number) => void;
  done: () => void;
}

interface Label {
  el: HTMLDivElement;
  obj: THREE.Object3D;
  dy: number;
}

function hash(n: number): number {
  let x = (n ^ 0x9e3779b9) >>> 0;
  x = Math.imul(x ^ (x >>> 16), 0x85ebca6b) >>> 0;
  x = Math.imul(x ^ (x >>> 13), 0xc2b2ae35) >>> 0;
  return ((x ^ (x >>> 16)) >>> 0) / 4294967296;
}

export class Scene3D {
  readonly renderer: THREE.WebGLRenderer;
  readonly scene = new THREE.Scene();
  readonly camera: THREE.PerspectiveCamera;
  private container: HTMLElement;
  private labelLayer: HTMLDivElement;
  private raycaster = new THREE.Raycaster();
  private timer = new THREE.Timer();

  // Camera rig.
  private target = new THREE.Vector3(24, 0, 26);
  private mapW = 48;
  private yaw = 0;
  private yawGoal = 0;
  private distance = 27;
  private pitch = 0.82;
  private keys = new Set<string>();

  private terrain = new THREE.Group();
  private tileMesh: THREE.InstancedMesh | null = null;
  private overlay = new THREE.Group();
  private units = new Map<string, THREE.Group>();
  private labels = new Map<string, Label>();
  private floaters: { el: HTMLDivElement; pos: THREE.Vector3; t: number }[] = [];
  private tweens: Tween[] = [];
  private fx = new THREE.Group();
  private time = 0;

  speed = 1;
  /** Kenney models, if loaded. Without them everything is drawn from primitives. */
  assets: Assets | null = null;
  /** Skip all animation: events resolve instantly. */
  instant = false;

  constructor(container: HTMLElement, opts: { lowQuality?: boolean } = {}) {
    this.container = container;
    this.renderer = new THREE.WebGLRenderer({ antialias: !opts.lowQuality, preserveDrawingBuffer: true });
    this.renderer.setPixelRatio(opts.lowQuality ? 1 : Math.min(window.devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = !opts.lowQuality;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    container.appendChild(this.renderer.domElement);

    this.labelLayer = document.createElement('div');
    this.labelLayer.className = 'labels';
    container.appendChild(this.labelLayer);

    this.camera = new THREE.PerspectiveCamera(38, 1, 0.1, 300);
    this.scene.background = new THREE.Color(PAL.sky);
    this.scene.fog = new THREE.Fog(PAL.fog, 55, 110);

    const hemi = new THREE.HemisphereLight(0xcfd8e0, 0x3a3328, 1.1);
    this.scene.add(hemi);
    const sun = new THREE.DirectionalLight(0xfff1dc, 2.0);
    sun.position.set(8, 30, -6);
    sun.target.position.set(24, 0, 24);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const sc = sun.shadow.camera;
    sc.left = -38; sc.right = 38; sc.top = 38; sc.bottom = -38; sc.near = 1; sc.far = 90;
    sun.shadow.bias = -0.0008;
    sun.position.add(new THREE.Vector3(24, 0, 24));
    this.scene.add(sun, sun.target);

    this.scene.add(this.terrain, this.overlay, this.fx);
    window.addEventListener('resize', () => this.resize());
    window.addEventListener('keydown', (e) => {
      if ((e.target as HTMLElement)?.tagName === 'SELECT') return;
      this.keys.add(e.key.toLowerCase());
      if (e.key.toLowerCase() === 'q') this.yawGoal += Math.PI / 2;
      if (e.key.toLowerCase() === 'e') this.yawGoal -= Math.PI / 2;
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));
    window.addEventListener('blur', () => this.keys.clear());
    container.addEventListener('wheel', (e) => {
      e.preventDefault();
      this.distance = THREE.MathUtils.clamp(this.distance * (1 + Math.sign(e.deltaY) * 0.1), 10, 55);
    }, { passive: false });
    this.installDragPan();
    this.resize();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  private installDragPan() {
    let dragging = false;
    let lx = 0;
    let ly = 0;
    const el = this.renderer.domElement;
    el.addEventListener('contextmenu', (e) => e.preventDefault());
    el.addEventListener('pointerdown', (e) => {
      if (e.button === 2 || e.button === 1) {
        dragging = true;
        lx = e.clientX;
        ly = e.clientY;
      }
    });
    window.addEventListener('pointermove', (e) => {
      if (!dragging) return;
      const dx = e.clientX - lx;
      const dy = e.clientY - ly;
      lx = e.clientX;
      ly = e.clientY;
      const s = this.distance / 600;
      this.panBy(-dx * s, -dy * s);
    });
    window.addEventListener('pointerup', () => (dragging = false));
  }

  private panBy(right: number, forward: number) {
    const fwd = new THREE.Vector3(-Math.sin(this.yaw), 0, -Math.cos(this.yaw));
    const rgt = new THREE.Vector3(Math.cos(this.yaw), 0, -Math.sin(this.yaw));
    this.target.addScaledVector(rgt, right).addScaledVector(fwd, -forward);
    this.target.x = THREE.MathUtils.clamp(this.target.x, 0, this.mapW - 1);
    this.target.z = THREE.MathUtils.clamp(this.target.z, 0, this.mapW - 1);
  }

  focus(p: Vec) {
    this.target.set(p.x, 0, p.y);
  }

  /** Screen position of a tile's top surface, in client pixels. Used by the browser smoke test. */
  screenOf(c: Campaign, p: Vec): { x: number; y: number } {
    const v = this.world(c, p, 0.3).project(this.camera);
    const r = this.renderer.domElement.getBoundingClientRect();
    return { x: r.left + ((v.x + 1) / 2) * r.width, y: r.top + ((1 - v.y) / 2) * r.height };
  }

  resize() {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  get domElement() {
    return this.renderer.domElement;
  }

  // ---------------------------------------------------------------- frame

  private frame() {
    this.timer.update();
    const dt = Math.min(0.05, this.timer.getDelta());
    this.time += dt;
    WORLD_TIME.value = this.time;
    const pan = 18 * dt * (this.distance / 26);
    if (this.keys.has('w') || this.keys.has('arrowup')) this.panBy(0, -pan);
    if (this.keys.has('s') || this.keys.has('arrowdown')) this.panBy(0, pan);
    if (this.keys.has('a') || this.keys.has('arrowleft')) this.panBy(-pan, 0);
    if (this.keys.has('d') || this.keys.has('arrowright')) this.panBy(pan, 0);
    this.yaw += (this.yawGoal - this.yaw) * Math.min(1, dt * 8);
    const off = new THREE.Vector3(
      Math.sin(this.yaw) * Math.cos(this.pitch),
      Math.sin(this.pitch),
      Math.cos(this.yaw) * Math.cos(this.pitch),
    ).multiplyScalar(this.distance);
    this.camera.position.copy(this.target).add(off);
    this.camera.lookAt(this.target);

    for (const tw of [...this.tweens]) {
      tw.t += dt * this.speed;
      const k = Math.min(1, tw.t / tw.dur);
      tw.step(k);
      if (k >= 1) {
        this.tweens.splice(this.tweens.indexOf(tw), 1);
        tw.done();
      }
    }
    // Idle motion: the world breathes, the colony does not.
    for (const [id, g] of this.units) {
      if (g.userData.kind === 'creature' && !g.userData.dead) {
        const body = g.getObjectByName('body');
        if (body) body.scale.y = 1 + Math.sin(this.time * 3 + hash(id.length * 13 + id.charCodeAt(id.length - 1)) * 6) * 0.06;
      }
    }
    this.renderer.render(this.scene, this.camera);
    this.updateLabels(dt);
  }

  private tween(dur: number, step: (k: number) => void): Promise<void> {
    if (this.instant) {
      step(1);
      return Promise.resolve();
    }
    return new Promise((resolve) => this.tweens.push({ t: 0, dur, step, done: resolve }));
  }

  private wait(sec: number): Promise<void> {
    return this.tween(sec, () => {});
  }

  // ---------------------------------------------------------------- coordinates

  height(c: Campaign, p: Vec): number {
    if (!inBounds(c.map, p.x, p.y)) return 0;
    const t = tileAt(c.map, p.x, p.y);
    if (t.base === 'water') return WATER_LEVEL;
    if (t.base === 'ford') return FORD_LEVEL;
    return t.elevation * ELEV;
  }

  world(c: Campaign, p: Vec, lift = 0): THREE.Vector3 {
    return new THREE.Vector3(p.x, this.height(c, p) + lift, p.y);
  }

  pickTile(clientX: number, clientY: number): Vec | null {
    if (!this.tileMesh) return null;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    const pickables: THREE.Object3D[] = [this.tileMesh];
    for (const g of this.units.values()) if (!g.userData.dead) pickables.push(g);
    const hits = this.raycaster.intersectObjects(pickables, true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o && !o.userData.tile) o = o.parent;
      if (o?.userData.tile) return { ...(o.userData.tile as Vec) };
      if (h.object === this.tileMesh && h.instanceId !== undefined) return { x: h.instanceId % this.mapW, y: Math.floor(h.instanceId / this.mapW) };
    }
    return null;
  }

  // ---------------------------------------------------------------- terrain

  buildTerrain(c: Campaign) {
    for (const ch of [...this.terrain.children]) {
      this.terrain.remove(ch);
      ch.traverse((o) => {
        const m = o as THREE.Mesh;
        if (m.geometry && !o.userData.shared) m.geometry.dispose();
      });
    }
    const map = c.map;
    this.mapW = map.w;
    const n = map.w * map.h;
    const box = new THREE.BoxGeometry(1, 1, 1);
    const tileMat = new THREE.MeshStandardMaterial({ roughness: 0.95, metalness: 0 });
    const tiles = new THREE.InstancedMesh(box, tileMat, n);
    tiles.receiveShadow = true;
    const m4 = new THREE.Matrix4();
    const col = new THREE.Color();
    const trees: THREE.Matrix4[] = [];
    const trunks: THREE.Matrix4[] = [];
    const rocks: THREE.Matrix4[] = [];
    const thorns: THREE.Matrix4[][] = [[], [], []];
    const rubble: THREE.Matrix4[] = [];
    const water: THREE.Matrix4[] = [];
    const shallows: THREE.Matrix4[] = [];
    const crates: THREE.Matrix4[] = [];
    // Model placements, grouped per model so each becomes a few instanced meshes.
    const buckets = new Map<Model, THREE.Matrix4[]>();
    const A = this.assets;
    const model = (k: FileKey, t: Treatment = 'none', v = 0) => A?.get(k, t, v) ?? null;
    const put = (m: Model | null, mx: THREE.Matrix4 | null): boolean => {
      if (!m || !mx) return false;
      let l = buckets.get(m);
      if (!l) buckets.set(m, (l = []));
      l.push(mx);
      return true;
    };
    const ROCKS: FileKey[] = ['rockTallA', 'rockTallD', 'rockTallG', 'stoneTallB'];
    const SCREE: FileKey[] = ['rockSmallA', 'rockSmallC', 'rockFlat', 'rockSlab'];
    const TREES: FileKey[] = ['treeDefault', 'treeOak', 'treeFat', 'treeDetailed', 'treePlateau', 'treeThin', 'treePalm'];
    let padMin = { x: Infinity, y: Infinity };
    let padMax = { x: -Infinity, y: -Infinity };
    const lowerBy = (x: number, y: number, e: number) =>
      inBounds(map, x, y) ? e - (tileAt(map, x, y).base === 'water' ? -1 : tileAt(map, x, y).elevation) : 0;
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        const i = y * map.w + x;
        const t = tileAt(map, x, y);
        const top = t.base === 'water' ? -0.5 : t.base === 'ford' ? -0.2 : t.elevation * ELEV;
        const h = top + 0.6;
        m4.makeScale(1, h, 1).setPosition(x, top - h / 2, y);
        tiles.setMatrixAt(i, m4);
        const r = hash(i);
        if (t.base === 'water' || t.base === 'ford') col.setHex(PAL.riverbed);
        else if (t.burned) col.setHex(PAL.burned);
        else if (t.base === 'sand') col.setHex(PAL.sand);
        else if (t.base === 'pad') col.setHex(PAL.pad);
        else col.setHex([PAL.ground, PAL.groundHigh, PAL.groundTop, PAL.groundPeak][t.elevation] ?? PAL.groundPeak);
        if (t.base !== 'pad') col.offsetHSL(0, 0, (r - 0.5) * 0.04);
        // Cliff edges read darker, like exposed stone.
        const drop = Math.max(lowerBy(x + 1, y, t.elevation), lowerBy(x - 1, y, t.elevation), lowerBy(x, y + 1, t.elevation), lowerBy(x, y - 1, t.elevation));
        if (drop >= 2 && t.base !== 'water' && t.base !== 'ford') col.lerp(new THREE.Color(PAL.cliff), 0.45);
        tiles.setColorAt(i, col);
        if (t.base === 'water') water.push(new THREE.Matrix4().setPosition(x, WATER_LEVEL, y));
        if (t.base === 'ford') shallows.push(new THREE.Matrix4().setPosition(x, FORD_LEVEL, y));
        if (t.base === 'pad') {
          padMin = { x: Math.min(padMin.x, x), y: Math.min(padMin.y, y) };
          padMax = { x: Math.max(padMax.x, x), y: Math.max(padMax.y, y) };
        }
        // Scree at the foot of cliffs: rounded stones, the world's shapes.
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          if (lowerBy(x + dx, y + dy, t.elevation) < 2 || tileAt(map, x + dx, y + dy).base === 'water') continue;
          if (hash(i * 7 + dx * 3 + dy) > 0.55) continue;
          const lt = tileAt(map, x + dx, y + dy);
          if (lt.base === 'rock' || lt.base === 'tree' || lt.buildingId || lt.structure) continue;
          const s = 0.25 + hash(i + dx * 13 + dy * 17) * 0.25;
          const sk = SCREE[Math.floor(hash(i * 3 + dx + 2 * dy) * SCREE.length)];
          const scree = model(sk, 'rock', i);
          if (put(scree, scree && place(scree, x + dx * 0.42, lt.elevation * ELEV, y + dy * 0.42, { w: s * 1.6, rot: hash(i + dx) * 6.28 }))) continue;
          rocks.push(new THREE.Matrix4().compose(
            new THREE.Vector3(x + dx * 0.42, lt.elevation * ELEV + s * 0.4, y + dy * 0.42),
            new THREE.Quaternion().setFromEuler(new THREE.Euler(r * 3, hash(i + dx) * 6, 0)),
            new THREE.Vector3(s * 1.3, s, s * 1.1),
          ));
        }
        // Cliff faces: a rock wall down every edge that drops two levels or more.
        if (t.base !== 'water' && t.base !== 'ford') {
          for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
            if (!inBounds(map, x + dx, y + dy)) continue;
            const lt = tileAt(map, x + dx, y + dy);
            const lower = lt.base === 'water' ? WATER_LEVEL : lt.base === 'ford' ? FORD_LEVEL : lt.elevation * ELEV;
            if (t.elevation - lt.elevation < 2) continue;
            const cliff = model('cliff', 'cliff');
            put(cliff, cliff && place(cliff, x + dx * 0.36, lower - 0.05, y + dy * 0.36, { dims: [1.02, top - lower + 0.12, 0.34], rot: Math.atan2(dx, dy) + Math.PI }));
          }
        }
        if (t.structure?.kind === 'crate') {
          crates.push(new THREE.Matrix4().compose(new THREE.Vector3(x, top + 0.3, y), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, (Math.floor(r * 4) * Math.PI) / 2, 0)), new THREE.Vector3(0.8, 0.6, 0.6)));
        }

        if (t.base === 'tree') {
          const mush = hash(i * 13) < 0.18;
          const tk = mush ? (hash(i * 17) < 0.5 ? 'mushroomRed' : 'mushroomTan') : TREES[Math.floor(hash(i * 5) * TREES.length)];
          const tm = model(tk, mush ? 'alienMushroom' : 'alienTree', Math.floor(hash(i * 11) * 4));
          const jx = x + (r - 0.5) * 0.2;
          const jz = y + (hash(i + 7) - 0.5) * 0.2;
          if (put(tm, tm && place(tm, jx, top, jz, { h: mush ? 0.9 + r * 0.6 : 1.25 + r * 0.6, rot: hash(i + 3) * 6.28 }))) continue;
          const s = 0.75 + r * 0.4;
          trees.push(new THREE.Matrix4().compose(new THREE.Vector3(x + (r - 0.5) * 0.2, top + 0.9 * s, y + (hash(i + 7) - 0.5) * 0.2), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, r * 6, 0)), new THREE.Vector3(s, s * 1.15, s)));
          trunks.push(new THREE.Matrix4().compose(new THREE.Vector3(x, top + 0.3, y), new THREE.Quaternion(), new THREE.Vector3(1, 1, 1)));
        }
        if (t.base === 'rock') {
          const rk = ROCKS[Math.floor(hash(i * 19) * ROCKS.length)];
          const rm = model(rk, 'rock', Math.floor(hash(i * 23) * 3));
          if (put(rm, rm && place(rm, x, top, y, { h: 0.95 + r * 0.45, maxW: 1.0, rot: hash(i + 5) * 6.28 }))) {
            // fall through to growth/rubble below
          } else {
          const s = 0.85 + r * 0.35;
          rocks.push(new THREE.Matrix4().compose(new THREE.Vector3(x, top + 0.35 * s, y), new THREE.Quaternion().setFromEuler(new THREE.Euler(r * 3, hash(i + 3) * 6, hash(i + 5) * 3)), new THREE.Vector3(s * 0.75, s * 0.75 + hash(i + 11) * 0.5, s * 0.75)));
          }
        }
        // Small alien plants on open ground away from the colony, and lilies on the river.
        const open = (t.base === 'ground' || t.base === 'sand') && !t.structure && !t.buildingId && !t.growth;
        if (open && chebyshev({ x, y }, CENTER) > COLONY_RADIUS && hash(i * 29) < 0.07) {
          const pk: FileKey = hash(i * 31) < 0.5 ? 'bush' : 'leafs';
          const pm = model(pk, 'alienPlant', Math.floor(hash(i * 37) * 3));
          put(pm, pm && place(pm, x + (hash(i * 41) - 0.5) * 0.5, top, y + (hash(i * 43) - 0.5) * 0.5, { w: 0.4 + hash(i * 47) * 0.3, rot: hash(i * 53) * 6.28 }));
        }
        if (t.base === 'water' && hash(i * 59) < 0.12) {
          const lm = model('lily', 'alienLily');
          put(lm, lm && place(lm, x + (hash(i * 61) - 0.5) * 0.4, WATER_LEVEL + 0.01, y + (hash(i * 67) - 0.5) * 0.4, { w: 0.45 + hash(i * 71) * 0.3, rot: hash(i * 73) * 6.28 }));
        }
        if (t.growth) {
          const v = Math.floor(r * 3);
          thorns[v].push(new THREE.Matrix4().compose(new THREE.Vector3(x, top, y), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, hash(i + 9) * 6.28, 0)), new THREE.Vector3(1, 0.8 + r * 0.5, 1)));
        }
        if (t.rubble && !t.buildingId) {
          for (let k = 0; k < 3; k++) {
            const a = hash(i * 3 + k);
            rubble.push(new THREE.Matrix4().compose(new THREE.Vector3(x + (a - 0.5) * 0.7, top + 0.08, y + (hash(i * 5 + k) - 0.5) * 0.7), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, a * 6, 0)), new THREE.Vector3(0.18 + a * 0.2, 0.12 + a * 0.12, 0.15 + a * 0.15)));
          }
        }
      }
    }
    tiles.instanceMatrix.needsUpdate = true;
    if (tiles.instanceColor) tiles.instanceColor.needsUpdate = true;
    this.tileMesh = tiles;
    this.terrain.add(tiles);

    // Landing apron grid: straight, human.
    if (padMin.x !== Infinity) {
      const g = new THREE.BufferGeometry();
      const pts: number[] = [];
      for (let x = padMin.x; x <= padMax.x + 1; x++) pts.push(x - 0.5, 0.012, padMin.y - 0.5, x - 0.5, 0.012, padMax.y + 0.5);
      for (let y = padMin.y; y <= padMax.y + 1; y++) pts.push(padMin.x - 0.5, 0.012, y - 0.5, padMax.x + 0.5, 0.012, y - 0.5);
      g.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      this.terrain.add(new THREE.LineSegments(g, new THREE.LineBasicMaterial({ color: PAL.padLine, transparent: true, opacity: 0.45 })));
    }
    const surface = new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2);
    this.addInstanced(surface, new THREE.MeshStandardMaterial({ color: PAL.water, roughness: 0.15, metalness: 0.1, transparent: true, opacity: 0.82 }), water, false);
    this.addInstanced(surface, new THREE.MeshStandardMaterial({ color: PAL.ford, roughness: 0.2, transparent: true, opacity: 0.6 }), shallows, false);
    this.addInstanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: PAL.crate, roughness: 0.6 }), crates);
    this.addInstanced(new THREE.IcosahedronGeometry(0.55, 1), new THREE.MeshStandardMaterial({ color: PAL.canopy, roughness: 0.9, flatShading: true }), trees);
    this.addInstanced(new THREE.CylinderGeometry(0.07, 0.11, 0.6, 6), new THREE.MeshStandardMaterial({ color: PAL.trunk, roughness: 1 }), trunks);
    this.addInstanced(new THREE.DodecahedronGeometry(0.6, 1), new THREE.MeshStandardMaterial({ color: PAL.rock, roughness: 1, flatShading: true }), rocks);
    const thornMat = new THREE.MeshStandardMaterial({ color: PAL.thorn, roughness: 0.6, emissive: PAL.thorn, emissiveIntensity: 0.15 });
    for (let v = 0; v < 3; v++) this.addInstanced(thornGeometry(v), thornMat, thorns[v]);
    this.addInstanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial({ color: PAL.rubble, roughness: 1 }), rubble);

    // Structures.
    for (let y = 0; y < map.h; y++) {
      for (let x = 0; x < map.w; x++) {
        const t = tileAt(map, x, y);
        if (!t.structure || t.structure.kind === 'crate') continue;
        const top = t.elevation * ELEV;
        const tall = t.structure.kind === 'wall' ? 1.15 : 0.5;
        const overgrown = t.structure.overgrowth >= 2;
        const wallModel = model('wall', overgrown ? 'overgrownWall' : 'colonyWall');
        if (wallModel) {
          const ax = this.hasWall(c, x - 1, y) || this.hasWall(c, x + 1, y);
          const az = this.hasWall(c, x, y - 1) || this.hasWall(c, x, y + 1);
          const thick = t.structure.kind === 'wall' ? 0.42 : 0.36;
          if (ax || !az) put(wallModel, place(wallModel, x, top, y, { dims: [1.0, tall, thick] }));
          if (az) put(wallModel, place(wallModel, x, top, y, { dims: [1.0, tall, thick], rot: Math.PI / 2 }));
          if (t.structure.overgrowth > 0) {
            const vine = new THREE.Mesh(thornGeometry(Math.floor(hash(x * 41 + y) * 3)), thornMat);
            vine.position.set(x, top + tall * 0.6, y);
            vine.scale.set(0.9, 0.5 + t.structure.overgrowth * 0.15, 0.9);
            this.terrain.add(vine);
          }
          continue;
        }
        const mat = new THREE.MeshStandardMaterial({ color: overgrown ? PAL.wallOvergrown : PAL.wall, roughness: 0.8 });
        // Join to neighbouring walls so lines read as lines.
        const wx = this.hasWall(c, x - 1, y) || this.hasWall(c, x + 1, y);
        const wz = this.hasWall(c, x, y - 1) || this.hasWall(c, x, y + 1);
        const sx = wx || !wz ? 1 : 0.3;
        const sz = wz || !wx ? 1 : 0.3;
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(wx && !wz ? 1 : sx, tall, wz && !wx ? 1 : sz), mat);
        if (!wx && !wz) mesh.scale.set(0.8, 1, 0.8);
        mesh.position.set(x, top + tall / 2, y);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        this.terrain.add(mesh);
        if (t.structure.overgrowth > 0) {
          const vine = new THREE.Mesh(thornGeometry(Math.floor(hash(x * 41 + y) * 3)), thornMat);
          vine.position.set(x, top + tall * 0.6, y);
          vine.scale.set(0.9, 0.5 + t.structure.overgrowth * 0.15, 0.9);
          this.terrain.add(vine);
        }
      }
    }

    for (const b of c.buildings) if (!b.destroyed) this.terrain.add(buildingMesh(c, b, this.assets));
    for (const [m, mats] of buckets) {
      for (const im of instanced(m, mats)) {
        im.userData.shared = true;
        this.terrain.add(im);
      }
    }
  }

  private hasWall(c: Campaign, x: number, y: number): boolean {
    const st = inBounds(c.map, x, y) ? tileAt(c.map, x, y).structure : null;
    return !!st && st.kind !== 'crate';
  }

  private addInstanced(geo: THREE.BufferGeometry, mat: THREE.Material, mats: THREE.Matrix4[], shadows = true) {
    if (!mats.length) return;
    const m = new THREE.InstancedMesh(geo, mat, mats.length);
    mats.forEach((x, i) => m.setMatrixAt(i, x));
    m.castShadow = shadows;
    m.receiveShadow = true;
    this.terrain.add(m);
  }

  // ---------------------------------------------------------------- units

  sync(c: Campaign) {
    const b = c.battle;
    const seen = new Set<string>();
    if (b) {
      for (const u of b.units) {
        seen.add(u.colonistId);
        const col = c.colonists.find((x) => x.id === u.colonistId)!;
        let g = this.units.get(u.colonistId);
        if (!g) {
          g = colonistMesh(col.role, col.retired, this.assets);
          g.userData.kind = 'colonist';
          this.scene.add(g);
          this.units.set(u.colonistId, g);
          this.addLabel(u.colonistId, g, 1.35);
        }
        g.userData.tile = { ...u.pos };
        g.position.copy(this.world(c, u.pos));
        const body = g.getObjectByName('figure')!;
        body.rotation.z = u.downed ? Math.PI / 2 : 0;
        body.position.y = u.downed ? 0.2 : 0;
        const ow = g.getObjectByName('overwatch')!;
        ow.visible = u.overwatch;
      }
      for (const k of b.creatures) {
        if (!k.alive || !k.arrived) continue;
        seen.add(k.id);
        let g = this.units.get(k.id);
        if (!g) {
          g = creatureMesh(k);
          g.userData.kind = 'creature';
          this.scene.add(g);
          this.units.set(k.id, g);
          this.addLabel(k.id, g, k.species === 'grazer' ? 0.9 : 1.0);
        }
        g.userData.tile = { ...k.pos };
        g.position.copy(this.world(c, k.pos));
        setBurrowed(g, k.burrowed);
      }
    }
    for (const [id, g] of this.units) {
      if (seen.has(id)) continue;
      this.scene.remove(g);
      this.units.delete(id);
      this.removeLabel(id);
    }
    this.refreshLabels(c);
  }

  clearUnits() {
    for (const [id, g] of this.units) {
      this.scene.remove(g);
      this.removeLabel(id);
    }
    this.units.clear();
  }

  // ---------------------------------------------------------------- labels (HP pips)

  private addLabel(id: string, obj: THREE.Object3D, dy: number) {
    const el = document.createElement('div');
    el.className = 'unit-label';
    this.labelLayer.appendChild(el);
    this.labels.set(id, { el, obj, dy });
  }

  private removeLabel(id: string) {
    const l = this.labels.get(id);
    if (l) l.el.remove();
    this.labels.delete(id);
  }

  refreshLabels(c: Campaign) {
    const b = c.battle;
    if (!b) return;
    for (const [id, l] of this.labels) {
      const k = b.creatures.find((x) => x.id === id);
      if (k) {
        if (k.burrowed) {
          l.el.innerHTML = '<span class="tag">underground</span>';
          continue;
        }
        const flags = [k.slowed ? 'slowed' : '', k.blinded > 0 ? 'blind' : '', k.burning ? 'burning' : ''].filter(Boolean);
        l.el.innerHTML = pips(k.hp, k.maxHp, 'world') + (flags.length ? `<span class="tag">${flags.join(' · ')}</span>` : '');
        continue;
      }
      const u = b.units.find((x) => x.colonistId === id);
      const col = c.colonists.find((x) => x.id === id);
      if (u && col) {
        const status = u.downed ? `<span class="tag danger">${u.stabilized ? 'stable' : `bleeding ${u.bleed}`}</span>` : u.overwatch ? '<span class="tag">overwatch</span>' : '';
        l.el.innerHTML = pips(col.hp, col.maxHp, 'colony') + status;
      }
    }
  }

  private updateLabels(dt: number) {
    const w = this.renderer.domElement.clientWidth;
    const h = this.renderer.domElement.clientHeight;
    const v = new THREE.Vector3();
    for (const l of this.labels.values()) {
      l.obj.getWorldPosition(v);
      v.y += l.dy;
      v.project(this.camera);
      const visible = v.z < 1 && Math.abs(v.x) < 1.1 && Math.abs(v.y) < 1.1 && l.obj.visible;
      l.el.style.display = visible ? '' : 'none';
      l.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -100%)`;
    }
    for (const f of [...this.floaters]) {
      f.t += dt * this.speed;
      v.copy(f.pos);
      v.y += f.t * 0.8;
      v.project(this.camera);
      f.el.style.transform = `translate(${((v.x + 1) / 2) * w}px, ${((1 - v.y) / 2) * h}px) translate(-50%, -100%)`;
      f.el.style.opacity = String(Math.max(0, 1 - f.t / 1.4));
      if (f.t > 1.4) {
        f.el.remove();
        this.floaters.splice(this.floaters.indexOf(f), 1);
      }
    }
  }

  float(text: string, pos: THREE.Vector3, cls: string) {
    const el = document.createElement('div');
    el.className = `floater ${cls}`;
    el.textContent = text;
    this.labelLayer.appendChild(el);
    this.floaters.push({ el, pos: pos.clone(), t: 0 });
  }

  // ---------------------------------------------------------------- overlay

  setOverlay(c: Campaign, o: OverlaySpec) {
    for (const ch of [...this.overlay.children]) {
      this.overlay.remove(ch);
      (ch as THREE.Mesh).geometry?.dispose();
    }
    const quad = new THREE.PlaneGeometry(0.92, 0.92).rotateX(-Math.PI / 2);
    const addTiles = (tiles: Vec[] | undefined, color: number, opacity: number, lift = 0.03) => {
      if (!tiles?.length) return;
      const m = new THREE.InstancedMesh(quad, new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false }), tiles.length);
      tiles.forEach((p, i) => m.setMatrixAt(i, new THREE.Matrix4().setPosition(p.x, this.height(c, p) + lift, p.y)));
      m.renderOrder = 2;
      this.overlay.add(m);
    };
    addTiles(o.zone, PAL.zone, 0.12);
    addTiles(o.dash, PAL.dash, 0.28);
    addTiles(o.walk, PAL.walk, 0.32);
    addTiles(o.area, o.areaValid === false ? PAL.retired : PAL.danger, 0.4, 0.05);
    if (o.footprint) addTiles(o.footprint.tiles, o.footprint.valid ? PAL.zone : PAL.danger, 0.5, 0.05);
    addTiles(o.marks, PAL.buildingTrim, 0.35, 0.05);
    if (o.preview) addTiles(o.preview.tiles, o.preview.valid ? PAL.zone : PAL.danger, 0.55, 0.06);
    addTiles(o.incoming, PAL.danger, 0.3, 0.04);
    if (o.outline) {
      const { x0, y0, x1, y1 } = o.outline;
      const pts = [
        new THREE.Vector3(x0 - 0.5, 0.06, y0 - 0.5), new THREE.Vector3(x1 + 0.5, 0.06, y0 - 0.5),
        new THREE.Vector3(x1 + 0.5, 0.06, y1 + 0.5), new THREE.Vector3(x0 - 0.5, 0.06, y1 + 0.5), new THREE.Vector3(x0 - 0.5, 0.06, y0 - 0.5),
      ];
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineDashedMaterial({ color: PAL.walk, dashSize: 0.5, gapSize: 0.25, depthTest: false }));
      line.computeLineDistances();
      line.renderOrder = 4;
      this.overlay.add(line);
    }

    const square = (p: Vec, color: number, size: number, lift: number) => {
      const s = size / 2;
      const g = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(-s, 0, -s), new THREE.Vector3(s, 0, -s), new THREE.Vector3(s, 0, s), new THREE.Vector3(-s, 0, s), new THREE.Vector3(-s, 0, -s),
      ]);
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ color, depthTest: false }));
      line.position.copy(this.world(c, p, lift));
      line.renderOrder = 5;
      this.overlay.add(line);
    };
    if (o.hover) square(o.hover, PAL.select, 0.96, 0.05);
    if (o.selected) square(o.selected, PAL.buildingTrim, 0.8, 0.06);
    for (const t of o.targets ?? []) square(t, PAL.danger, 0.9, 0.06);

    if (o.path && o.path.length > 1) {
      const pts = o.path.map((p) => this.world(c, p, 0.12));
      const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints(pts), new THREE.LineBasicMaterial({ color: PAL.select, depthTest: false }));
      line.renderOrder = 6;
      this.overlay.add(line);
    }

    if (o.cover) this.coverShields(c, o.cover);
  }

  private coverShields(c: Campaign, p: Vec) {
    const here = tileAt(c.map, p.x, p.y);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const x = p.x + dx;
      const y = p.y + dy;
      if (!inBounds(c.map, x, y)) continue;
      const t = tileAt(c.map, x, y);
      let lvl = 0;
      if (t.base === 'rock' || t.buildingId || t.structure?.kind === 'wall' || t.elevation > here.elevation) lvl = 2;
      else if (t.structure || t.base === 'tree' || t.growth || t.rubble) lvl = 1;
      if (t.structure && t.structure.overgrowth >= 2) lvl = Math.max(0, lvl - 1);
      if (!lvl) continue;
      const h = lvl === 2 ? 0.7 : 0.35;
      const plate = new THREE.Mesh(
        new THREE.PlaneGeometry(0.6, h),
        new THREE.MeshBasicMaterial({ color: lvl === 2 ? PAL.walk : PAL.dash, transparent: true, opacity: 0.75, side: THREE.DoubleSide, depthTest: false }),
      );
      plate.position.copy(this.world(c, p, h / 2 + 0.05)).add(new THREE.Vector3(dx * 0.45, 0, dy * 0.45));
      plate.rotation.y = dx !== 0 ? Math.PI / 2 : 0;
      plate.renderOrder = 7;
      this.overlay.add(plate);
    }
  }

  // ---------------------------------------------------------------- playback

  async play(c: Campaign, events: BattleEvent[], onStep?: (e: BattleEvent) => void) {
    for (const e of events) {
      onStep?.(e);
      switch (e.t) {
        case 'move': {
          const g = this.units.get(e.id);
          if (!g) break;
          for (let i = 1; i < e.path.length; i++) {
            const a = this.world(c, e.path[i - 1]);
            const b = this.world(c, e.path[i]);
            const ang = Math.atan2(b.x - a.x, b.z - a.z);
            if (g.userData.kind === 'creature') g.rotation.y = ang;
            await this.tween(0.09, (k) => {
              g.position.lerpVectors(a, b, k);
              g.position.y += Math.sin(k * Math.PI) * 0.08;
            });
          }
          g.userData.tile = { ...e.path[e.path.length - 1] };
          break;
        }
        case 'arrive': {
          const k = c.battle?.creatures.find((x) => x.id === e.id);
          if (!k || this.units.has(e.id)) break;
          const g = creatureMesh(k);
          g.userData.kind = 'creature';
          g.userData.tile = { ...e.at };
          g.position.copy(this.world(c, e.at));
          setBurrowed(g, k.burrowed);
          this.scene.add(g);
          this.units.set(e.id, g);
          this.addLabel(e.id, g, k.species === 'grazer' ? 0.9 : 1.0);
          break;
        }
        case 'surface': {
          const g = this.units.get(e.id);
          if (!g) break;
          g.position.copy(this.world(c, e.at));
          g.userData.tile = { ...e.at };
          setBurrowed(g, false);
          await this.tween(0.35, (k) => (g.position.y = this.height(c, e.at) - 0.6 * (1 - k)));
          break;
        }
        case 'shot':
        case 'strike': {
          const from = this.units.get(e.from);
          const to = this.units.get(e.to);
          if (!from || !to) break;
          const a = from.position.clone().add(new THREE.Vector3(0, 0.75, 0));
          const b = to.position.clone().add(new THREE.Vector3(0, 0.45, 0));
          if (!e.hit) b.add(new THREE.Vector3((Math.random() - 0.5) * 1.2, 0.3, (Math.random() - 0.5) * 1.2));
          const isColony = e.t === 'shot';
          const melee = e.t === 'strike' ? e.kind !== 'quills' : WEAPONS[e.weapon].melee;
          if (melee) {
            const home = from.position.clone();
            const lunge = from.position.clone().lerp(to.position, 0.45);
            await this.tween(0.12, (k) => from.position.lerpVectors(home, lunge, k));
            await this.tween(0.12, (k) => from.position.lerpVectors(lunge, home, k));
          } else {
            const line = new THREE.Line(new THREE.BufferGeometry().setFromPoints([a, b]), new THREE.LineBasicMaterial({ color: isColony ? 0xffe2a8 : PAL.thornTip, transparent: true }));
            this.fx.add(line);
            await this.tween(0.22, (k) => ((line.material as THREE.LineBasicMaterial).opacity = 1 - k));
            this.fx.remove(line);
            line.geometry.dispose();
          }
          this.float(e.hit ? (e.damage >= 99 ? 'kill' : `-${e.damage}`) : 'miss', to.position.clone().add(new THREE.Vector3(0, 1.1, 0)), e.hit ? (isColony ? 'hit-world' : 'hit-colony') : 'miss');
          await this.wait(0.12);
          break;
        }
        case 'area': {
          const center = this.world(c, e.at, 0.3);
          const color = e.weapon === 'flamer' ? 0xff8a2a : 0xfff0c0;
          const ball = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.8 }));
          ball.position.copy(center);
          this.fx.add(ball);
          await this.tween(0.4, (k) => {
            ball.scale.setScalar(0.2 + k * (e.radius + 0.6));
            (ball.material as THREE.MeshBasicMaterial).opacity = 0.8 * (1 - k);
          });
          this.fx.remove(ball);
          ball.geometry.dispose();
          break;
        }
        case 'gnaw': {
          const g = this.units.get(e.from);
          if (g) {
            const home = g.position.clone();
            await this.tween(0.2, (k) => (g.position.y = home.y + Math.sin(k * Math.PI) * 0.2));
            this.float(`-${e.damage}`, home.clone().add(new THREE.Vector3(0, 1.2, 0)), 'hit-colony');
          }
          break;
        }
        case 'damage':
          break;
        case 'death': {
          const g = this.units.get(e.id);
          if (!g) break;
          g.userData.dead = true;
          this.removeLabel(e.id);
          const y0 = g.position.y;
          await this.tween(0.45, (k) => {
            g.position.y = y0 - k * 0.6;
            g.scale.setScalar(1 - k * 0.5);
          });
          this.scene.remove(g);
          this.units.delete(e.id);
          break;
        }
        case 'downed': {
          const g = this.units.get(e.id);
          const fig = g?.getObjectByName('figure');
          if (fig) await this.tween(0.3, (k) => {
            fig.rotation.z = (k * Math.PI) / 2;
            fig.position.y = k * 0.2;
          });
          break;
        }
        case 'destroyed':
        case 'terrain':
          this.buildTerrain(c);
          break;
        case 'log':
          await this.wait(0.04);
          break;
        default:
          break;
      }
    }
    this.sync(c);
  }
}

// ---------------------------------------------------------------- meshes

function pips(hp: number, max: number, side: 'colony' | 'world'): string {
  let s = `<span class="pips ${side}">`;
  for (let i = 0; i < max; i++) s += `<i class="${i < hp ? 'on' : ''}"></i>`;
  return s + '</span>';
}

/** Curved thorn growth: a few tubes arcing up out of the ground. */
function thornGeometry(variant: number): THREE.BufferGeometry {
  const geos: THREE.BufferGeometry[] = [];
  const count = 4 + variant;
  for (let i = 0; i < count; i++) {
    const a = (i / count) * Math.PI * 2 + variant;
    const r = 0.15 + hash(variant * 31 + i) * 0.25;
    const h = 0.35 + hash(variant * 17 + i) * 0.35;
    const curve = new THREE.CatmullRomCurve3([
      new THREE.Vector3(Math.cos(a) * r, 0, Math.sin(a) * r),
      new THREE.Vector3(Math.cos(a) * (r + 0.1), h * 0.6, Math.sin(a) * (r + 0.1)),
      new THREE.Vector3(Math.cos(a + 0.8) * (r + 0.22), h, Math.sin(a + 0.8) * (r + 0.22)),
      new THREE.Vector3(Math.cos(a + 1.4) * (r + 0.18), h * 0.75, Math.sin(a + 1.4) * (r + 0.18)),
    ]);
    geos.push(new THREE.TubeGeometry(curve, 10, 0.035, 5, false));
  }
  return mergeGeometries(geos);
}

function mergeGeometries(geos: THREE.BufferGeometry[]): THREE.BufferGeometry {
  const pos: number[] = [];
  const nor: number[] = [];
  const idx: number[] = [];
  let off = 0;
  for (const g of geos) {
    const p = g.getAttribute('position');
    const n = g.getAttribute('normal');
    for (let i = 0; i < p.count; i++) {
      pos.push(p.getX(i), p.getY(i), p.getZ(i));
      nor.push(n.getX(i), n.getY(i), n.getZ(i));
    }
    const index = g.getIndex();
    if (index) for (let i = 0; i < index.count; i++) idx.push(index.getX(i) + off);
    off += p.count;
    g.dispose();
  }
  const out = new THREE.BufferGeometry();
  out.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  out.setAttribute('normal', new THREE.Float32BufferAttribute(nor, 3));
  out.setIndex(idx);
  return out;
}

/**
 * A matrix that stands a model on (x, baseY, z): centred, its base on the ground, turned by
 * `rot`. Size by height (`h`, optionally capped by `maxW`), by footprint (`w`), or per axis (`dims`).
 */
function place(m: Model, x: number, baseY: number, z: number, o: { h?: number; w?: number; maxW?: number; dims?: [number, number, number]; rot?: number }): THREE.Matrix4 {
  const size = m.box.getSize(new THREE.Vector3());
  const c = m.box.getCenter(new THREE.Vector3());
  let sx = 1;
  let sy = 1;
  let sz = 1;
  if (o.dims) {
    sx = o.dims[0] / Math.max(1e-3, size.x);
    sy = o.dims[1] / Math.max(1e-3, size.y);
    sz = o.dims[2] / Math.max(1e-3, size.z);
  } else {
    let k = o.h ? o.h / Math.max(1e-3, size.y) : o.w ? o.w / Math.max(1e-3, size.x, size.z) : 1;
    if (o.maxW) k = Math.min(k, o.maxW / Math.max(1e-3, size.x, size.z));
    sx = sy = sz = k;
  }
  return new THREE.Matrix4()
    .makeTranslation(x, baseY, z)
    .multiply(new THREE.Matrix4().makeRotationY(o.rot ?? 0))
    .multiply(new THREE.Matrix4().makeScale(sx, sy, sz))
    .multiply(new THREE.Matrix4().makeTranslation(-c.x, -m.box.min.y, -c.z));
}

/** A single placed model as a group of meshes. */
function placed(m: Model, o: Parameters<typeof place>[4] & { x?: number; y?: number; z?: number }): THREE.Group {
  const g = modelObject(m);
  g.applyMatrix4(place(m, o.x ?? 0, o.y ?? 0, o.z ?? 0, o));
  return g;
}

function buildingMesh(c: Campaign, b: Building, assets: Assets | null): THREE.Group {
  const g = new THREE.Group();
  const top = tileAt(c.map, b.pos.x, b.pos.y).elevation * ELEV;
  const cx = b.pos.x + (b.size - 1) / 2;
  const cz = b.pos.y + (b.size - 1) / 2;
  g.position.set(cx, top, cz);
  const shell = assets?.get(b.kind === 'habitat' ? 'habitat' : b.kind === 'workshop' ? 'hangarB' : 'hangarA');
  if (shell) {
    // Kenney hangars: the door faces south. Roof equipment says what the building is.
    const w = b.size - 0.1;
    const h = b.kind === 'habitat' ? 1.5 : 1.15;
    g.add(placed(shell, { dims: [w, h, w] }));
    const roof = (k: FileKey, o: Parameters<typeof placed>[1]) => {
      const m = assets!.get(k);
      if (m) g.add(placed(m, { ...o, y: h - 0.05 }));
    };
    if (b.kind === 'habitat') {
      roof('antenna', { h: 0.55, x: 0.7, z: -0.6 });
      roof('dish', { h: 0.6, x: -0.7, z: -0.5, rot: 0.6 });
    }
    if (b.kind === 'lab') roof('dish', { h: 0.7, z: -0.1, rot: -0.5 });
    if (b.kind === 'workshop') roof('generator', { h: 0.45, rot: Math.PI / 2 });
    if (b.kind === 'infirmary') {
      const trim = new THREE.MeshStandardMaterial({ color: PAL.buildingTrim, roughness: 0.6 });
      for (const [bw, bd] of [[0.9, 0.25], [0.25, 0.9]]) {
        const bar = new THREE.Mesh(new THREE.BoxGeometry(bw, 0.12, bd), trim);
        bar.position.set(0, h + 0.03, 0);
        bar.castShadow = true;
        g.add(bar);
      }
    }
    return g;
  }
  const body = new THREE.MeshStandardMaterial({ color: PAL.building, roughness: 0.7 });
  const trim = new THREE.MeshStandardMaterial({ color: PAL.buildingTrim, roughness: 0.6 });
  const dark = new THREE.MeshStandardMaterial({ color: PAL.buildingDark, roughness: 0.6 });
  const s = b.size - 0.15;
  const h = b.kind === 'habitat' ? 1.6 : 1.3;
  const box = (w: number, hh: number, d: number, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, hh, d), m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
    return mesh;
  };
  box(s, h, s, body, 0, h / 2, 0);
  box(s + 0.1, 0.1, s + 0.1, dark, 0, h + 0.05, 0);
  box(s + 0.02, 0.12, s + 0.02, trim, 0, h * 0.62, 0);
  box(0.4, 0.7, 0.05, dark, 0, 0.35, s / 2 + 0.01);
  switch (b.kind) {
    case 'habitat':
      // A long module with a window band, an airlock, a mast and solar panels.
      box(s + 0.04, 0.16, s + 0.04, dark, 0, h * 0.8, 0);
      box(0.9, 0.9, 0.5, body, 0, 0.45, s / 2 + 0.25);
      box(0.5, 0.65, 0.05, dark, 0, 0.33, s / 2 + 0.51);
      box(0.08, 1.4, 0.08, trim, s / 2 - 0.3, h + 0.7, -s / 2 + 0.3);
      for (const z of [-0.6, 0.6]) {
        const panel = box(1.1, 0.04, 0.7, dark, -s / 2 - 0.05, h + 0.35, z);
        panel.rotation.z = 0.35;
      }
      break;
    case 'lab':
      box(0.9, 0.35, 0.9, dark, 0.25, h + 0.25, -0.25);
      box(0.06, 0.9, 0.06, trim, -0.45, h + 0.5, 0.45);
      break;
    case 'infirmary':
      box(0.9, 0.2, 0.25, trim, 0, h + 0.2, 0);
      box(0.25, 0.2, 0.9, trim, 0, h + 0.2, 0);
      break;
    case 'workshop':
      box(0.35, 0.8, 0.35, dark, 0.5, h + 0.4, 0.5);
      box(1.2, 0.08, 0.5, trim, -0.2, h + 0.15, -0.4);
      break;
  }
  return g;
}

/** The gun each role carries, from the Blaster Kit, and how long it is drawn. */
const GUNS: Record<keyof typeof ROLES, { key: FileKey; length: number }> = {
  rifleman: { key: 'gunRifle', length: 0.55 },
  marksman: { key: 'gunLong', length: 0.75 },
  engineer: { key: 'gunFlamer', length: 0.5 },
  xenobiologist: { key: 'gunPistol', length: 0.3 },
};

function colonistMesh(role: keyof typeof ROLES, retired: boolean, assets: Assets | null): THREE.Group {
  const g = new THREE.Group();
  const fig = new THREE.Group();
  fig.name = 'figure';
  const roleColor = retired ? PAL.retired : PAL[role];
  const suit = new THREE.MeshStandardMaterial({ color: 0xd9d4c8, roughness: 0.7 });
  const band = new THREE.MeshStandardMaterial({ color: roleColor, roughness: 0.5, emissive: roleColor, emissiveIntensity: 0.15 });
  const dark = new THREE.MeshStandardMaterial({ color: PAL.buildingDark, roughness: 0.6 });
  const add = (geo: THREE.BufferGeometry, m: THREE.Material, x: number, y: number, z: number) => {
    const mesh = new THREE.Mesh(geo, m);
    mesh.position.set(x, y, z);
    mesh.castShadow = true;
    fig.add(mesh);
  };
  add(new THREE.BoxGeometry(0.16, 0.38, 0.16), dark, -0.1, 0.19, 0);
  add(new THREE.BoxGeometry(0.16, 0.38, 0.16), dark, 0.1, 0.19, 0);
  add(new THREE.BoxGeometry(0.42, 0.42, 0.26), suit, 0, 0.6, 0);
  add(new THREE.BoxGeometry(0.44, 0.12, 0.28), band, 0, 0.66, 0);
  add(new THREE.BoxGeometry(0.24, 0.24, 0.24), suit, 0, 0.95, 0);
  add(new THREE.BoxGeometry(0.2, 0.07, 0.03), band, 0, 0.97, 0.13);
  const gun = assets?.get(GUNS[role].key, 'colonyGun');
  if (gun) {
    // Held at the hip, pointing forward (+z).
    const size = gun.box.getSize(new THREE.Vector3());
    const gm = placed(gun, { w: GUNS[role].length * Math.max(size.x, size.z) / size.z, x: 0.27, y: 0.48, z: 0.12 });
    gm.name = 'gun';
    fig.add(gm);
  } else {
    // Rifle: a straight bar.
    add(new THREE.BoxGeometry(0.06, 0.06, 0.5), dark, 0.25, 0.6, 0.15);
  }
  g.add(fig);
  // Overwatch: a square bracket floating above the head.
  const ow = new THREE.LineSegments(
    new THREE.EdgesGeometry(new THREE.BoxGeometry(0.34, 0.02, 0.34)),
    new THREE.LineBasicMaterial({ color: PAL.walk }),
  );
  ow.name = 'overwatch';
  ow.position.y = 1.25;
  ow.visible = false;
  g.add(ow);
  return g;
}

function creatureMesh(k: Creature): THREE.Group {
  const g = new THREE.Group();
  const body = new THREE.Group();
  body.name = 'body';
  const color = SPECIES[k.species].id === 'grazer' ? PAL.grazer : PAL.rootcrawler;
  const skin = new THREE.MeshStandardMaterial({ color, roughness: 0.55 });
  const glow = new THREE.MeshStandardMaterial({ color: PAL.senseGlow, emissive: PAL.senseGlow, emissiveIntensity: 0.9 });
  if (k.species === 'grazer') {
    const torso = new THREE.Mesh(new THREE.SphereGeometry(0.3, 16, 12), skin);
    torso.scale.set(0.9, 0.75, 1.4);
    torso.position.y = 0.38;
    torso.castShadow = true;
    body.add(torso);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 10), skin);
    head.position.set(0, 0.45, 0.42);
    body.add(head);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.06, 8, 6), glow);
    eye.position.set(0, 0.5, 0.55);
    body.add(eye);
    for (let i = 0; i < 5; i++) {
      const curve = new THREE.QuadraticBezierCurve3(
        new THREE.Vector3(0, 0.5, -0.25 + i * 0.12),
        new THREE.Vector3(0, 0.75, -0.3 + i * 0.12),
        new THREE.Vector3(0, 0.72, -0.5 + i * 0.1),
      );
      const spine = new THREE.Mesh(new THREE.TubeGeometry(curve, 6, 0.025, 4), new THREE.MeshStandardMaterial({ color: PAL.thornTip }));
      body.add(spine);
    }
    for (const [x, z] of [[-0.18, 0.2], [0.18, 0.2], [-0.18, -0.25], [0.18, -0.25]]) {
      const leg = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.22, 4, 6), skin);
      leg.position.set(x, 0.14, z);
      body.add(leg);
    }
  } else {
    for (let i = 0; i < 4; i++) {
      const seg = new THREE.Mesh(new THREE.SphereGeometry(0.3 - i * 0.05, 14, 10), skin);
      seg.position.set(0, 0.32 - i * 0.04, 0.3 - i * 0.28);
      seg.castShadow = true;
      body.add(seg);
    }
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.22, 0.05, 8, 16, Math.PI * 1.4), new THREE.MeshStandardMaterial({ color: PAL.thorn }));
    ring.position.set(0, 0.42, 0.42);
    ring.rotation.y = Math.PI / 2;
    body.add(ring);
    const eye = new THREE.Mesh(new THREE.SphereGeometry(0.07, 8, 6), glow);
    eye.position.set(0, 0.42, 0.55);
    body.add(eye);
  }
  g.add(body);
  const mound = new THREE.Mesh(
    new THREE.SphereGeometry(0.45, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2),
    new THREE.MeshStandardMaterial({ color: PAL.mound, roughness: 1, transparent: true, opacity: 0.85 }),
  );
  mound.scale.y = 0.35;
  mound.name = 'mound';
  mound.visible = false;
  g.add(mound);
  return g;
}

function setBurrowed(g: THREE.Group, burrowed: boolean) {
  const body = g.getObjectByName('body');
  const mound = g.getObjectByName('mound');
  if (body) body.visible = !burrowed;
  if (mound) mound.visible = burrowed;
}
