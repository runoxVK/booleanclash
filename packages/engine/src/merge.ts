import { CircuitBuilder, evaluateOutput } from './circuit.js';
import { identify } from './codex.js';
import { TUNING } from './tuning.js';
import {
  CircuitError,
  type ChipDefinition,
  type ChipId,
  type ChipRegistry,
  type Circuit,
  type CircuitNode,
  type NodeId,
} from './types.js';

/**
 * Merging: packaging a cluster of parts into the component it turns out to be.
 *
 * The rule is recognition. Select some parts; if what they compute is a
 * component the game knows — XOR, NAND, MUX, MAJORITY — they collapse into one
 * chip that counts as a single unit. If it is some arbitrary function, nothing
 * happens.
 *
 * That catalogue is what stops the obvious exploit. A player cannot squash their
 * whole answer into one chip and score 1, because their answer is an arbitrary
 * function and arbitrary functions are not in the catalogue. The generator holds
 * up the other end by never issuing a target that is itself a known component.
 *
 * Note what is deliberately absent: any search of the board. Nothing here looks
 * for clusters the player has not selected. Spotting that four gates happen to
 * be a XOR is the skill the game is made of.
 */

/* ------------------------------------------------------------------ */
/* Proposal result                                                    */
/* ------------------------------------------------------------------ */

export type MergeRejection =
  | 'empty-selection'
  | 'unknown-node'
  | 'contains-input'
  | 'too-many-nodes'
  | 'too-many-params'
  | 'multiple-outputs'
  | 'not-connected'
  | 'internal-fanout'
  | 'incomplete'
  | 'too-small'
  | 'not-a-component';

export interface MergeCandidate {
  /** Parts being packaged, root first. */
  readonly nodeIds: readonly NodeId[];
  /** Which circuit node feeds each pin of the new chip, in pin order. */
  readonly binding: readonly NodeId[];
  readonly arity: number;
  readonly table: bigint;
  /** The component's name. Always a known one, or this would be rejected. */
  readonly name: string;
  /** Parts collapsed into one, so the score falls by this much. */
  readonly saved: number;
  /** Set when the player already owns a chip computing exactly this. */
  readonly existingChipId: ChipId | null;
}

export type MergeProposal =
  | { readonly ok: true; readonly candidate: MergeCandidate }
  | {
      readonly ok: false;
      readonly reason: MergeRejection;
      readonly detail: string;
    };

function reject(reason: MergeRejection, detail: string): MergeProposal {
  return { ok: false, reason, detail };
}

/* ------------------------------------------------------------------ */
/* Working out what a selection computes                              */
/* ------------------------------------------------------------------ */

function consumersOf(circuit: Circuit): Map<NodeId, NodeId[]> {
  const map = new Map<NodeId, NodeId[]>();
  for (const node of circuit.nodes.values()) {
    for (const ref of node.inputs) {
      if (ref === null) continue;
      const list = map.get(ref);
      if (list) list.push(node.id);
      else map.set(ref, [node.id]);
    }
  }
  return map;
}

interface SubFunction {
  readonly arity: number;
  readonly table: bigint;
  /** External nodes feeding the selection, in pin order. */
  readonly binding: readonly NodeId[];
  /** Selected nodes reachable from the root, root first. */
  readonly nodeIds: readonly NodeId[];
}

/**
 * Rebuild the selection as a standalone circuit over its external inputs and
 * evaluate it, giving the function it computes.
 *
 * Working from behaviour rather than shape is what lets two players build a XOR
 * completely differently and both have it recognised — and it means a chip can
 * be built out of other chips without any special handling, since evaluation
 * already sees through them.
 */
