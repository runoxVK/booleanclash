import { describe, expect, it } from 'vitest';
import { CircuitBuilder, evaluateOutput, solves, validate } from '../src/circuit.js';
import {
  canonicalUnderPermutation,
  describeFunction,
  identify,
  permuteTable,
} from '../src/codex.js';
import { score, totalScore } from '../src/cost.js';
import { applyMerge, proposeMerge } from '../src/merge.js';
import { TUNING } from '../src/tuning.js';
import type { ChipDefinition, ChipRegistry, NodeId } from '../src/types.js';

/**
 * XOR(a,b) OR XOR(c,d) with every XOR spelled out in primitives.
 * Nine gates, and the shape the whole merge mechanic exists for.
 */
function twoXorsInPrimitives() {
  const b = new CircuitBuilder(4);
  const ins = [b.input(0), b.input(1), b.input(2), b.input(3)];

  const xor = (x: NodeId, y: NodeId) => {
    const anyOf = b.or(x, y);
    const bothOf = b.and(x, y);
    const notBoth = b.not(bothOf);
    const root = b.and(anyOf, notBoth);
    return { root, all: [root, anyOf, bothOf, notBoth] };
  };

  const left = xor(ins[0], ins[1]);
  const right = xor(ins[2], ins[3]);
  b.setOutput(b.or(left.root, right.root));

  return { circuit: b.build(), left, right, ins };
}

describe('the merge rule', () => {
  it('accepts a shape that appears twice at different bindings', () => {
    const { circuit, left } = twoXorsInPrimitives();
    const proposal = proposeMerge(circuit, left.all);

    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;

    const c = proposal.candidate;
    expect(c.arity).toBe(2);
    expect(c.table).toBe(0x6n);
    expect(c.gateCost).toBe(4);
    expect(c.name).toBe('XOR');
    expect(c.known).toBe(true);
    expect(c.matches).toHaveLength(2);

    // The two instances bind to different signals — that is the whole point.
    const [first, second] = c.matches;
    expect(first.binding).not.toEqual(second.binding);
  });

  it('refuses a shape that appears only once', () => {
    const b = new CircuitBuilder(2);
    const a0 = b.input(0);
    const a1 = b.input(1);
    const anyOf = b.or(a0, a1);
    const bothOf = b.and(a0, a1);
    const notBoth = b.not(bothOf);
    const root = b.and(anyOf, notBoth);
    b.setOutput(root);

    const proposal = proposeMerge(b.build(), [root, anyOf, bothOf, notBoth]);
    expect(proposal.ok).toBe(false);
    if (proposal.ok) return;
    expect(proposal.reason).toBe('not-enough-instances');
    expect(proposal.instances).toBe(1);
  });

  it('refuses two copies wired to the SAME inputs', () => {
    // The cheese: build XOR(a,b) twice so it looks reused, then merge. Bindings
    // are identical, so it counts as one instance. Free wire fan-out is what the
    // player should have used here.
    const b = new CircuitBuilder(2);
    const a0 = b.input(0);
    const a1 = b.input(1);

    const xor = () => {
      const anyOf = b.or(a0, a1);
      const bothOf = b.and(a0, a1);
      const notBoth = b.not(bothOf);
      const root = b.and(anyOf, notBoth);
      return { root, all: [root, anyOf, bothOf, notBoth] };
    };

    const first = xor();
    const second = xor();
    b.setOutput(b.and(first.root, second.root));

    const proposal = proposeMerge(b.build(), first.all);
    expect(proposal.ok).toBe(false);
    if (proposal.ok) return;
    expect(proposal.reason).toBe('not-enough-instances');
    expect(proposal.instances).toBe(1);
  });

  it('refuses a merge that would not pay for itself', () => {
    // Two AND gates at different bindings is a legal pattern, but wrapping a
    // single gate costs 1 + 1 pkg + 1 reuse = 3 against 2 inline. Offering this
    // move would be inviting the player into a trap.
    const { circuit } = twoXorsInPrimitives();
    const anAnd = [...circuit.nodes.values()].find((n) => n.kind === 'AND');
    expect(anAnd).toBeDefined();

    const proposal = proposeMerge(circuit, [anAnd!.id]);
    expect(proposal.ok).toBe(false);
    if (proposal.ok) return;
    expect(proposal.reason).toBe('no-saving');
  });

  it('reports the saving on an accepted merge', () => {
    const { circuit, left } = twoXorsInPrimitives();
    const proposal = proposeMerge(circuit, left.all);
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;
    // 2 x 4 inline = 8, against 4 + 1 pkg + 1 reuse = 6.
    expect(proposal.candidate.saved).toBe(2);
  });

  it('cannot swallow the whole solution, however hard you try', () => {
    // Selecting everything: the top-level answer is bound to the real inputs
    // exactly once, so it can never reach the instance threshold.
    const { circuit } = twoXorsInPrimitives();
    const everything = [...circuit.nodes.values()]
      .filter((n) => n.kind !== 'INPUT')
      .map((n) => n.id);

    const proposal = proposeMerge(circuit, everything);
    expect(proposal.ok).toBe(false);
    if (proposal.ok) return;
    // Rejected on size here; even with an unlimited cap it would fail on
    // instances, which is the property that actually matters.
    expect(proposal.reason).toBe('too-many-nodes');
  });
});

