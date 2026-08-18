import { describe, expect, it } from 'vitest';
import { CircuitBuilder, evaluateOutput, validate } from '../src/circuit.js';
import {
  canonicalUnderPermutation,
  COMPONENTS,
  identify,
  isKnownComponent,
  permuteTable,
} from '../src/codex.js';
import { score, totalScore } from '../src/cost.js';
import { addGate, connect, setOutput } from '../src/edit.js';
import { applyMerge, proposeMerge } from '../src/merge.js';
import type { NodeId } from '../src/types.js';

/** XOR as (a OR b) AND NOT(a AND b) — four loose parts. */
function xorBoard(inputCount = 2) {
  const b = new CircuitBuilder(inputCount);
  const ins = Array.from({ length: inputCount }, (_, i) => b.input(i));
  const anyOf = b.or(ins[0], ins[1]);
  const bothOf = b.and(ins[0], ins[1]);
  const notBoth = b.not(bothOf);
  const root = b.and(anyOf, notBoth);
  b.setOutput(root);
  return { circuit: b.build(), ins, parts: [root, anyOf, bothOf, notBoth] };
}

describe('packaging a component', () => {
  it('recognises four parts that add up to a XOR', () => {
    const { circuit, parts } = xorBoard();
    const proposal = proposeMerge(circuit, parts);

    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;

    expect(proposal.candidate.name).toBe('XOR');
    expect(proposal.candidate.arity).toBe(2);
    expect(proposal.candidate.table).toBe(0x6n);
    // Four units become one.
    expect(proposal.candidate.saved).toBe(3);
  });

  it('collapses them into a single unit that behaves the same', () => {
    const { circuit, parts } = xorBoard();
    const target = evaluateOutput(circuit);
    expect(totalScore(circuit)).toBe(4);

    const proposal = proposeMerge(circuit, parts);
    if (!proposal.ok) throw new Error('expected a valid merge');
    const outcome = applyMerge(circuit, proposal.candidate);

    expect(() => validate(outcome.circuit)).not.toThrow();
    expect(evaluateOutput(outcome.circuit, outcome.registry)).toBe(target);
    expect(totalScore(outcome.circuit, outcome.registry)).toBe(1);
    expect(outcome.chip.name).toBe('XOR');
  });

  it('recognises a component however it was wired', () => {
    // (a AND NOT b) OR (NOT a AND b) — five parts, same function.
    const b = new CircuitBuilder(2);
    const a0 = b.input(0);
    const a1 = b.input(1);
    const left = b.and(a0, b.not(a1));
    const right = b.and(b.not(a0), a1);
    const root = b.or(left, right);
    b.setOutput(root);
    const circuit = b.build();

    const parts = [...circuit.nodes.values()]
      .filter((n) => n.kind !== 'INPUT')
      .map((n) => n.id);

    const proposal = proposeMerge(circuit, parts);
    expect(proposal.ok).toBe(true);
    if (proposal.ok) expect(proposal.candidate.name).toBe('XOR');
  });

  it('reuses an equivalent chip the player already owns', () => {
    const first = xorBoard();
    const p1 = proposeMerge(first.circuit, first.parts);
    if (!p1.ok) throw new Error('expected a valid merge');
    const owned = applyMerge(first.circuit, p1.candidate);

    const second = xorBoard();
    const p2 = proposeMerge(second.circuit, second.parts, owned.registry);
    expect(p2.ok).toBe(true);
    if (!p2.ok) return;
    expect(p2.candidate.existingChipId).toBe(owned.chip.id);

    const outcome = applyMerge(second.circuit, p2.candidate, owned.registry);
    expect(outcome.registry.size).toBe(1);
  });
});

