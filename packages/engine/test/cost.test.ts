import { describe, expect, it } from 'vitest';
import { CircuitBuilder, gateCount } from '../src/circuit.js';
import { inlineScore, score, totalScore } from '../src/cost.js';
import { TUNING } from '../src/tuning.js';
import type { ChipDefinition } from '../src/types.js';
import { CircuitError } from '../src/types.js';

function chip(
  name: string,
  arity: number,
  table: bigint,
  gateCost: number,
): ChipDefinition {
  return { id: `chip-${name.toLowerCase()}`, name, arity, table, gateCost };
}

const XOR = chip('XOR', 2, 0x6n, 4);
const registry = new Map([[XOR.id, XOR]]);

describe('primitives only', () => {
  it('scores a plain gate count when nothing is merged', () => {
    const b = new CircuitBuilder(2);
    const a0 = b.input(0);
    const a1 = b.input(1);
    b.setOutput(b.and(b.or(a0, a1), b.not(b.and(a0, a1))));
    const circuit = b.build();

    const result = score(circuit);
    expect(result.total).toBe(4);
    expect(result.total).toBe(gateCount(circuit));
    expect(result.primitiveCount).toBe(4);
    expect(result.chips).toHaveLength(0);
    expect(result.totalSaved).toBe(0);
  });

  it('scores zero when nothing is wired to the output', () => {
    const b = new CircuitBuilder(2);
    b.and(b.input(0), b.input(1));
    expect(totalScore(b.build())).toBe(0);
  });
});

describe('dead branches are free', () => {
  it('charges nothing for them but still reports them', () => {
    const b = new CircuitBuilder(2);
    const a0 = b.input(0);
    const a1 = b.input(1);
    b.not(b.or(a0, a1)); // abandoned two-gate experiment
    b.setOutput(b.and(a0, a1));

    const result = score(b.build());
    expect(result.total).toBe(1);
    expect(result.liveGateCount).toBe(1);
    expect(result.deadGateCount).toBe(2);
  });
});

describe('chips count as one unit', () => {
  /** XOR(a,b) OR XOR(c,d) with both XORs already packaged. */
  function twoChips() {
    const b = new CircuitBuilder(4);
    const ins = [b.input(0), b.input(1), b.input(2), b.input(3)];
    b.setOutput(
      b.or(b.chip(XOR.id, [ins[0], ins[1]]), b.chip(XOR.id, [ins[2], ins[3]])),
    );
    return b.build();
  }

  it('itemizes what each chip contributed', () => {
    const result = score(twoChips(), registry);

    expect(result.chips).toHaveLength(1);
    const charge = result.chips[0];
    expect(charge.name).toBe('XOR');
    expect(charge.instances).toBe(2);
    expect(charge.partsInside).toBe(4);
    expect(charge.subtotal).toBe(2); // one unit each
    expect(charge.inlineCost).toBe(8); // eight loose parts
    expect(charge.saved).toBe(6);
  });

  it('scores three where loose parts would score nine', () => {
    const circuit = twoChips();
    expect(totalScore(circuit, registry)).toBe(3); // 1 OR + 2 chips
    expect(inlineScore(circuit, registry)).toBe(9); // 1 OR + 8 parts
    expect(score(circuit, registry).totalSaved).toBe(6);
  });

  it('charges the same for a chip however much is inside it', () => {
    // A chip is one unit whether it packaged three parts or eight. That is the
    // entire economy: recognising the component is the win.
    const big: ChipDefinition = {
      id: 'chip-big', name: 'MAJORITY', arity: 3, table: 0xe8n, gateCost: 8,
    };
    const reg = new Map([[big.id, big]]);
    const b = new CircuitBuilder(3);
    const ins = [b.input(0), b.input(1), b.input(2)];
    b.setOutput(b.chip(big.id, ins));

    expect(totalScore(b.build(), reg)).toBe(1);
  });
});

describe('registry handling', () => {
  it('charges nothing for a discovered chip that is not used', () => {
    const b = new CircuitBuilder(2);
    b.setOutput(b.and(b.input(0), b.input(1)));
    expect(totalScore(b.build(), registry)).toBe(1);
  });

  it('rejects a circuit referencing a chip the registry does not have', () => {
    const b = new CircuitBuilder(2);
    b.setOutput(b.chip('chip-ghost', [b.input(0), b.input(1)]));
    expect(() => score(b.build(), registry)).toThrow(CircuitError);
  });
});

describe('tuning', () => {
  it('keeps every cost an integer, because players compare scores', () => {
    const values = [
      ...Object.values(TUNING.gateCost),
      TUNING.chipCost,
      TUNING.maxChipNodes,
      TUNING.maxChipArity,
    ];
    for (const value of values) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });
});
