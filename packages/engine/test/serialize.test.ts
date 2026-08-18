import { describe, expect, it } from 'vitest';
import { CircuitBuilder, evaluateOutput } from '../src/circuit.js';
import { totalScore } from '../src/cost.js';
import { fromWire, rowsMatching, toWire } from '../src/serialize.js';
import { CircuitError, type ChipDefinition } from '../src/types.js';

const XOR: ChipDefinition = {
  id: 'chip-xor', name: 'XOR', arity: 2, table: 0x6n, gateCost: 4,
};

function board() {
  const b = new CircuitBuilder(4);
  const ins = [b.input(0), b.input(1), b.input(2), b.input(3)];
  b.setOutput(b.or(b.chip(XOR.id, [ins[0], ins[1]]), b.chip(XOR.id, [ins[2], ins[3]])));
  return b.build();
}

describe('round trip', () => {
  it('survives with behaviour and score intact', () => {
    const circuit = board();
    const registry = new Map([[XOR.id, XOR]]);

    const wire = JSON.parse(JSON.stringify(toWire(circuit, registry)));
    const back = fromWire(wire);

    expect(evaluateOutput(back.circuit, back.registry)).toBe(
      evaluateOutput(circuit, registry),
    );
    expect(totalScore(back.circuit, back.registry)).toBe(totalScore(circuit, registry));
    expect(back.registry.get(XOR.id)?.table).toBe(0x6n);
  });

  it('keeps unconnected pins as null rather than losing them', () => {
    const b = new CircuitBuilder(2);
    b.input(0);
    b.input(1);
    const circuit = b.build();
    const nodes = new Map(circuit.nodes);
    nodes.set('g1', { id: 'g1', kind: 'AND', inputs: ['n1', null] });

    const back = fromWire(JSON.parse(JSON.stringify(toWire({ ...circuit, nodes }, new Map()))));
    expect(back.circuit.nodes.get('g1')?.inputs).toEqual(['n1', null]);
  });
});

describe('refusing rubbish', () => {
  const good = () => JSON.parse(JSON.stringify(toWire(board(), new Map([[XOR.id, XOR]]))));

  it('rejects a non-object', () => {
    expect(() => fromWire('nope')).toThrow(CircuitError);
    expect(() => fromWire(null)).toThrow(CircuitError);
    expect(() => fromWire([])).toThrow(CircuitError);
  });

  it('rejects a silly input count', () => {
    expect(() => fromWire({ ...good(), inputCount: 0 })).toThrow(CircuitError);
    expect(() => fromWire({ ...good(), inputCount: 99 })).toThrow(CircuitError);
    expect(() => fromWire({ ...good(), inputCount: 2.5 })).toThrow(CircuitError);
  });

  it('rejects a dangling reference', () => {
    const wire = good();
    wire.nodes[wire.nodes.length - 1].inputs = ['ghost'];
    expect(() => fromWire(wire)).toThrow(CircuitError);
  });

  it('rejects a cycle', () => {
    const wire = {
      inputCount: 1,
      outputId: 'x',
      nodes: [
        { id: 'x', kind: 'NOT', inputs: ['y'] },
        { id: 'y', kind: 'NOT', inputs: ['x'] },
      ],
      chips: [],
    };
    expect(() => fromWire(wire)).toThrow(/Cycle/);
  });

  it('rejects duplicate node ids', () => {
    const wire = good();
    wire.nodes.push({ ...wire.nodes[0] });
    expect(() => fromWire(wire)).toThrow(/duplicate/);
  });

  it('rejects an unknown gate kind', () => {
    const wire = good();
    wire.nodes[0] = { ...wire.nodes[0], kind: 'NAND' };
    expect(() => fromWire(wire)).toThrow(/unknown node kind/);
  });

  it('rejects a chip table that does not fit its arity', () => {
    const wire = good();
    wire.chips[0].table = '0xffff'; // 16 bits for a 2-parameter chip
    expect(() => fromWire(wire)).toThrow(/does not fit/);
  });

  it('caps the node count so a hostile payload cannot hang the server', () => {
    const wire = good();
    wire.nodes = Array.from({ length: 50 }, (_, i) => ({
      id: `n${i}`, kind: 'INPUT', inputs: [], inputIndex: 0,
    }));
    expect(() => fromWire(wire, { maxNodes: 10 })).toThrow(/Too many nodes/);
  });
});

describe('rowsMatching', () => {
  it('counts every row right when identical', () => {
    expect(rowsMatching(0x6n, 0x6n, 2)).toBe(4);
  });

  it('counts none when inverted', () => {
    expect(rowsMatching(0x9n, 0x6n, 2)).toBe(0);
  });

  it('scores partial progress in between', () => {
    // 0x7 vs 0x6 differ in one row of four.
    expect(rowsMatching(0x7n, 0x6n, 2)).toBe(3);
  });

  it('gives a constant the free floor it is owed, and no more', () => {
    // Target 0x6 has two ones and two zeros, so all-zero gets half.
    expect(rowsMatching(0x0n, 0x6n, 2)).toBe(2);
  });
});
