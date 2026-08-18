import { liveNodes } from './circuit.js';
import { TUNING } from './tuning.js';
import {
  CircuitError,
  type ChipId,
  type ChipRegistry,
  type Circuit,
} from './types.js';

/**
 * Scoring.
 *
 * A player's score is what they are trying to minimize, so it has to be both
 * fair and legible — they must be able to look at the board and understand where
 * every point came from. That is why this returns an itemized breakdown rather
 * than a bare number: the UI renders the line items directly.
 *
 * The score is simply how many units are wired into the answer. A loose gate is
 * one unit and so is a chip, however many parts went into building it — which is
 * what makes recognising a component worth doing.
 *
 * Dead branches cost nothing, so experimenting is free. Chips sitting in the
 * registry unused cost nothing either; you are only charged for what reaches the
 * output.
 */

/** What one chip contributed to the score. One row in the UI's score panel. */
export interface ChipCharge {
  readonly chipId: ChipId;
  readonly name: string;
  /** How many live instances of this chip are on the board. */
  readonly instances: number;
  /** How many parts went into the component when it was packaged. */
  readonly partsInside: number;
  /** What these instances cost now — one unit each. */
  readonly subtotal: number;
  /** What the same instances would cost spelled out in loose parts. */
  readonly inlineCost: number;
  /** inlineCost - subtotal: the payoff for having spotted the component. */
  readonly saved: number;
}

export interface ScoreBreakdown {
  /** The score. Lower is better. */
  readonly total: number;
  /** Points contributed by loose primitive gates. */
  readonly primitiveCost: number;
  /** How many loose primitive gates are live. */
  readonly primitiveCount: number;
  readonly chips: readonly ChipCharge[];
  /** Live placed units, counting each chip instance as one. */
  readonly liveGateCount: number;
  /** Placed units that do not reach the output. Free, but worth surfacing. */
  readonly deadGateCount: number;
  /** Total saved across all chips — the headline "your merges earned you N". */
  readonly totalSaved: number;
}

export function score(
  circuit: Circuit,
  registry: ChipRegistry = new Map(),
): ScoreBreakdown {
  const live = liveNodes(circuit);

  let primitiveCost = 0;
  let primitiveCount = 0;
  let liveGateCount = 0;
  const instanceCounts = new Map<ChipId, number>();

  for (const id of live) {
    const node = circuit.nodes.get(id);
    if (!node || node.kind === 'INPUT') continue;

    liveGateCount++;

    if (node.kind === 'CHIP') {
      if (node.chipId === undefined) {
        throw new CircuitError(`CHIP node "${id}" has no chipId`);
      }
      instanceCounts.set(
        node.chipId,
        (instanceCounts.get(node.chipId) ?? 0) + 1,
      );
    } else {
      primitiveCost += TUNING.gateCost[node.kind];
      primitiveCount++;
    }
  }

  let deadGateCount = 0;
  for (const node of circuit.nodes.values()) {
    if (node.kind !== 'INPUT' && !live.has(node.id)) deadGateCount++;
  }

  const chips: ChipCharge[] = [];
  for (const [chipId, instances] of instanceCounts) {
    const chip = registry.get(chipId);
    if (!chip) {
      throw new CircuitError(`Circuit uses unknown chip "${chipId}"`);
    }

    const subtotal = instances * TUNING.chipCost;
    const inlineCost = instances * chip.gateCost;

    chips.push({
      chipId,
      name: chip.name,
      instances,
      partsInside: chip.gateCost,
      subtotal,
      inlineCost,
      saved: inlineCost - subtotal,
    });
  }

  // Stable order so the UI's score panel does not jump around between renders.
  chips.sort((a, b) => a.name.localeCompare(b.name) || a.chipId.localeCompare(b.chipId));

  const chipCost = chips.reduce((sum, c) => sum + c.subtotal, 0);
  const totalSaved = chips.reduce((sum, c) => sum + c.saved, 0);

  return {
    total: primitiveCost + chipCost,
    primitiveCost,
    primitiveCount,
    chips,
    liveGateCount,
    deadGateCount,
    totalSaved,
  };
}

/** Just the number, for when you do not need the breakdown. */
export function totalScore(
  circuit: Circuit,
  registry: ChipRegistry = new Map(),
): number {
  return score(circuit, registry).total;
}

/**
 * What this circuit would score with every chip built out by hand.
 *
 * Useful for the UI ("merging saved you 4") and for M4's puzzle curation, which
 * needs to compare solutions across different chip vocabularies.
 */
export function inlineScore(
  circuit: Circuit,
  registry: ChipRegistry = new Map(),
): number {
  const breakdown = score(circuit, registry);
  return (
    breakdown.primitiveCost +
    breakdown.chips.reduce((sum, c) => sum + c.inlineCost, 0)
  );
}