describe('merge rejections', () => {
  it('rejects an empty selection', () => {
    const { circuit } = twoXorsInPrimitives();
    const proposal = proposeMerge(circuit, []);
    expect(proposal.ok).toBe(false);
    if (!proposal.ok) expect(proposal.reason).toBe('empty-selection');
  });

  it('rejects a node that is not on the board', () => {
    const { circuit } = twoXorsInPrimitives();
    const proposal = proposeMerge(circuit, ['ghost']);
    expect(proposal.ok).toBe(false);
    if (!proposal.ok) expect(proposal.reason).toBe('unknown-node');
  });

  it('rejects circuit inputs, which are pins rather than gates', () => {
    const { circuit, left, ins } = twoXorsInPrimitives();
    const proposal = proposeMerge(circuit, [...left.all, ins[0]]);
    expect(proposal.ok).toBe(false);
    if (!proposal.ok) expect(proposal.reason).toBe('contains-input');
  });

  it('rejects nesting a chip inside a chip (deferred feature)', () => {
    const xorChip: ChipDefinition = {
      id: 'chip-xor',
      name: 'XOR',
      arity: 2,
      table: 0x6n,
      gateCost: 4,
    };
    const b = new CircuitBuilder(4);
    const ins = [b.input(0), b.input(1), b.input(2), b.input(3)];
    const chipNode = b.chip(xorChip.id, [ins[0], ins[1]]);
    const root = b.and(chipNode, ins[2]);
    b.setOutput(root);

    const proposal = proposeMerge(b.build(), [root, chipNode]);
    expect(proposal.ok).toBe(false);
    if (!proposal.ok) expect(proposal.reason).toBe('contains-chip');
  });

  it('rejects a selection bigger than the chip size cap', () => {
    const { circuit } = twoXorsInPrimitives();
    const gates = [...circuit.nodes.values()]
      .filter((n) => n.kind !== 'INPUT')
      .map((n) => n.id);
    expect(gates.length).toBeGreaterThan(TUNING.maxChipNodes);

    const proposal = proposeMerge(circuit, gates);
    expect(proposal.ok).toBe(false);
    if (!proposal.ok) expect(proposal.reason).toBe('too-many-nodes');
  });

  it('rejects a chip that would need too many pins', () => {
    const b = new CircuitBuilder(5);
    const ins = [0, 1, 2, 3, 4].map((i) => b.input(i));
    const or1 = b.or(ins[0], ins[1]);
    const or2 = b.or(or1, ins[2]);
    const or3 = b.or(or2, ins[3]);
    const or4 = b.or(or3, ins[4]);
    b.setOutput(or4);

    const proposal = proposeMerge(b.build(), [or1, or2, or3, or4]);
    expect(proposal.ok).toBe(false);
    if (!proposal.ok) expect(proposal.reason).toBe('too-many-params');
  });

  it('rejects a selection with two outputs', () => {
    const { circuit, left, right } = twoXorsInPrimitives();
    const proposal = proposeMerge(circuit, [left.root, right.root]);
    expect(proposal.ok).toBe(false);
    if (!proposal.ok) expect(proposal.reason).toBe('multiple-outputs');
  });

  it('rejects a selection whose insides are used outside it', () => {
    // `anyOf` feeds both the XOR root and an unrelated gate. Replacing the
    // selection with one chip would sever that second connection.
    const b = new CircuitBuilder(4);
    const ins = [b.input(0), b.input(1), b.input(2), b.input(3)];
    const anyOf = b.or(ins[0], ins[1]);
    const bothOf = b.and(ins[0], ins[1]);
    const notBoth = b.not(bothOf);
    const root = b.and(anyOf, notBoth);
    const leak = b.and(anyOf, ins[2]);
    b.setOutput(b.or(root, leak));

    const proposal = proposeMerge(b.build(), [root, anyOf, bothOf, notBoth]);
    expect(proposal.ok).toBe(false);
    if (!proposal.ok) expect(proposal.reason).toBe('internal-fanout');
  });
});

