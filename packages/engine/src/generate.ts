import { CircuitBuilder, evaluateOutput } from './circuit.js';
import { identify, isKnownComponent } from './codex.js';
import { score } from './cost.js';
import { makeRng, randInt, type Rng } from './random.js';
import { costlyFunctions, density, recipes } from './synthesis.js';
import { inputColumn, rowCount } from './truthtable.js';
import { TUNING } from './tuning.js';
import type { ChipDefinition, ChipRegistry, Circuit, NodeId } from './types.js';

/**
 * Puzzle generation.
 *
 * Puzzles are built BACKWARDS. A uniformly random target column almost always
 * has no exploitable repeated structure, so merging never pays and the puzzle is
 * just ugly arithmetic. Instead we construct a circuit that deliberately uses
 * one small motif at several different bindings, then hand the player only its
 * output column. That guarantees the merge mechanic has something to bite on,
 * and it gives a par for free: we know a solution because we built one.
 *
 * Par is "best known", not "provably optimal". Finding the true minimum is
 * expensive, and a par the player can beat is better for the game than a par
 * they cannot.
 */

export interface GeneratedPuzzle {
  readonly seed: number;
  readonly inputCount: number;
  readonly target: bigint;
  /** Best score we know of, using the chip. */
  readonly par: number;
  /** What the same solution costs with everything spelled out in primitives. */
  readonly parWithoutMerging: number;
  /** The chip that pays off here, if it is a function with a known name. */
  readonly keyChip: string | null;
  /** How many pins that chip has. */
  readonly keyChipPins: number;
  /** Gates inside that chip. */
  readonly keyChipCost: number;
  /** How many times the motif appears. */
  readonly instances: number;
}

/* ------------------------------------------------------------------ */
/* Motifs — the small repeated shape at the heart of each puzzle       */
/* ------------------------------------------------------------------ */

interface MotifOp {
  readonly gate: 'NOT' | 'AND' | 'OR';
  readonly a: number;
  readonly b: number;
}

/** Slots 0..arity-1 are the parameters; each op appends one more slot. */
interface Motif {
  readonly arity: number;
  readonly ops: readonly MotifOp[];
}

/**
 * Build the cheapest known motif for a given function.
 *
 * Walking the solved recipe rather than rolling dice is what makes the chip
 * honestly priced: the motif is as small as that function can be, so the saving
 * the puzzle advertises is real. Shared sub-results are emitted once, which can
 * make the finished motif cheaper than the formula cost.
 */
function motifForFunction(table: bigint, arity: number): Motif {
  const solved = recipes(arity);
  const ops: MotifOp[] = [];
  const slotOf = new Map<bigint, number>();
  for (let i = 0; i < arity; i++) slotOf.set(inputColumn(arity, i), i);

  const build = (want: bigint): number => {
    const known = slotOf.get(want);
    if (known !== undefined) return known;

    const recipe = solved.get(want);
    if (!recipe || recipe.kind === 'param') {
      throw new Error(`No construction for function ${want}`);
    }

    const a = build(recipe.a);
    const b = recipe.kind === 'NOT' ? a : build(recipe.b);
    ops.push({ gate: recipe.kind, a, b });

    const slot = arity + ops.length - 1;
    slotOf.set(want, slot);
    return slot;
  };

  build(table);
  return { arity, ops };
}

/** Splice a motif into a circuit under construction, wired to `args`. */
function inlineMotif(
  builder: CircuitBuilder,
  motif: Motif,
  args: readonly NodeId[],
): NodeId {
  const slots: NodeId[] = [...args];
  for (const op of motif.ops) {
    const x = slots[op.a];
    const y = slots[op.b];
    slots.push(
      op.gate === 'NOT'
        ? builder.not(x)
        : op.gate === 'AND'
          ? builder.and(x, y)
          : builder.or(x, y),
    );
  }
  return slots[slots.length - 1];
}

function motifCircuit(motif: Motif): Circuit {
  const builder = new CircuitBuilder(motif.arity);
  const params: NodeId[] = [];
  for (let i = 0; i < motif.arity; i++) params.push(builder.input(i));
  builder.setOutput(inlineMotif(builder, motif, params));
  return builder.build();
}

