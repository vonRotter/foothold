// Third-party models (Kenney, CC0: see CREDITS.md), loaded once at startup.
// Each model is baked to a list of parts (one merged geometry per material), so the
// scene can draw hundreds of them as instanced meshes. If a file fails to load, `get`
// returns null and the scene falls back to its own primitives.

import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { mergeGeometries, mergeVertices } from 'three/examples/jsm/utils/BufferGeometryUtils.js';
import { PAL } from './palette';

export interface Part {
  geometry: THREE.BufferGeometry;
  material: THREE.MeshStandardMaterial;
}

export interface Model {
  parts: Part[];
  box: THREE.Box3;
}

const FILES = {
  habitat: 'space-kit/hangar_largeA.glb',
  hangarA: 'space-kit/hangar_smallA.glb',
  hangarB: 'space-kit/hangar_smallB.glb',
  dish: 'space-kit/satelliteDish_detailed.glb',
  generator: 'space-kit/machine_generatorLarge.glb',
  antenna: 'space-kit/machine_wireless.glb',
  wall: 'space-station-kit/wall.glb',
  gunRifle: 'blaster-kit/blasterG.glb',
  gunLong: 'blaster-kit/blasterF.glb',
  gunPistol: 'blaster-kit/blasterB.glb',
  gunFlamer: 'blaster-kit/blasterL.glb',
  rockTallA: 'nature-kit/rock_tallA.glb',
  rockTallD: 'nature-kit/rock_tallD.glb',
  rockTallG: 'nature-kit/rock_tallG.glb',
  stoneTallB: 'nature-kit/stone_tallB.glb',
  rockSmallA: 'nature-kit/rock_smallA.glb',
  rockSmallC: 'nature-kit/rock_smallC.glb',
  rockFlat: 'nature-kit/rock_smallFlatA.glb',
  rockSlab: 'nature-kit/rock_largeA.glb',
  cliff: 'nature-kit/cliff_large_rock.glb',
  treeDefault: 'nature-kit/tree_default.glb',
  treeOak: 'nature-kit/tree_oak.glb',
  treeFat: 'nature-kit/tree_fat.glb',
  treeDetailed: 'nature-kit/tree_detailed.glb',
  treePlateau: 'nature-kit/tree_plateau.glb',
  treeThin: 'nature-kit/tree_thin.glb',
  treePalm: 'nature-kit/tree_palmBend.glb',
  mushroomRed: 'nature-kit/mushroom_redTall.glb',
  mushroomTan: 'nature-kit/mushroom_tanTall.glb',
  bush: 'nature-kit/plant_bushDetailed.glb',
  leafs: 'nature-kit/grass_leafsLarge.glb',
  lily: 'nature-kit/lily_large.glb',
} as const;

export type FileKey = keyof typeof FILES;

/** Shared clock for the world's sway shader. Advanced by the scene each frame. */
export const WORLD_TIME = { value: 0 };

export class Assets {
  private raw = new Map<FileKey, Model>();
  private derived = new Map<string, Model>();
  failed: string[] = [];

  async loadAll(onProgress?: (done: number, total: number) => void): Promise<void> {
    const loader = new GLTFLoader();
    const base = `${import.meta.env.BASE_URL}assets/kenney/`;
    const keys = Object.keys(FILES) as FileKey[];
    let done = 0;
    await Promise.all(
      keys.map(async (k) => {
        try {
          const gltf = await loader.loadAsync(base + FILES[k]);
          this.raw.set(k, bake(gltf.scene));
        } catch {
          this.failed.push(FILES[k]);
        }
        onProgress?.(++done, keys.length);
      }),
    );
    if (this.failed.length) console.warn('Models that failed to load (primitives used instead):', this.failed);
  }

  /** A model as it comes from the kit. */
  original(k: FileKey): Model | null {
    return this.raw.get(k) ?? null;
  }