describe('applying a merge', () => {
  it('preserves behaviour and cuts the score from 9 to 7', () => {
    const { circuit, left } = twoXorsInPrimitives();
    const target = evaluateOutput(circuit);
    expect(target).not.toBeNull();
    expect(totalScore(circuit)).toBe(9);

    const proposal = proposeMerge(circuit, left.all);
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;

    const outcome = applyMerge(circuit, proposal.candidate, new Map());

    // Still a valid circuit, still the same function.
    expect(() => validate(outcome.circuit)).not.toThrow();
    expect(solves(outcome.circuit, target as bigint, outcome.registry)).toBe(true);

    const after = score(outcome.circuit, outcome.registry);
    expect(after.total).toBe(7);
    expect(after.totalSaved).toBe(2);
    expect(after.chips).toHaveLength(1);
    expect(after.chips[0].name).toBe('XOR');
    expect(after.chips[0].instances).toBe(2);
    expect(outcome.placedNodeIds).toHaveLength(2);
  });

  it('leaves no orphaned gates behind', () => {
    const { circuit, left } = twoXorsInPrimitives();
    const proposal = proposeMerge(circuit, left.all);
    if (!proposal.ok) throw new Error('expected a valid merge');

    const outcome = applyMerge(circuit, proposal.candidate, new Map());
    const kinds = [...outcome.circuit.nodes.values()].map((n) => n.kind);

    expect(kinds.filter((k) => k === 'CHIP')).toHaveLength(2);
    expect(kinds.filter((k) => k === 'OR')).toHaveLength(1);
    expect(kinds.filter((k) => k === 'AND')).toHaveLength(0);
    expect(kinds.filter((k) => k === 'NOT')).toHaveLength(0);
  });

  it('reuses an equivalent chip the player already owns', () => {
    // Chip identity is behavioural, so you cannot end up with two XORs under
    // different names.
    const owned: ChipDefinition = {
      id: 'my-xor',
      name: 'Sparky',
      arity: 2,
      table: 0x6n,
      gateCost: 4,
    };
    const registry: ChipRegistry = new Map([[owned.id, owned]]);

    const { circuit, left } = twoXorsInPrimitives();
    const proposal = proposeMerge(circuit, left.all, registry);
    expect(proposal.ok).toBe(true);
    if (!proposal.ok) return;
    expect(proposal.candidate.existingChipId).toBe('my-xor');

    const outcome = applyMerge(circuit, proposal.candidate, registry);
    expect(outcome.chip.id).toBe('my-xor');
    expect(outcome.chip.name).toBe('Sparky');
    expect(outcome.registry.size).toBe(1);
  });

  it('honours a player-chosen name for a new chip', () => {
    const { circuit, left } = twoXorsInPrimitives();
    const proposal = proposeMerge(circuit, left.all);
    if (!proposal.ok) throw new Error('expected a valid merge');

    const outcome = applyMerge(circuit, proposal.candidate, new Map(), {
      name: 'Wobble',
    });
    expect(outcome.chip.name).toBe('Wobble');
  });
});

describe('the codex', () => {
  it('names the classics', () => {
    expect(identify(2, 0x6n)).toBe('XOR');
    expect(identify(2, 0x8n)).toBe('AND');
    expect(identify(2, 0x7n)).toBe('NAND');
    expect(identify(2, 0x9n)).toBe('XNOR');
    expect(identify(3, 0xe8n)).toBe('MAJORITY');
    expect(identify(3, 0x96n)).toBe('XOR3');
    expect(identify(3, 0xcan)).toBe('MUX');
    expect(identify(1, 0x1n)).toBe('NOT');
  });

  it('recognizes a function whose pins came out in a different order', () => {
    // Parameter order falls out of a graph traversal, so a player's MUX may be
    // pin-shuffled. It is still a MUX.
    const shuffled = permuteTable(0xcan, 3, [1, 2, 0]);
    expect(shuffled).not.toBe(0xcan);
    expect(identify(3, shuffled)).toBe('MUX');
  });

  it('canonicalization is stable under any permutation', () => {
    const base = canonicalUnderPermutation(0xcan, 3);
    for (const perm of [
      [0, 1, 2],
      [0, 2, 1],
      [1, 0, 2],
      [1, 2, 0],
      [2, 0, 1],
      [2, 1, 0],
    ]) {
      expect(canonicalUnderPermutation(permuteTable(0xcan, 3, perm), 3)).toBe(base);
    }
  });

  it('falls back to a generated tag for anonymous functions', () => {
    expect(identify(2, 0x3n)).toBeNull();
    expect(describeFunction(2, 0x3n)).toBe('F2-3');
  });
});