function analyse(
  circuit: Circuit,
  selected: ReadonlySet<NodeId>,
  rootId: NodeId,
  registry: ChipRegistry,
): SubFunction {
  const paramIndex = new Map<NodeId, number>();
  const order: NodeId[] = [];

  // First pass: number the external sources in a deterministic traversal order.
  const walk = (id: NodeId, seen: Set<NodeId>): void => {
    if (seen.has(id)) return;
    seen.add(id);
    order.push(id);
    const node = circuit.nodes.get(id);
    if (!node) throw new CircuitError(`Unknown node "${id}"`);
    for (const ref of node.inputs) {
      if (ref === null) throw new CircuitError(`Node "${id}" has an empty pin`);
      if (selected.has(ref)) walk(ref, seen);
      else if (!paramIndex.has(ref)) paramIndex.set(ref, paramIndex.size);
    }
  };
  walk(rootId, new Set());

  const arity = paramIndex.size;
  const builder = new CircuitBuilder(Math.max(1, arity));
  const params: NodeId[] = [];
  for (let i = 0; i < arity; i++) params.push(builder.input(i));

  const rebuilt = new Map<NodeId, NodeId>();
  const rebuild = (id: NodeId): NodeId => {
    const done = rebuilt.get(id);
    if (done !== undefined) return done;

    const node = circuit.nodes.get(id);
    if (!node) throw new CircuitError(`Unknown node "${id}"`);

    const args = node.inputs.map((ref) => {
      if (ref === null) throw new CircuitError(`Node "${id}" has an empty pin`);
      if (selected.has(ref)) return rebuild(ref);
      const p = paramIndex.get(ref);
      if (p === undefined) throw new CircuitError(`Unmapped input for "${id}"`);
      return params[p];
    });

    let made: NodeId;
    switch (node.kind) {
      case 'NOT':
        made = builder.not(args[0]);
        break;
      case 'AND':
        made = builder.and(args[0], args[1]);
        break;
      case 'OR':
        made = builder.or(args[0], args[1]);
        break;
      case 'CHIP':
        if (node.chipId === undefined) {
          throw new CircuitError(`CHIP node "${id}" has no chipId`);
        }
        made = builder.chip(node.chipId, args);
        break;
      default:
        throw new CircuitError(`Node "${id}" cannot be packaged`);
    }
    rebuilt.set(id, made);
    return made;
  };

  builder.setOutput(rebuild(rootId));
  const table = evaluateOutput(builder.build(), registry);
  if (table === null) throw new CircuitError('Selection has no value');

  return { arity, table, binding: [...paramIndex.keys()], nodeIds: order };
}

/* ------------------------------------------------------------------ */
/* Proposing a merge                                                  */
/* ------------------------------------------------------------------ */