  /** A model passed through a named treatment, built once and cached. */
  get(k: FileKey, treatment: Treatment = 'none', variant = 0): Model | null {
    const src = this.raw.get(k);
    if (!src) return null;
    if (treatment === 'none') return src;
    const id = `${k}|${treatment}|${variant}`;
    let m = this.derived.get(id);
    if (!m) {
      m = TREATMENTS[treatment](src, variant);
      this.derived.set(id, m);
    }
    return m;
  }
}

/** Flatten a glTF scene into one merged geometry per material, with node transforms baked in. */
function bake(root: THREE.Object3D): Model {
  root.updateMatrixWorld(true);
  const groups = new Map<string, { geos: THREE.BufferGeometry[]; mat: THREE.MeshStandardMaterial }>();
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    const geo = mesh.geometry.clone().applyMatrix4(mesh.matrixWorld);
    // Multi-material meshes: split by group.
    const pieces: [THREE.BufferGeometry, THREE.Material][] =
      mats.length === 1 || !geo.groups.length
        ? [[geo, mats[0]]]
        : geo.groups.map((g) => [subGeometry(geo, g.start, g.count), mats[g.materialIndex ?? 0]]);
    for (const [g, mat] of pieces) {
      const name = mat.name || mat.uuid;
      let e = groups.get(name);
      if (!e) {
        const m = (mat as THREE.MeshStandardMaterial).clone();
        // Kenney's metals are fully metallic; with no reflection map in the scene they
        // render black. Mostly matte reads correctly under our lights.
        m.metalness = Math.min(m.metalness ?? 0, 0.25);
        m.roughness = Math.max(m.roughness ?? 1, 0.55);
        e = { geos: [], mat: m };
        groups.set(name, e);
      }
      e.geos.push(g);
    }
  });
  const parts: Part[] = [];
  for (const { geos, mat } of groups.values()) {
    const hasUv = geos.every((g) => g.getAttribute('uv'));
    for (const g of geos) {
      for (const name of Object.keys(g.attributes)) if (name !== 'position' && name !== 'normal' && !(hasUv && name === 'uv')) g.deleteAttribute(name);
      if (!g.getAttribute('normal')) g.computeVertexNormals();
    }
    const indexed = geos.map((g) => (g.index ? g.toNonIndexed() : g));
    const merged = mergeGeometries(indexed, false) ?? indexed[0];
    parts.push({ geometry: merged, material: mat });
  }
  const box = new THREE.Box3();
  for (const p of parts) {
    p.geometry.computeBoundingBox();
    box.union(p.geometry.boundingBox!);
  }
  return { parts, box };
}

function subGeometry(geo: THREE.BufferGeometry, start: number, count: number): THREE.BufferGeometry {
  const src = geo.index ? geo.toNonIndexed() : geo;
  const out = new THREE.BufferGeometry();
  for (const [name, attr] of Object.entries(src.attributes)) {
    const a = attr as THREE.BufferAttribute;
    out.setAttribute(name, new THREE.BufferAttribute(a.array.slice(start * a.itemSize, (start + count) * a.itemSize), a.itemSize));
  }
  return out;
}

// ---------------------------------------------------------------- treatments

export type Treatment = 'none' | 'colonyGun' | 'colonyWall' | 'overgrownWall' | 'rock' | 'cliff' | 'alienTree' | 'alienMushroom' | 'alienPlant' | 'alienLily';

