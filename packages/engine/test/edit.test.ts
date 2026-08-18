import { describe, expect, it } from 'vitest';
import { CircuitBuilder, evaluate, evaluateOutput, validate } from '../src/circuit.js';
import {
  addChip,
  addGate,
  canConnect,
  connect,
  disconnect,
  removeNodes,
  setOutput,
} from '../src/edit.js';
import { proposeMerge } from '../src/merge.js';
import type { ChipDefinition } from '../src/types.js';

function board(inputCount = 2) {
  const b = new CircuitBuilder(inputCount);
  const ins = Array.from({ length: inputCount }, (_, i) => b.input(i));
  return { circuit: b.build(), ins };
}

describe('placing parts', () => {
  it('drops a gate with every pin empty', () => {
    const { circuit } = board();
    const { circuit: next, id } = addGate(circuit, 'AND');

    expect(next.nodes.get(id)?.inputs).toEqual([null, null]);
    expect(() => validate(next)).not.toThrow();
  });

  it('leaves a half-wired gate with no value at all', () => {
    // Not zero — no value. A gate missing an input has no defined behaviour,
    // and showing 0 would quietly lie about it.
    const { circuit, ins } = board();
    const placed = addGate(circuit, 'AND');
    const wired = connect(placed.circuit, placed.id, 0, ins[0]);

    expect(evaluate(wired).has(placed.id)).toBe(false);

    const complete = connect(wired, placed.id, 1, ins[1]);
    expect(evaluate(complete).get(placed.id)).toBe(0x8n);
  });

  it('gives a chip one pin per parameter', () => {
    const xor: ChipDefinition = {
      id: 'chip-xor', name: 'XOR', arity: 2, table: 0x6n, gateCost: 4,
    };
    const { circuit } = board();
    const { circuit: next, id } = addChip(circuit, xor);
    expect(next.nodes.get(id)?.inputs).toEqual([null, null]);
  });
});

describe('wiring', () => {
  it('refuses a wire that would loop back on itself', () => {
    const { circuit, ins } = board();
    const a = addGate(circuit, 'NOT');
    const b = addGate(a.circuit, 'NOT');

    let c = connect(b.circuit, a.id, 0, ins[0]);
    c = connect(c, b.id, 0, a.id); // a -> b

    const check = canConnect(c, a.id, 0, b.id); // b -> a would close the loop
    expect(check.ok).toBe(false);
    expect(check.reason).toBe('loop');
    expect(connect(c, a.id, 0, b.id)).toBe(c); // and nothing changes
  });

  it('refuses to plug anything into a circuit input', () => {
    const { circuit, ins } = board();
    const g = addGate(circuit, 'NOT');
    expect(canConnect(g.circuit, ins[0], 0, g.id).reason).toBe('into-input');
  });

  it('refuses a part feeding itself', () => {
    const { circuit } = board();
    const g = addGate(circuit, 'NOT');
    expect(canConnect(g.circuit, g.id, 0, g.id).reason).toBe('self');
  });

  it('replaces whatever was in the pin — one wire per pin', () => {
    const { circuit, ins } = board();
    const g = addGate(circuit, 'AND');
    let c = connect(g.circuit, g.id, 0, ins[0]);
    c = connect(c, g.id, 0, ins[1]);
    expect(c.nodes.get(g.id)?.inputs[0]).toBe(ins[1]);
  });

  it('lets one output fan out to many pins for free', () => {
    const { circuit, ins } = board();
    const g = addGate(circuit, 'AND');
    let c = connect(g.circuit, g.id, 0, ins[0]);
    c = connect(c, g.id, 1, ins[0]);
    expect(evaluate(c).get(g.id)).toBe(evaluate(c).get(ins[0]));
  });

  it('unplugs a pin without removing the part', () => {
    const { circuit, ins } = board();
    const g = addGate(circuit, 'NOT');
    const wired = connect(g.circuit, g.id, 0, ins[0]);
    const cut = disconnect(wired, g.id, 0);

    expect(cut.nodes.has(g.id)).toBe(true);
    expect(cut.nodes.get(g.id)?.inputs[0]).toBeNull();
  });
});

describe('removing parts', () => {
  it('empties the pins that pointed at it instead of cascading', () => {
    // Deleting one gate should not silently take the rest of a branch with it.
    const { circuit, ins } = board();
    const inner = addGate(circuit, 'AND');
    const outer = addGate(inner.circuit, 'NOT');
    let c = connect(outer.circuit, inner.id, 0, ins[0]);
    c = connect(c, inner.id, 1, ins[1]);
    c = connect(c, outer.id, 0, inner.id);

    const after = removeNodes(c, [inner.id]);
    expect(after.nodes.has(outer.id)).toBe(true);
    expect(after.nodes.get(outer.id)?.inputs[0]).toBeNull();
    expect(() => validate(after)).not.toThrow();
  });

  it('never removes a circuit input', () => {
    const { circuit, ins } = board();
    expect(removeNodes(circuit, [ins[0]]).nodes.has(ins[0])).toBe(true);
  });

  it('clears the output when the output part goes', () => {
    const { circuit, ins } = board();
    const g = addGate(circuit, 'NOT');
    let c = connect(g.circuit, g.id, 0, ins[0]);
    c = setOutput(c, g.id);
    expect(evaluateOutput(c)).toBe(0x5n);
    expect(removeNodes(c, [g.id]).outputId).toBeNull();
  });
});

describe('merging a half-wired selection', () => {
  it('is refused until every pin is filled', () => {
    const { circuit, ins } = board(4);
    const inner = addGate(circuit, 'AND');
    const outer = addGate(inner.circuit, 'NOT');
    let c = connect(outer.circuit, inner.id, 0, ins[0]);
    c = connect(c, outer.id, 0, inner.id);
    // inner's second pin is still empty.

    const proposal = proposeMerge(c, [inner.id, outer.id]);
    expect(proposal.ok).toBe(false);
    if (!proposal.ok) expect(proposal.reason).toBe('incomplete');
  });
});
