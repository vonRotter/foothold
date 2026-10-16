// Seeded PRNG (mulberry32). All randomness in the simulation goes through this,
// so a campaign with the same seed and the same player choices replays exactly.

export interface Rng {
  state: number;
}

export function makeRng(seed: number): Rng {
  return { state: seed >>> 0 };
}

/** Uniform float in [0, 1). Advances the generator. */
export function next(rng: Rng): number {
  rng.state = (rng.state + 0x6d2b79f5) >>> 0;
  let t = rng.state;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** Integer in [0, n). */
export function int(rng: Rng, n: number): number {
  return Math.floor(next(rng) * n);
}

/** Honest percentage roll: true with probability pct/100. Returns the roll too, for the log. */
export function rollPct(rng: Rng, pct: number): { hit: boolean; roll: number } {
  const roll = int(rng, 100); // 0..99
  return { hit: roll < pct, roll };
}

export function pick<T>(rng: Rng, arr: readonly T[]): T {
  return arr[int(rng, arr.length)];
}