const TREATMENTS: Record<Exclude<Treatment, 'none'>, (m: Model, variant: number) => Model> = {
  // Human things stay human: greys and the colony's signal orange.
  colonyGun: (m) =>
    recolor(m, (name) =>
      name === 'metal' ? { color: 0xb9b7b0 } : name === 'darkMetal' ? { color: 0x55585c } : name === 'dark' ? { color: 0x2a2c2f } : { color: PAL.buildingTrim },
    ),
  colonyWall: (m) => recolor(m, () => ({ color: 0xf0ebe0 })),
  overgrownWall: (m) => recolor(m, () => ({ color: 0xc7a4bb })),
  // The world's stone: a little violet in the grey, moss where the kit has grass.
  rock: (m, v) =>
    recolor(smooth(m), (name) =>
      name === 'grass' ? { color: [0x6a3a5e, 0x4f3d63, 0x5c4a3e][v % 3] } : { color: [0x5e5560, 0x544c4a, 0x625a58][v % 3] },
    ),
  cliff: (m) => recolor(m, (name) => (name === 'grass' ? { color: 0x6e6a55 } : { color: 0x6b6058 })),
  alienTree: (m, v) => {
    const pal = TREE_PALETTES[v % TREE_PALETTES.length];
    const shaped = deform(smooth(m), { bend: pal.bend, twist: pal.twist, bulge: 0.22 });
    return sway(
      recolor(shaped, (name) =>
        name.startsWith('leafs') ? { color: pal.leaf, emissive: pal.leaf, emissiveIntensity: 0.18 } : { color: pal.bark },
      ),
      0.05,
    );
  },
  alienMushroom: (m, v) =>
    sway(
      recolor(deform(smooth(m), { bend: 0.22, twist: 0.8, bulge: 0.12 }), (name) =>
        name === '_defaultMat'
          ? { color: 0xd8d0c4 }
          : { color: v % 2 ? 0x2fb3a8 : 0xc04a8a, emissive: v % 2 ? 0x2fb3a8 : 0xc04a8a, emissiveIntensity: 0.55 },
      ),
      0.8,
    ),
  alienPlant: (m, v) =>
    sway(recolor(deform(smooth(m), { bend: 0.2, twist: 1.2, bulge: 0.1 }), () => ({ color: [0x6b2d5c, 0x2a6f6a, 0x7a3a4f][v % 3], emissive: 0x2a0f22, emissiveIntensity: 0.4 })), 0.4),
  alienLily: (m) => recolor(smooth(m), (name) => (name.startsWith('leafs') || name === 'grass' ? { color: 0x3a7f74 } : { color: 0xe08ad0, emissive: 0xe08ad0, emissiveIntensity: 0.7 })),
};

/** Leaf, bark and posture per tree variant. Purples, teals and bone, not Earth's greens and browns. */
const TREE_PALETTES = [
  { leaf: 0x7a2f6b, bark: 0xd6ccbc, bend: 0.18, twist: 0.6 },
  { leaf: 0x236e72, bark: 0x3a2a3e, bend: -0.12, twist: -0.9 },
  { leaf: 0x8a3550, bark: 0xcfc3ae, bend: 0.25, twist: 1.2 },
  { leaf: 0x4b3f8f, bark: 0x2e2433, bend: -0.2, twist: 0.4 },
];

interface Look {
  color: number;
  emissive?: number;
  emissiveIntensity?: number;
}

function recolor(m: Model, look: (materialName: string) => Look): Model {
  return {
    box: m.box.clone(),
    parts: m.parts.map((p) => {
      const l = look(p.material.name);
      const mat = p.material.clone();
      mat.color.setHex(l.color);
      if (l.emissive !== undefined) {
        mat.emissive.setHex(l.emissive);
        mat.emissiveIntensity = l.emissiveIntensity ?? 0.2;
      }
      mat.roughness = Math.max(mat.roughness, 0.6);
      mat.metalness = Math.min(mat.metalness, 0.3);
      // Keep any sway patch from an earlier treatment.
      mat.onBeforeCompile = p.material.onBeforeCompile;
      mat.customProgramCacheKey = p.material.customProgramCacheKey;
      return { geometry: p.geometry, material: mat };
    }),
  };
}