describe('what the catalogue refuses', () => {
  it('refuses an arbitrary function', () => {
    // (a OR b) AND c is a perfectly good circuit and not a named component.
    const b = new CircuitBuilder(3);
    const ins = [b.input(0), b.input(1), b.input(2)];
    const anyOf = b.or(ins[0], ins[1]);
    const root = b.and(anyOf, ins[2]);
    b.setOutput(root);

    const proposal = proposeMerge(b.build(), [root, anyOf]);
    expect(proposal.ok).toBe(false);
    if (!proposal.ok) expect(proposal.reason).toBe('not-a-component');
  });

  it('is what stops the whole answer becoming one chip', () => {
    // The exploit the catalogue exists to prevent: select everything and
    // package it. It fails because an arbitrary answer has no name.
    const b = new CircuitBuilder(4);
    const ins = [b.input(0), b.input(1), b.input(2), b.input(3)];
    const l = b.and(ins[0], ins[1]);
    const r = b.or(ins[2], ins[3]);
    const root = b.and(l, b.not(r));
    b.setOutput(root);
    const circuit = b.build();

    const everything = [...circuit.nodes.values()]
      .filter((n) => n.kind !== 'INPUT')
      .map((n) => n.id);

    const proposal = proposeMerge(circuit, everything);
    expect(proposal.ok).toBe(false);
    if (!proposal.ok) expect(proposal.reason).toBe('not-a-component');
  });

  it('refuses a single part, which is already one unit', () => {
    const { circuit, parts } = xorBoard();
    const proposal = proposeMerge(circuit, [parts[0]]);
    expect(proposal.ok).toBe(false);
    if (!proposal.ok) expect(proposal.reason).toBe('too-small');
  });

  it('refuses circuit inputs', () => {
    const { circuit, parts, ins } = xorBoard();
    const proposal = proposeMerge(circuit, [...parts, ins[0]]);
    expect(proposal.ok).toBe(false);
    if (!proposal.ok) expect(proposal.reason).toBe('contains-input');
  });

  it('refuses a selection with an empty pin', () => {
    const b = new CircuitBuilder(2);
    const ins = [b.input(0), b.input(1)];
    const base = b.build();
    const placed = addGate(base, 'AND');
    const half = connect(placed.circuit, placed.id, 0, ins[0]);
    const second = addGate(half, 'NOT');
    const wired = connect(second.circuit, second.id, 0, placed.id);

    const proposal = proposeMerge(wired, [placed.id, second.id]);
    expect(proposal.ok).toBe(false);
    if (!proposal.ok) expect(proposal.reason).toBe('incomplete');
  });

  it('refuses a selection with two separate outputs', () => {
    const { circuit, parts } = xorBoard(4);
    // The OR and the NOT are both ends of their own little chains.
    const proposal = proposeMerge(circuit, [parts[1], parts[3]]);
    expect(proposal.ok).toBe(false);
    if (!proposal.ok) expect(proposal.reason).toBe('multiple-outputs');
  });

  it('refuses when something inside the selection feeds the outside', () => {
    const b = new CircuitBuilder(3);
    const ins = [b.input(0), b.input(1), b.input(2)];
    const anyOf = b.or(ins[0], ins[1]);
    const bothOf = b.and(ins[0], ins[1]);
    const notBoth = b.not(bothOf);
    const root = b.and(anyOf, notBoth);
    const leak = b.and(anyOf, ins[2]); // anyOf is used outside the XOR too
    b.setOutput(b.or(root, leak));

    const proposal = proposeMerge(b.build(), [root, anyOf, bothOf, notBoth]);
    expect(proposal.ok).toBe(false);
    if (!proposal.ok) expect(proposal.reason).toBe('internal-fanout');
  });
});

describe('chips inside chips', () => {
  it('packages a component built partly out of other chips', () => {
    // Make a XOR chip, place it against a third input with more parts, and
    // check the result is still analysed by behaviour.
    const first = xorBoard(3);
    const p1 = proposeMerge(first.circuit, first.parts);
    if (!p1.ok) throw new Error('expected a valid merge');
    const step = applyMerge(first.circuit, p1.candidate);

    const ins = [...step.circuit.nodes.values()]
      .filter((n) => n.kind === 'INPUT')
      .map((n) => n.id);
    const chipNode = step.placedNodeId;

    // XOR(a,b) XOR c  ==  XOR3, built from a chip plus loose parts.
    let c = step.circuit;
    const anyOf = addGate(c, 'OR');
    c = connect(anyOf.circuit, anyOf.id, 0, chipNode);
    c = connect(c, anyOf.id, 1, ins[2]);
    const bothOf = addGate(c, 'AND');
    c = connect(bothOf.circuit, bothOf.id, 0, chipNode);
    c = connect(c, bothOf.id, 1, ins[2]);
    const notBoth = addGate(c, 'NOT');
    c = connect(notBoth.circuit, notBoth.id, 0, bothOf.id);
    const root = addGate(c, 'AND');
    c = connect(root.circuit, root.id, 0, anyOf.id);
    c = connect(c, root.id, 1, notBoth.id);
    // The output still points at the inner chip from the first merge; move it
    // to the new final part, exactly as docking does in play.
    c = setOutput(c, root.id);

    const proposal = proposeMerge(
      c,
      [root.id, anyOf.id, bothOf.id, notBoth.id, chipNode],
      step.registry,
    );
    expect(proposal.ok).toBe(true);
    if (proposal.ok) expect(proposal.candidate.name).toBe('XOR3');
  });
});

