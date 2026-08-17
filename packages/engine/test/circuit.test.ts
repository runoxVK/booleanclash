import { describe, expect, it } from 'vitest';
import {
  CircuitBuilder,
  evaluate,
  evaluateOutput,
  gateCount,
  liveNodes,
  solves,
  validate,
} from '../src/circuit.js';
import { inputColumn } from '../src/truthtable.js';
import {
  CircuitError,
  type ChipDefinition,
  type Circuit,
  type CircuitNode,
  type NodeId,
} from '../src/types.js';

/** XOR built as (a OR b) AND NOT(a AND b) — 4 gates. */
function xorFourGates(): Circuit {
  const b = new CircuitBuilder(2);
  const a0 = b.input(0);
  const a1 = b.input(1);
  b.setOutput(b.and(b.or(a0, a1), b.not(b.and(a0, a1))));
  return b.build();
}

/** XOR built as (a AND NOT b) OR (NOT a AND b) — 5 gates, same behaviour. */
function xorFiveGates(): Circuit {
  const b = new CircuitBuilder(2);
  const a0 = b.input(0);
  const a1 = b.input(1);
  b.setOutput(b.or(b.and(a0, b.not(a1)), b.and(b.not(a0), a1)));
  return b.build();
}

describe('evaluation', () => {
  it('evaluates a single AND', () => {
    const b = new CircuitBuilder(2);
    b.setOutput(b.and(b.input(0), b.input(1)));
    expect(evaluateOutput(b.build())).toBe(0x8n);
  });

  it('returns null when nothing is wired to the output', () => {
    const b = new CircuitBuilder(2);
    b.and(b.input(0), b.input(1));
    expect(evaluateOutput(b.build())).toBeNull();
  });

  it('gives a table for every node, not just live ones', () => {
    const b = new CircuitBuilder(2);
    const a0 = b.input(0);
    const a1 = b.input(1);
    b.not(a0); // dangling experiment
    b.setOutput(b.and(a0, a1));
    const values = evaluate(b.build());
    expect(values.size).toBe(4);
  });
});

describe('the core game situation: two ways to build XOR', () => {
  const XOR = 0x6n;

  it('agrees on behaviour but not on cost', () => {
    expect(evaluateOutput(xorFourGates())).toBe(XOR);
    expect(evaluateOutput(xorFiveGates())).toBe(XOR);

    expect(gateCount(xorFourGates())).toBe(4);
    expect(gateCount(xorFiveGates())).toBe(5);
  });

  it('recognizes both as solutions to the same target', () => {
    expect(solves(xorFourGates(), XOR)).toBe(true);
    expect(solves(xorFiveGates(), XOR)).toBe(true);
    expect(solves(xorFourGates(), 0x9n)).toBe(false); // XNOR is a different puzzle
  });
});

describe('fan-out is free', () => {
  it('charges once for a signal used twice', () => {
    const b = new CircuitBuilder(2);
    const shared = b.and(b.input(0), b.input(1));
    // shared feeds both branches; the player pays for it once
    b.setOutput(b.or(shared, b.not(shared)));
    const circuit = b.build();

    expect(gateCount(circuit)).toBe(3); // AND, NOT, OR
    expect(evaluateOutput(circuit)).toBe(0xfn); // tautology
  });
});

describe('dead code is free', () => {
  it('excludes nodes that do not reach the output', () => {
    const b = new CircuitBuilder(2);
    const a0 = b.input(0);
    const a1 = b.input(1);
    const abandoned = b.or(a0, a1);
    b.not(abandoned); // an abandoned two-gate branch
    b.setOutput(b.and(a0, a1));
    const circuit = b.build();

    expect(gateCount(circuit)).toBe(1);
    expect(liveNodes(circuit).size).toBe(3); // AND + its two inputs
  });
});

describe('chips', () => {
  const xorChip: ChipDefinition = {
    id: 'chip-xor',
    name: 'XOR',
    arity: 2,
    table: 0x6n,
    gateCost: 4,
  };
  const registry = new Map([[xorChip.id, xorChip]]);

  it('evaluates the same chip at two different bindings', () => {
    // XOR(a,b) OR XOR(c,d) — the shape that justifies merging in the first place
    const b = new CircuitBuilder(4);
    const ins = [b.input(0), b.input(1), b.input(2), b.input(3)];
    const left = b.chip('chip-xor', [ins[0], ins[1]]);
    const right = b.chip('chip-xor', [ins[2], ins[3]]);
    b.setOutput(b.or(left, right));
    const circuit = b.build();

    const a = inputColumn(4, 0);
    const bb = inputColumn(4, 1);
    const c = inputColumn(4, 2);
    const d = inputColumn(4, 3);
    expect(evaluateOutput(circuit, registry)).toBe((a ^ bb) | (c ^ d));

    // Placed units: 2 chips + 1 OR. Scoring the definition and reuse fees is M2.
    expect(gateCount(circuit)).toBe(3);
  });

  it('rejects an unknown chip', () => {
    const b = new CircuitBuilder(2);
    b.setOutput(b.chip('chip-nope', [b.input(0), b.input(1)]));
    expect(() => evaluateOutput(b.build(), registry)).toThrow(CircuitError);
  });

  it('rejects the wrong argument count', () => {
    const b = new CircuitBuilder(2);
    b.setOutput(b.chip('chip-xor', [b.input(0)]));
    expect(() => evaluateOutput(b.build(), registry)).toThrow(/expects 2/);
  });
});

describe('validation', () => {
  it('rejects a dangling reference', () => {
    const nodes = new Map<NodeId, CircuitNode>([
      ['x', { id: 'x', kind: 'NOT', inputs: ['ghost'] }],
    ]);
    expect(() => validate({ inputCount: 1, nodes, outputId: 'x' })).toThrow(
      /unknown node/,
    );
  });

  it('rejects bad primitive arity', () => {
    const nodes = new Map<NodeId, CircuitNode>([
      ['i', { id: 'i', kind: 'INPUT', inputs: [], inputIndex: 0 }],
      ['x', { id: 'x', kind: 'AND', inputs: ['i'] }],
    ]);
    expect(() => validate({ inputCount: 1, nodes, outputId: 'x' })).toThrow(
      /expects 2 input/,
    );
  });

  it('rejects an out-of-range input index', () => {
    const nodes = new Map<NodeId, CircuitNode>([
      ['i', { id: 'i', kind: 'INPUT', inputs: [], inputIndex: 7 }],
    ]);
    expect(() => validate({ inputCount: 2, nodes, outputId: 'i' })).toThrow(
      /invalid inputIndex/,
    );
  });

  it('rejects a cycle', () => {
    const nodes = new Map<NodeId, CircuitNode>([
      ['x', { id: 'x', kind: 'AND', inputs: ['y', 'y'] }],
      ['y', { id: 'y', kind: 'NOT', inputs: ['x'] }],
    ]);
    expect(() => validate({ inputCount: 1, nodes, outputId: 'x' })).toThrow(
      /Cycle detected/,
    );
  });

  it('rejects a missing output node', () => {
    const nodes = new Map<NodeId, CircuitNode>();
    expect(() => validate({ inputCount: 1, nodes, outputId: 'gone' })).toThrow(
      /does not exist/,
    );
  });

  it('rejects an out-of-range builder input', () => {
    const b = new CircuitBuilder(2);
    expect(() => b.input(5)).toThrow(CircuitError);
  });
});