/** Weld vertices and recompute normals: Kenney's facets become smooth, curved surfaces. */
function smooth(m: Model): Model {
  return {
    box: m.box.clone(),
    parts: m.parts.map((p) => {
      const g = p.geometry.clone();
      g.deleteAttribute('normal');
      if (g.getAttribute('uv')) g.deleteAttribute('uv');
      const welded = mergeVertices(g, 1e-3);
      welded.computeVertexNormals();
      return { geometry: welded, material: p.material };
    }),
  };
}

/**
 * Bend (lean that grows with height), twist (rotation about the trunk that grows with
 * height) and bulge (lumps around the canopy). Heights are relative to the model's own.
 */
function deform(m: Model, o: { bend: number; twist: number; bulge: number }): Model {
  const h = Math.max(0.01, m.box.max.y - m.box.min.y);
  const parts = m.parts.map((p) => {
    const g = p.geometry.clone();
    const pos = g.getAttribute('position') as THREE.BufferAttribute;
    for (let i = 0; i < pos.count; i++) {
      let x = pos.getX(i);
      const y = pos.getY(i);
      let z = pos.getZ(i);
      const t = (y - m.box.min.y) / h;
      const a = o.twist * t;
      const r = 1 + o.bulge * Math.sin(t * 9 + Math.atan2(z, x) * 3) * t;
      const cx = (x * Math.cos(a) - z * Math.sin(a)) * r;
      const cz = (x * Math.sin(a) + z * Math.cos(a)) * r;
      x = cx + o.bend * t * t * h;
      z = cz;
      pos.setXYZ(i, x, y, z);
    }
    pos.needsUpdate = true;
    g.computeVertexNormals();
    g.computeBoundingBox();
    return { geometry: g, material: p.material };
  });
  const box = new THREE.Box3();
  for (const p of parts) box.union(p.geometry.boundingBox!);
  return { parts, box };
}

/** The world breathes: a slow sway that grows with height, phase-shifted per instance. */
function sway(m: Model, amount: number): Model {
  return {
    box: m.box.clone(),
    parts: m.parts.map((p) => {
      const mat = p.material.clone();
      mat.onBeforeCompile = (shader) => {
        shader.uniforms.uWorldTime = WORLD_TIME;
        shader.vertexShader = shader.vertexShader
          .replace('#include <common>', '#include <common>\nuniform float uWorldTime;')
          .replace(
            '#include <begin_vertex>',
            `#include <begin_vertex>
            #ifdef USE_INSTANCING
              float swayPhase = instanceMatrix[3].x * 0.7 + instanceMatrix[3].z * 0.53;
            #else
              float swayPhase = 0.0;
            #endif
            float swayH = max(position.y, 0.0);
            transformed.x += sin(uWorldTime * 1.1 + swayPhase) * ${amount.toFixed(3)} * swayH * swayH;
            transformed.z += cos(uWorldTime * 0.8 + swayPhase * 1.3) * ${(amount * 0.8).toFixed(3)} * swayH * swayH;`,
          );
      };
      mat.customProgramCacheKey = () => `sway${amount}`;
      return { geometry: p.geometry, material: mat };
    }),
  };
}

// ---------------------------------------------------------------- placing models

/** One mesh per part, for single placements (buildings, guns). */
export function modelObject(m: Model): THREE.Group {
  const g = new THREE.Group();
  for (const p of m.parts) {
    const mesh = new THREE.Mesh(p.geometry, p.material);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    g.add(mesh);
  }
  return g;
}

/** One instanced mesh per part, all sharing the same transforms. */
export function instanced(m: Model, matrices: THREE.Matrix4[], shadows = true): THREE.InstancedMesh[] {
  if (!matrices.length) return [];
  return m.parts.map((p) => {
    const im = new THREE.InstancedMesh(p.geometry, p.material, matrices.length);
    matrices.forEach((mx, i) => im.setMatrixAt(i, mx));
    im.castShadow = shadows;
    im.receiveShadow = true;
    im.computeBoundingSphere();
    return im;
  });
}