/* ------------------------------------------------------------------ */
/* Structural checks                                                  */
/* ------------------------------------------------------------------ */

/**
 * Does this function actually use every input?
 *
 * A target that ignores `d` is a smaller puzzle wearing a bigger costume, and
 * players correctly find that annoying rather than clever.
 */
export function dependsOnEveryInput(table: bigint, inputCount: number): boolean {
  const rows = rowCount(inputCount);
  for (let p = 0; p < inputCount; p++) {
    let matters = false;
    for (let r = 0; r < rows && !matters; r++) {
      if ((r >> p) & 1) continue;
      const flipped = r | (1 << p);
      if (((table >> BigInt(r)) & 1n) !== ((table >> BigInt(flipped)) & 1n)) {
        matters = true;
      }
    }
    if (!matters) return false;
  }
  return true;
}

/** How many distinct sets of `k` inputs exist. */
function comboCount(n: number, k: number): number {
  let result = 1;
  for (let i = 0; i < k; i++) result = (result * (n - i)) / (i + 1);
  return Math.round(result);
}

function isConstant(table: bigint, inputCount: number): boolean {
  const rows = rowCount(inputCount);
  const first = table & 1n;
  for (let r = 1; r < rows; r++) {
    if (((table >> BigInt(r)) & 1n) !== first) return false;
  }
  return true;
}

/* ------------------------------------------------------------------ */
/* Assembling a puzzle                                                */
/* ------------------------------------------------------------------ */

interface Plan {
  readonly motif: Motif;
  /** Distinct tuples of input indices the motif is wired to. */
  readonly bindings: readonly (readonly number[])[];
  /** How the motif results get folded together. */
  readonly folds: readonly ('AND' | 'OR')[];
  /** Optional final twist against a raw input. */
  readonly finish: { readonly gate: 'AND' | 'OR'; readonly input: number } | null;
}

/**
 * Realize a plan, either with the motif spelled out or as chip instances.
 * Both produce the same function — that is the whole point.
 */
function realize(
  plan: Plan,
  inputCount: number,
  chip: ChipDefinition | null,
): Circuit {
  const builder = new CircuitBuilder(inputCount);
  const inputs: NodeId[] = [];
  for (let i = 0; i < inputCount; i++) inputs.push(builder.input(i));

  let results = plan.bindings.map((binding) => {
    const args = binding.map((i) => inputs[i]);
    return chip ? builder.chip(chip.id, args) : inlineMotif(builder, plan.motif, args);
  });

  // Fold every instance in, so none of them end up dead.
  let f = 0;
  while (results.length > 1) {
    const gate = plan.folds[f % plan.folds.length];
    const merged =
      gate === 'AND'
        ? builder.and(results[0], results[1])
        : builder.or(results[0], results[1]);
    results = [merged, ...results.slice(2)];
    f++;
  }

  let out = results[0];
  if (plan.finish) {
    const other = inputs[plan.finish.input];
    out =
      plan.finish.gate === 'AND'
        ? builder.and(out, other)
        : builder.or(out, other);
  }

  builder.setOutput(out);
  return builder.build();
}

/**
 * Distinct sets of `arity` input indices, shuffled deterministically.
 *
 * Bindings must differ from one another — that is the rule that makes a chip
 * worth having rather than a wire.
 */
function distinctBindings(
  rng: Rng,
  inputCount: number,
  arity: number,
  count: number,
): number[][] {
  const all: number[][] = [];
  const build = (start: number, current: number[]): void => {
    if (current.length === arity) {
      all.push([...current]);
      return;
    }
    for (let i = start; i < inputCount; i++) {
      current.push(i);
      build(i + 1, current);
      current.pop();
    }
  };
  build(0, []);

  for (let i = all.length - 1; i > 0; i--) {
    const j = randInt(rng, i + 1);
    [all[i], all[j]] = [all[j], all[i]];
  }
  return all.slice(0, count);
}

