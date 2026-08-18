import { reachableFrom, validate } from './circuit.js';
import {
  PRIMITIVE_ARITY,
  type ChipDefinition,
  type Circuit,
  type CircuitNode,
  type NodeId,
} from './types.js';

/**
 * Editing a circuit: placing parts, wiring pins, cutting wires, removing parts.
 *
 * These live in the engine rather than the app because they are rules, not
 * presentation — "you cannot wire a loop", "a pin holds one wire" — and the
 * server will need to replay them to check a submitted game.
 *
 * Every operation returns a new circuit; nothing is mutated in place.
 */

export interface Placement {
  readonly circuit: Circuit;
  readonly id: NodeId;
}

function freshId(circuit: Circuit): NodeId {
  let n = 1;
  while (circuit.nodes.has(`g${n}`)) n++;
  return `g${n}`;
}

function withNodes(circuit: Circuit, nodes: Map<NodeId, CircuitNode>, outputId = circuit.outputId): Circuit {
  return { inputCount: circuit.inputCount, nodes, outputId };
}

/** Drop a primitive onto the board with every pin still empty. */
export function addGate(circuit: Circuit, kind: 'NOT' | 'AND' | 'OR'): Placement {
  const id = freshId(circuit);
  const nodes = new Map(circuit.nodes);
  nodes.set(id, {
    id,
    kind,
    inputs: new Array<NodeId | null>(PRIMITIVE_ARITY[kind]).fill(null),
  });
  return { circuit: withNodes(circuit, nodes), id };
}

/** Drop a chip onto the board with every pin still empty. */
export function addChip(circuit: Circuit, chip: ChipDefinition): Placement {
  const id = freshId(circuit);
  const nodes = new Map(circuit.nodes);
  nodes.set(id, {
    id,
    kind: 'CHIP',
    chipId: chip.id,
    inputs: new Array<NodeId | null>(chip.arity).fill(null),
  });
  return { circuit: withNodes(circuit, nodes), id };
}

export type WireRefusal =
  | 'no-such-part'
  | 'no-such-pin'
  | 'into-input'
  | 'self'
  | 'loop';

export interface WireCheck {
  readonly ok: boolean;
  readonly reason?: WireRefusal;
  readonly detail?: string;
}

/**
 * Would this wire be legal?
 *
 * The interesting case is `loop`: feeding a signal back into something that
 * already feeds it would make the circuit refer to itself, and a combinational
 * circuit has no answer for that. Checking it up front lets the UI refuse the
 * drag instead of throwing after the fact.
 */
export function canConnect(
  circuit: Circuit,
  targetId: NodeId,
  pin: number,
  sourceId: NodeId,
): WireCheck {
  const target = circuit.nodes.get(targetId);
  const source = circuit.nodes.get(sourceId);

  if (!target || !source) return { ok: false, reason: 'no-such-part' };
  if (targetId === sourceId) {
    return { ok: false, reason: 'self', detail: 'A part cannot feed itself.' };
  }
  if (target.kind === 'INPUT') {
    return {
      ok: false,
      reason: 'into-input',
      detail: 'Circuit inputs are sources — nothing plugs into them.',
    };
  }
  if (pin < 0 || pin >= target.inputs.length) {
    return { ok: false, reason: 'no-such-pin' };
  }
  if (reachableFrom(circuit, sourceId).has(targetId)) {
    return {
      ok: false,
      reason: 'loop',
      detail: 'That would feed a signal back into itself.',
    };
  }
  return { ok: true };
}

/**
 * Plug `sourceId` into pin `pin` of `targetId`, replacing whatever was there.
 * A pin holds exactly one wire; outputs may fan out freely and for free.
 */
export function connect(
  circuit: Circuit,
  targetId: NodeId,
  pin: number,
  sourceId: NodeId,
): Circuit {
  const check = canConnect(circuit, targetId, pin, sourceId);
  if (!check.ok) return circuit;

  const target = circuit.nodes.get(targetId);
  if (!target) return circuit;

  const inputs = [...target.inputs];
  inputs[pin] = sourceId;

  const nodes = new Map(circuit.nodes);
  nodes.set(targetId, { ...target, inputs });
  return withNodes(circuit, nodes);
}

/** Pull the wire out of one pin, leaving the part in place. */
export function disconnect(
  circuit: Circuit,
  targetId: NodeId,
  pin: number,
): Circuit {
  const target = circuit.nodes.get(targetId);
  if (!target || pin < 0 || pin >= target.inputs.length) return circuit;
  if (target.inputs[pin] === null) return circuit;

  const inputs = [...target.inputs];
  inputs[pin] = null;

  const nodes = new Map(circuit.nodes);
  nodes.set(targetId, { ...target, inputs });
  return withNodes(circuit, nodes);
}

/**
 * Remove parts, emptying any pin that referred to them.
 *
 * Deliberately does NOT cascade. Deleting one gate should not silently take a
 * branch of somebody's work with it — the downstream parts stay put with an
 * empty pin, which is visible and immediately re-wirable. Circuit inputs are
 * fixtures and are never removed.
 */
export function removeNodes(
  circuit: Circuit,
  ids: readonly NodeId[],
): Circuit {
  const doomed = new Set(
    ids.filter((id) => circuit.nodes.get(id)?.kind !== 'INPUT'),
  );
  if (doomed.size === 0) return circuit;

  const nodes = new Map<NodeId, CircuitNode>();
  for (const [id, node] of circuit.nodes) {
    if (doomed.has(id)) continue;
    nodes.set(id, {
      ...node,
      inputs: node.inputs.map((ref) =>
        ref !== null && doomed.has(ref) ? null : ref,
      ),
    });
  }

  const outputId =
    circuit.outputId !== null && doomed.has(circuit.outputId)
      ? null
      : circuit.outputId;

  const next = withNodes(circuit, nodes, outputId);
  validate(next);
  return next;
}

export function setOutput(circuit: Circuit, id: NodeId | null): Circuit {
  if (id !== null) {
    const node = circuit.nodes.get(id);
    if (!node || node.kind === 'INPUT') return circuit;
  }
  return withNodes(circuit, new Map(circuit.nodes), id);
}
