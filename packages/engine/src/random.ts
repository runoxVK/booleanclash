/**
 * Deterministic pseudo-randomness.
 *
 * Puzzles are generated from a seed rather than shipped as data, so a puzzle is
 * just a number. That makes a daily puzzle a date, a shared puzzle a link, and a
 * bug report reproducible. Everything downstream depends on this being stable,
 * so do not swap the algorithm without regenerating the pars.
 */
export type Rng = () => number;

/** mulberry32 — small, fast, and good enough for shuffling a circuit together. */
export function makeRng(seed: number): Rng {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 61), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Integer in [0, bound). */
export function randInt(rng: Rng, bound: number): number {
  return Math.floor(rng() * bound);
}

/** Pick one element. */
export function pick<T>(rng: Rng, items: readonly T[]): T {
  return items[randInt(rng, items.length)];
}
