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

describe('the payoff case: one chip, two bindings', () => {
  /** XOR(a,b) OR XOR(c,d) — the shape that justifies merging at all. */
  function twoXors() {
    const b = new CircuitBuilder(4);
    const ins = [b.input(0), b.input(1), b.input(2), b.input(3)];
    b.setOutput(
      b.or(b.chip(XOR.id, [ins[0], ins[1]]), b.chip(XOR.id, [ins[2], ins[3]])),
    );
    return b.build();
  }

  it('itemizes the charge', () => {
    const result = score(twoXors(), registry);

    expect(result.chips).toHaveLength(1);
    const charge = result.chips[0];
    expect(charge.name).toBe('XOR');
    expect(charge.instances).toBe(2);
    expect(charge.definitionCost).toBe(4);
    expect(charge.packagingFee).toBe(1);
    expect(charge.reuseFees).toBe(1);
    expect(charge.subtotal).toBe(6); // 4 + 1 + 1
    expect(charge.inlineCost).toBe(8); // 4 + 4 by hand
    expect(charge.saved).toBe(2);
    expect(charge.wasteful).toBe(false);
  });

  it('beats building both XORs by hand', () => {
    const circuit = twoXors();
    expect(totalScore(circuit, registry)).toBe(7); // 1 OR + 6
    expect(inlineScore(circuit, registry)).toBe(9); // 1 OR + 8
    expect(score(circuit, registry).totalSaved).toBe(2);
  });

  it('pays off harder the more times the chip is reused', () => {
    const b = new CircuitBuilder(4);
    const ins = [b.input(0), b.input(1), b.input(2), b.input(3)];
    const three = [
      b.chip(XOR.id, [ins[0], ins[1]]),
      b.chip(XOR.id, [ins[2], ins[3]]),
      b.chip(XOR.id, [ins[0], ins[3]]),
    ];
    b.setOutput(b.or(b.or(three[0], three[1]), three[2]));

    const charge = score(b.build(), registry).chips[0];
    expect(charge.subtotal).toBe(7); // 4 + 1 + 2
    expect(charge.inlineCost).toBe(12);
    expect(charge.saved).toBe(5);
  });
});

describe('design invariants', () => {
  it('makes micro-merges pointless: a 2-gate chip used twice breaks even', () => {
    // This is what the packaging fee is FOR. If this ever starts saving points,
    // players will merge every trivial pair and the board becomes noise.
    const tiny = chip('TINY', 2, 0x8n, 2);
    const reg = new Map([[tiny.id, tiny]]);

    const b = new CircuitBuilder(4);
    const ins = [b.input(0), b.input(1), b.input(2), b.input(3)];
    b.setOutput(
      b.or(b.chip(tiny.id, [ins[0], ins[1]]), b.chip(tiny.id, [ins[2], ins[3]])),
    );

    expect(score(b.build(), reg).chips[0].saved).toBe(0);
  });

  it('starts paying off at 3 gates — that is where the cliff sits', () => {
    const small = chip('SMALL', 2, 0xen, 3);
    const reg = new Map([[small.id, small]]);

    const b = new CircuitBuilder(4);
    const ins = [b.input(0), b.input(1), b.input(2), b.input(3)];
    b.setOutput(
      b.or(
        b.chip(small.id, [ins[0], ins[1]]),
        b.chip(small.id, [ins[2], ins[3]]),
      ),
    );

    expect(score(b.build(), reg).chips[0].saved).toBe(1);
  });

  it('punishes faking a second instance to earn a merge', () => {
    // The obvious cheese: instantiate the same function at the SAME binding
    // twice so it looks reused, then merge. M3 rejects this at merge time
    // (bindings must differ), but the cost model already makes it a loss, which
    // is the belt-and-braces we want.
    const b = new CircuitBuilder(2);
    const a0 = b.input(0);
    const a1 = b.input(1);
    b.setOutput(b.and(b.chip(XOR.id, [a0, a1]), b.chip(XOR.id, [a0, a1])));

    expect(totalScore(b.build(), registry)).toBe(7); // 6 + 1 AND
    // Against just building XOR once, inline, for 4. Cheese loses.
    expect(totalScore(b.build(), registry)).toBeGreaterThan(4);
  });

  it('flags a chip that has been reduced to a single use', () => {
    // Legal merge, then the player deleted instances until one was left. They
    // are now paying a packaging fee for nothing.
    const b = new CircuitBuilder(2);
    b.setOutput(b.chip(XOR.id, [b.input(0), b.input(1)]));

    const charge = score(b.build(), registry).chips[0];
    expect(charge.subtotal).toBe(5); // 4 + 1 + 0
    expect(charge.saved).toBe(-1);
    expect(charge.wasteful).toBe(true);
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
      TUNING.packagingFee,
      TUNING.reuseFee,
      TUNING.maxChipNodes,
      TUNING.minChipInstances,
    ];
    for (const value of values) {
      expect(Number.isInteger(value)).toBe(true);
    }
  });
});
