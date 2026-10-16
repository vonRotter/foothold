import { makeRng, int } from '../sim/rng';
import type { Colonist } from '../sim/types';
import { PAL } from '../render/palette';

const SKIN = ['#d9b89a', '#b98d6a', '#8a5f42', '#e6c9ad', '#6b4630'];
const HAIR = ['#1d1a17', '#4a3423', '#8a6a3e', '#b8b0a2', '#2c2a2e'];

function hex(n: number): string {
  return `#${n.toString(16).padStart(6, '0')}`;
}

/** A small portrait made of rectangles only. Scars are drawn on. */
export function drawPortrait(canvas: HTMLCanvasElement, col: Colonist): void {
  const S = 24;
  canvas.width = S;
  canvas.height = S;
  const g = canvas.getContext('2d')!;
  const r = makeRng(col.portraitSeed);
  const role = col.retired ? PAL.retired : PAL[col.role];
  g.fillStyle = '#121417';
  g.fillRect(0, 0, S, S);
  g.fillStyle = hex(role);
  g.fillRect(0, S - 6, S, 6); // collar in the role colour
  g.fillStyle = '#d9d4c8';
  g.fillRect(4, S - 8, S - 8, 3);
  const skin = SKIN[int(r, SKIN.length)];
  const hair = HAIR[int(r, HAIR.length)];
  const fw = 10 + int(r, 3);
  const fx = Math.floor((S - fw) / 2);
  g.fillStyle = skin;
  g.fillRect(fx, 5, fw, 12);
  g.fillRect(fx + 3, 16, fw - 6, 3);
  g.fillStyle = hair;
  const style = int(r, 3);
  if (style === 0) g.fillRect(fx - 1, 3, fw + 2, 4);
  if (style === 1) { g.fillRect(fx - 1, 3, fw + 2, 3); g.fillRect(fx - 1, 3, 2, 9); g.fillRect(fx + fw - 1, 3, 2, 9); }
  if (style === 2) g.fillRect(fx + 1, 4, fw - 2, 2);
  g.fillStyle = '#16181b';
  const ey = 9 + int(r, 2);
  g.fillRect(fx + 2, ey, 2, 2);
  g.fillRect(fx + fw - 4, ey, 2, 2);
  g.fillStyle = 'rgba(0,0,0,0.35)';
  g.fillRect(fx + 3, 14, fw - 6, 1);

  for (const s of col.scars) {
    g.fillStyle = '#7a2a2a';
    switch (s) {
      case 'lost_eye': g.fillStyle = '#111'; g.fillRect(fx + 1, ey - 1, 4, 4); g.fillRect(fx, ey, fw, 1); break;
      case 'burned_lungs': g.fillStyle = '#8a4a3a'; g.fillRect(fx + 1, 15, 3, 3); break;
      case 'shattered_knee': g.fillRect(S - 4, S - 6, 3, 6); break;
      case 'tremor': g.fillRect(fx + fw - 2, 6, 1, 6); break;
      case 'nerve_damage': g.fillRect(fx + 1, 6, 1, 7); break;
      case 'shell_shock': g.fillStyle = 'rgba(0,0,0,0.5)'; g.fillRect(fx + 1, ey + 2, fw - 2, 1); break;
    }
  }
  if (col.status === 'dead') {
    g.fillStyle = 'rgba(0,0,0,0.6)';
    g.fillRect(0, 0, S, S);
  }
}