/**
 * Build a puzzle from a seed. Deterministic: the same seed always yields the
 * same puzzle, so a puzzle can be shared as a number and a daily is just a date.
 */
export function generatePuzzle(seed: number, inputCount = 4): GeneratedPuzzle {
  if (inputCount < 3 || inputCount > 6) {
    throw new RangeError('Puzzles want between 3 and 6 inputs');
  }

  for (let attempt = 0; attempt < 400; attempt++) {
    const rng = makeRng(seed * 7919 + attempt * 104729);

    /* Three-parameter motifs are where the variety lives. Of the sixteen
       two-parameter functions only XOR and XNOR need three or more gates, so a
       pool built on pairs alone would be the same puzzle every time. */
    const motifArity = rng() < 0.72 ? 3 : 2;
    const candidates = costlyFunctions(motifArity, 3).filter(
      (f) =>
        f.cost <= TUNING.maxChipNodes &&
        dependsOnEveryInput(f.table, motifArity),
    );
    if (candidates.length === 0) continue;

    /* The planted motif must be a component from the catalogue, because that is
       the only thing a player is allowed to package. Planting an anonymous
       function would make a puzzle with no discovery in it at all. */
    const named = candidates.filter((f) => identify(motifArity, f.table) !== null);
    if (named.length === 0) continue;
    const chosen = named[randInt(rng, named.length)];
    const motif = motifForFunction(chosen.table, motifArity);
    const motifSolution = motifCircuit(motif);
    const motifTable = evaluateOutput(motifSolution);
    if (motifTable !== chosen.table) continue; // paranoia

    const motifCost = score(motifSolution).total;
    if (motifCost < 3 || motifCost > TUNING.maxChipNodes) continue;

    const maxBindings = comboCount(inputCount, motifArity);
    if (maxBindings < 2) continue;
    const instances = Math.min(2 + randInt(rng, 2), maxBindings);
    const bindings = distinctBindings(rng, inputCount, motifArity, instances);
    if (bindings.length < 2) continue;

    const folds = Array.from({ length: Math.max(1, instances - 1) }, () =>
      rng() < 0.5 ? ('AND' as const) : ('OR' as const),
    );
    const finish =
      rng() < 0.45
        ? {
            gate: rng() < 0.5 ? ('AND' as const) : ('OR' as const),
            input: randInt(rng, inputCount),
          }
        : null;

    const plan: Plan = { motif, bindings, folds, finish };

    const chip: ChipDefinition = {
      id: 'chip-key',
      name: identify(motifArity, motifTable) ?? 'CHIP',
      arity: motifArity,
      table: motifTable,
      gateCost: motifCost,
    };
    const registry: ChipRegistry = new Map([[chip.id, chip]]);

    const expanded = realize(plan, inputCount, null);
    const target = evaluateOutput(expanded);
    if (target === null) continue;
    if (isConstant(target, inputCount)) continue;
    if (!dependsOnEveryInput(target, inputCount)) continue;

    /* Lopsided targets — on for one row out of sixteen — are recognisable at a
       glance as "AND everything" and make for a flat puzzle. Insist the column
       is reasonably mixed. */
    const balance = density(target, inputCount);
    if (balance < 0.25 || balance > 0.75) continue;

    /* The generator's half of the bargain that keeps the catalogue honest: if
       the target were itself a known component, the player could package their
       entire answer and score 1. */
    if (isKnownComponent(inputCount, target)) continue;

    const chipped = realize(plan, inputCount, chip);
    if (evaluateOutput(chipped, registry) !== target) continue; // paranoia

    const parWithoutMerging = score(expanded).total;
    const par = Math.min(parWithoutMerging, score(chipped, registry).total);

    // Too easy is not a puzzle.
    if (par < 4) continue;

    return {
      seed,
      inputCount,
      target,
      par,
      parWithoutMerging,
      keyChip: identify(motifArity, motifTable),
      keyChipPins: motifArity,
      keyChipCost: motifCost,
      instances,
    };
  }

  throw new Error(`Could not generate a puzzle for seed ${seed}`);
}