export function proposeMerge(
  circuit: Circuit,
  selection: readonly NodeId[],
  registry: ChipRegistry = new Map(),
): MergeProposal {
  const selected = new Set(selection);

  if (selected.size === 0) {
    return reject('empty-selection', 'Select some parts first.');
  }
  if (selected.size < 2) {
    return reject(
      'too-small',
      'One part is already one unit — packaging it would save nothing.',
    );
  }
  if (selected.size > TUNING.maxChipNodes) {
    return reject(
      'too-many-nodes',
      `A chip can hold at most ${TUNING.maxChipNodes} parts; this is ${selected.size}.`,
    );
  }

  for (const id of selected) {
    const node = circuit.nodes.get(id);
    if (!node) return reject('unknown-node', `Part "${id}" is not on the board.`);
    if (node.kind === 'INPUT') {
      return reject(
        'contains-input',
        'Circuit inputs cannot go inside a chip — they become its pins.',
      );
    }
    if (node.inputs.some((ref) => ref === null)) {
      return reject(
        'incomplete',
        'Wire up every pin in the selection before packaging it.',
      );
    }
  }

  const roots = [...selected].filter((id) => {
    for (const other of selected) {
      if (other === id) continue;
      if (circuit.nodes.get(other)?.inputs.includes(id)) return false;
    }
    return true;
  });

  if (roots.length !== 1) {
    return reject(
      'multiple-outputs',
      `A chip has one output; this selection has ${roots.length}. Pick parts that all feed one final part.`,
    );
  }
  const rootId = roots[0];

  /* Only the selection's output may be used elsewhere. If something inside it
     also feeds the outside, collapsing it would sever that connection. */
  const consumers = consumersOf(circuit);
  for (const id of selected) {
    if (id === rootId) continue;
    if (circuit.outputId === id) {
      return reject('internal-fanout', 'A part inside the selection is the circuit output.');
    }
    for (const consumer of consumers.get(id) ?? []) {
      if (!selected.has(consumer)) {
        return reject(
          'internal-fanout',
          'Something inside the selection feeds a part outside it. Only its final output may be used elsewhere.',
        );
      }
    }
  }

  const analysis = analyse(circuit, selected, rootId, registry);

  if (analysis.nodeIds.length !== selected.size) {
    return reject(
      'not-connected',
      'Every selected part has to feed the selection’s final output.',
    );
  }
  if (analysis.arity > TUNING.maxChipArity) {
    return reject(
      'too-many-params',
      `A chip can have at most ${TUNING.maxChipArity} pins; this needs ${analysis.arity}.`,
    );
  }

  const name = identify(analysis.arity, analysis.table);
  if (name === null) {
    return reject(
      'not-a-component',
      `Those ${selected.size} parts do not add up to a component the catalogue knows. Check the Components list for what to look for.`,
    );
  }

  let existingChipId: ChipId | null = null;
  for (const chip of registry.values()) {
    if (chip.arity === analysis.arity && chip.table === analysis.table) {
      existingChipId = chip.id;
      break;
    }
  }

  return {
    ok: true,
    candidate: {
      nodeIds: analysis.nodeIds,
      binding: analysis.binding,
      arity: analysis.arity,
      table: analysis.table,
      name,
      saved: selected.size - 1,
      existingChipId,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Applying a merge                                                   */
/* ------------------------------------------------------------------ */

export interface MergeOutcome {
  readonly circuit: Circuit;
  readonly registry: ChipRegistry;
  readonly chip: ChipDefinition;
  /** The chip node that replaced the selection. */
  readonly placedNodeId: NodeId;
}

function freshId(taken: ReadonlySet<NodeId>): NodeId {
  let n = 1;
  while (taken.has(`c${n}`)) n++;
  return `c${n}`;
}

/**
 * Swap the selected parts for a single chip.
 *
 * If the player already owns a chip computing this exact function it is reused
 * rather than duplicated — chip identity is behavioural, so you cannot end up
 * with two XORs under different names.
 */
export function applyMerge(
  circuit: Circuit,
  candidate: MergeCandidate,
  registry: ChipRegistry = new Map(),
): MergeOutcome {
  const existing = candidate.existingChipId
    ? registry.get(candidate.existingChipId)
    : undefined;

  const chip: ChipDefinition = existing ?? {
    id: `chip-${candidate.arity}-${candidate.table.toString(16)}`,
    name: candidate.name,
    arity: candidate.arity,
    table: candidate.table,
    // What it cost to build by hand — shown as "N parts inside".
    gateCost: candidate.nodeIds.length,
  };

  const doomed = new Set(candidate.nodeIds);
  const rootId = candidate.nodeIds[0];

  const nodes = new Map<NodeId, CircuitNode>();
  for (const [id, node] of circuit.nodes) {
    if (!doomed.has(id)) nodes.set(id, node);
  }

  const chipNodeId = freshId(new Set(circuit.nodes.keys()));
  nodes.set(chipNodeId, {
    id: chipNodeId,
    kind: 'CHIP',
    chipId: chip.id,
    inputs: [...candidate.binding],
  });

  // Anything that read the old cluster's output now reads the chip.
  for (const [id, node] of nodes) {
    if (id === chipNodeId) continue;
    if (!node.inputs.some((ref) => ref !== null && doomed.has(ref))) continue;
    nodes.set(id, {
      ...node,
      inputs: node.inputs.map((ref) =>
        ref !== null && doomed.has(ref) ? (ref === rootId ? chipNodeId : null) : ref,
      ),
    });
  }

  const outputId =
    circuit.outputId !== null && doomed.has(circuit.outputId)
      ? chipNodeId
      : circuit.outputId;

  const nextRegistry = new Map(registry);
  nextRegistry.set(chip.id, chip);

  return {
    circuit: { inputCount: circuit.inputCount, nodes, outputId },
    registry: nextRegistry,
    chip,
    placedNodeId: chipNodeId,
  };
}
