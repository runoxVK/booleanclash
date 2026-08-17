import { inputColumn, maskFor, rowCount } from './truthtable.js';

/**
 * Cheapest known construction for every small function.
 *
 * The generator needs this to avoid lying. If it plants a five-gate motif that
 * happens to compute plain AND, then "merge this and save four" is nonsense —
 * the player would place one AND gate. Rather than generate circuits and hope
 * they are efficient, we solve the space once and then build motifs FROM the
 * answer, so minimality holds by construction.
 *
 * This is minimal FORMULA size (a tree, every intermediate used once) rather
 * than true minimal circuit size (a DAG, where results can be shared). Sharing
 * only ever helps, so this is an upper bound — and since we rebuild each recipe
 * with sharing enabled, the circuits that come out can be cheaper still. Being
 * an upper bound is the safe direction: we may undersell a motif, never oversell
 * one.
 */

/** The most parameters we exhaustively solve. 4 would mean 65536 functions. */
export const MAX_SYNTHESIS_ARITY = 3;

export type Recipe =
  | { readonly kind: 'param'; readonly cost: 0; readonly index: number }
  | { readonly kind: 'NOT'; readonly cost: number; readonly a: bigint }
  | {
      readonly kind: 'AND' | 'OR';
      readonly cost: number;
      readonly a: bigint;
      readonly b: bigint;
    };

const cache = new Map<number, Map<bigint, Recipe>>();

/**
 * Solve every function of `arity` parameters, returning how to build each one.
 * Bare parameters cost 0.
 */
export function recipes(arity: number): ReadonlyMap<bigint, Recipe> {
  const cached = cache.get(arity);
  if (cached) return cached;

  if (arity < 1 || arity > MAX_SYNTHESIS_ARITY) {
    throw new RangeError(
      `Exhaustive synthesis is only practical up to ${MAX_SYNTHESIS_ARITY} parameters`,
    );
  }

  const mask = maskFor(arity);
  const best = new Map<bigint, Recipe>();
  for (let i = 0; i < arity; i++) {
    best.set(inputColumn(arity, i), { kind: 'param', cost: 0, index: i });
  }

  const offer = (table: bigint, recipe: Recipe): boolean => {
    const existing = best.get(table);
    if (existing !== undefined && existing.cost <= recipe.cost) return false;
    best.set(table, recipe);
    return true;
  };

  // Relax until nothing gets cheaper. The space is tiny at this size, so the
  // naive fixpoint is fast and obviously correct.
  let changed = true;
  while (changed) {
    changed = false;
    const known = [...best.entries()];
    for (const [f, recipeF] of known) {
      if (offer(~f & mask, { kind: 'NOT', cost: recipeF.cost + 1, a: f })) {
        changed = true;
      }
      for (const [g, recipeG] of known) {
        const cost = recipeF.cost + recipeG.cost + 1;
        if (offer(f & g, { kind: 'AND', cost, a: f, b: g })) changed = true;
        if (offer(f | g, { kind: 'OR', cost, a: f, b: g })) changed = true;
      }
    }
  }

  cache.set(arity, best);
  return best;
}

/** Cheapest known gate count for one function, or null if unreachable. */
export function minimalCost(table: bigint, arity: number): number | null {
  return recipes(arity).get(table)?.cost ?? null;
}

/**
 * Functions expensive enough to be worth wrapping in a chip, cheapest first.
 * Below `minGates` a chip costs more than it saves, so those are useless as
 * puzzle motifs.
 */
export function costlyFunctions(
  arity: number,
  minGates: number,
): ReadonlyArray<{ readonly table: bigint; readonly cost: number }> {
  const out: { table: bigint; cost: number }[] = [];
  for (const [table, recipe] of recipes(arity)) {
    if (recipe.cost >= minGates) out.push({ table, cost: recipe.cost });
  }
  out.sort((a, b) => a.cost - b.cost || (a.table < b.table ? -1 : 1));
  return out;
}

/** Fraction of rows where the function is 1. Used to reject lopsided targets. */
export function density(table: bigint, inputCount: number): number {
  const rows = rowCount(inputCount);
  let ones = 0;
  for (let r = 0; r < rows; r++) {
    if ((table >> BigInt(r)) & 1n) ones++;
  }
  return ones / rows;
}