describe('the catalogue', () => {
  it('names the classics', () => {
    expect(identify(2, 0x6n)).toBe('XOR');
    expect(identify(2, 0x7n)).toBe('NAND');
    expect(identify(2, 0x9n)).toBe('XNOR');
    expect(identify(3, 0xe8n)).toBe('MAJORITY');
    expect(identify(3, 0xcan)).toBe('MUX');
    expect(identify(3, 0x96n)).toBe('XOR3');
  });

  it('recognises a component whose pins came out in a different order', () => {
    const shuffled = permuteTable(0xcan, 3, [1, 2, 0]);
    expect(shuffled).not.toBe(0xcan);
    expect(identify(3, shuffled)).toBe('MUX');
    expect(canonicalUnderPermutation(shuffled, 3)).toBe(
      canonicalUnderPermutation(0xcan, 3),
    );
  });

  it('excludes the primitives, so packaging a lone gate is never a discovery', () => {
    expect(isKnownComponent(2, 0x8n)).toBe(false); // AND
    expect(isKnownComponent(2, 0xen)).toBe(false); // OR
    expect(isKnownComponent(1, 0x1n)).toBe(false); // NOT
  });

  it('excludes constants and anything ignoring an input', () => {
    expect(isKnownComponent(2, 0x0n)).toBe(false);
    expect(isKnownComponent(2, 0xfn)).toBe(false);
    expect(isKnownComponent(2, 0xan)).toBe(false); // just parameter 0
  });

  it('publishes a catalogue for the player to hunt against', () => {
    expect(COMPONENTS.length).toBeGreaterThan(5);
    for (const component of COMPONENTS) {
      expect(identify(component.arity, component.table)).toBe(component.name);
      expect(component.blurb.length).toBeGreaterThan(10);
    }
  });
});

describe('scoring after packaging', () => {
  it('charges one unit per chip however much went into it', () => {
    const { circuit, parts } = xorBoard();
    const proposal = proposeMerge(circuit, parts);
    if (!proposal.ok) throw new Error('expected a valid merge');
    const outcome = applyMerge(circuit, proposal.candidate);

    const breakdown = score(outcome.circuit, outcome.registry);
    expect(breakdown.total).toBe(1);
    expect(breakdown.chips).toHaveLength(1);
    expect(breakdown.chips[0].partsInside).toBe(4);
    expect(breakdown.chips[0].subtotal).toBe(1);
    expect(breakdown.chips[0].saved).toBe(3);
  });

  it('leaves no orphaned parts behind', () => {
    const { circuit, parts } = xorBoard();
    const proposal = proposeMerge(circuit, parts);
    if (!proposal.ok) throw new Error('expected a valid merge');
    const outcome = applyMerge(circuit, proposal.candidate);

    const kinds = [...outcome.circuit.nodes.values()].map((n) => n.kind);
    expect(kinds.filter((k) => k === 'CHIP')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'AND' || k === 'OR' || k === 'NOT')).toHaveLength(0);
  });

  it('keeps the packaged chip as the circuit output', () => {
    const { circuit, parts } = xorBoard();
    const proposal = proposeMerge(circuit, parts);
    if (!proposal.ok) throw new Error('expected a valid merge');
    const outcome = applyMerge(circuit, proposal.candidate);
    expect(outcome.circuit.outputId).toBe(outcome.placedNodeId);
  });
});

describe('placing a discovered chip again', () => {
  it('costs one unit per placement', () => {
    const { circuit, parts } = xorBoard(4);
    const proposal = proposeMerge(circuit, parts);
    if (!proposal.ok) throw new Error('expected a valid merge');
    const outcome = applyMerge(circuit, proposal.candidate);

    const ins = [...outcome.circuit.nodes.values()]
      .filter((n) => n.kind === 'INPUT')
      .map((n) => n.id);

    // A second XOR on c and d, placed rather than rebuilt.
    let c = outcome.circuit;
    const second: NodeId = 'c9';
    const nodes = new Map(c.nodes);
    nodes.set(second, {
      id: second,
      kind: 'CHIP',
      chipId: outcome.chip.id,
      inputs: [ins[2], ins[3]],
    });
    c = { ...c, nodes };

    const joined = addGate(c, 'OR');
    c = connect(joined.circuit, joined.id, 0, outcome.placedNodeId);
    c = connect(c, joined.id, 1, second);
    c = { ...c, outputId: joined.id };

    // Two chips and an OR: three units, against nine loose parts.
    expect(totalScore(c, outcome.registry)).toBe(3);
    expect(score(c, outcome.registry).chips[0].instances).toBe(2);
  });
});
