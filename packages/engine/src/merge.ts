import { CircuitBuilder, evaluateOutput } from './circuit.js';
import { describeFunction, identify } from './codex.js';
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
 * Merging: turning a repeated subcircuit into a reusable chip.
 *
 * This is the rule the whole design rests on. A selection may become a chip only
 * if the same SHAPE appears at least `minChipInstances` times with DIFFERENT
 * input bindings.
 *
 * Why that single rule is enough to keep the game from collapsing: free wire
 * fan-out already covers reusing the same signal, so chips exist only for
 * applying the same function to different signals. The player's final answer is
 * bound to the circuit's real inputs exactly once, so it can never reach the
 * threshold. "Merge the whole solution into one chip" is impossible by
 * construction — no whitelist of allowed combinations required.
 */

/* ------------------------------------------------------------------ */
/* Patterns                                                           */
/* ------------------------------------------------------------------ */

export type PrimitiveGate = 'NOT' | 'AND' | 'OR';

/** Where one of a pattern node's inputs comes from. */
export type PatternRef =
  | { readonly kind: 'node'; readonly index: number }
  | { readonly kind: 'param'; readonly index: number };

export interface PatternNode {
  readonly gate: PrimitiveGate;
  readonly inputs: readonly PatternRef[];
}

/**
 * A subcircuit with its external inputs abstracted into numbered parameters.
 * Node 0 is always the root (the pattern's output).
 */
export interface Pattern {
  readonly nodes: readonly PatternNode[];
  readonly arity: number;
  /** Structural fingerprint. Equal keys mean identical shape. */
  readonly key: string;
}

/** One place in the circuit where a pattern occurs. */
export interface PatternMatch {
  /** The node producing this instance's output. */
  readonly rootId: NodeId;
  /** Every node belonging to this instance, root included. */
  readonly nodeIds: readonly NodeId[];
  /** Which circuit node feeds each parameter, in parameter order. */
  readonly binding: readonly NodeId[];
}

function isPrimitiveGate(kind: string): kind is PrimitiveGate {
  return kind === 'NOT' || kind === 'AND' || kind === 'OR';
}

/* ------------------------------------------------------------------ */
/* Proposal result                                                    */
/* ------------------------------------------------------------------ */

/**
 * Why a merge is not allowed. The UI needs these to explain why the merge
 * button is dark — that explanation is most of how players learn the rule.
 */
export type MergeRejection =
  | 'empty-selection'
  | 'unknown-node'
  | 'contains-input'
  | 'contains-chip'
  | 'too-many-nodes'
  | 'too-many-params'
  | 'multiple-outputs'
  | 'not-connected'
  | 'internal-fanout'
  | 'not-enough-instances'
  | 'no-saving';

export interface MergeCandidate {
  readonly pattern: Pattern;
  /** Replaceable, non-overlapping instances with pairwise distinct bindings. */
  readonly matches: readonly PatternMatch[];
  readonly arity: number;
  readonly table: bigint;
  /** Primitive gates in the body — becomes the chip's definition cost. */
  readonly gateCost: number;
  /** Points this merge will save. Always positive; otherwise it is rejected. */
  readonly saved: number;
  /** Famous name if recognized, otherwise a generated tag. */
  readonly name: string;
  /** True when this is a function with a famous name. */
  readonly known: boolean;
  /** Set when the player already owns a chip computing exactly this function. */
  readonly existingChipId: ChipId | null;
}

export type MergeProposal =
  | { readonly ok: true; readonly candidate: MergeCandidate }
  | {
      readonly ok: false;
      readonly reason: MergeRejection;
      readonly detail: string;
      /** How many valid instances were found, when that was the problem. */
      readonly instances?: number;
    };

function reject(
  reason: MergeRejection,
  detail: string,
  instances?: number,
): MergeProposal {
  return instances === undefined
    ? { ok: false, reason, detail }
    : { ok: false, reason, detail, instances };
}

/* ------------------------------------------------------------------ */
/* Selection analysis                                                 */
/* ------------------------------------------------------------------ */

function consumersOf(circuit: Circuit): Map<NodeId, NodeId[]> {
  const map = new Map<NodeId, NodeId[]>();
  for (const node of circuit.nodes.values()) {
    for (const ref of node.inputs) {
      const list = map.get(ref);
      if (list) list.push(node.id);
      else map.set(ref, [node.id]);
    }
  }
  return map;
}

/**
 * Abstract a selection into a pattern.
 *
 * Parameters are numbered in the order the traversal first meets them, which
 * makes the numbering deterministic — two identically shaped selections always
 * produce the same key. Crucially, an external node met twice maps to the SAME
 * parameter, so `AND(x, x)` is an arity-1 pattern, not an arity-2 one.
 */
function buildPattern(
  circuit: Circuit,
  selected: ReadonlySet<NodeId>,
  rootId: NodeId,
): Pattern {
  const nodeIndex = new Map<NodeId, number>();
  const slots: (PatternNode | undefined)[] = [];
  const paramIndex = new Map<NodeId, number>();

  const visit = (id: NodeId): number => {
    const existing = nodeIndex.get(id);
    if (existing !== undefined) return existing;

    const node = circuit.nodes.get(id);
    if (!node || !isPrimitiveGate(node.kind)) {
      throw new CircuitError(`Node "${id}" cannot be part of a pattern`);
    }

    // Reserve this node's index before recursing, so preorder numbering holds.
    const index = slots.length;
    nodeIndex.set(id, index);
    slots.push(undefined);

    const inputs: PatternRef[] = node.inputs.map((argId) => {
      if (selected.has(argId)) {
        return { kind: 'node', index: visit(argId) };
      }
      let param = paramIndex.get(argId);
      if (param === undefined) {
        param = paramIndex.size;
        paramIndex.set(argId, param);
      }
      return { kind: 'param', index: param };
    });

    slots[index] = { gate: node.kind, inputs };
    return index;
  };

  visit(rootId);

  const nodes = slots.map((slot, i) => {
    if (!slot) throw new CircuitError(`Pattern node ${i} was never filled in`);
    return slot;
  });

  const key = nodes
    .map(
      (n, i) =>
        `${i}:${n.gate}(${n.inputs
          .map((r) => (r.kind === 'node' ? `n${r.index}` : `p${r.index}`))
          .join(',')})`,
    )
    .join(';');

  return { nodes, arity: paramIndex.size, key: `${key}|a${paramIndex.size}` };
}

/** The pattern's behaviour, as a truth table over its parameters. */
export function patternTable(pattern: Pattern): bigint {
  const b = new CircuitBuilder(pattern.arity);
  const paramIds: NodeId[] = [];
  for (let i = 0; i < pattern.arity; i++) paramIds.push(b.input(i));

  const built: (NodeId | undefined)[] = new Array(pattern.nodes.length);

  const build = (index: number): NodeId => {
    const existing = built[index];
    if (existing !== undefined) return existing;

    const node = pattern.nodes[index];
    const args = node.inputs.map((ref) =>
      ref.kind === 'param' ? paramIds[ref.index] : build(ref.index),
    );

    let id: NodeId;
    switch (node.gate) {
      case 'NOT':
        id = b.not(args[0]);
        break;
      case 'AND':
        id = b.and(args[0], args[1]);
        break;
      case 'OR':
        id = b.or(args[0], args[1]);
        break;
    }
    built[index] = id;
    return id;
  };

  b.setOutput(build(0));
  return evaluateOutput(b.build()) ?? 0n;
}

/* ------------------------------------------------------------------ */
/* Matching                                                           */
/* ------------------------------------------------------------------ */

/** Try to match `pattern` with its root sitting on `rootId`. */
function matchAt(
  circuit: Circuit,
  pattern: Pattern,
  rootId: NodeId,
): PatternMatch | null {
  const nodeMap: (NodeId | undefined)[] = new Array(pattern.nodes.length);
  const paramMap: (NodeId | undefined)[] = new Array(pattern.arity);

  const unify = (index: number, circuitId: NodeId): boolean => {
    const already = nodeMap[index];
    if (already !== undefined) return already === circuitId;

    const patternNode = pattern.nodes[index];
    const node = circuit.nodes.get(circuitId);
    if (!node) return false;
    if (node.kind !== patternNode.gate) return false;
    if (node.inputs.length !== patternNode.inputs.length) return false;

    nodeMap[index] = circuitId;

    for (let i = 0; i < patternNode.inputs.length; i++) {
      const ref = patternNode.inputs[i];
      const argId = node.inputs[i];
      if (ref.kind === 'node') {
        if (!unify(ref.index, argId)) return false;
      } else {
        const bound = paramMap[ref.index];
        if (bound === undefined) paramMap[ref.index] = argId;
        else if (bound !== argId) return false;
      }
    }
    return true;
  };

  if (!unify(0, rootId)) return null;

  const nodeIds: NodeId[] = [];
  for (const id of nodeMap) {
    if (id === undefined) return null;
    nodeIds.push(id);
  }
  // A node used twice in the pattern would break replacement bookkeeping.
  if (new Set(nodeIds).size !== nodeIds.length) return null;

  const binding: NodeId[] = [];
  for (const id of paramMap) {
    if (id === undefined) return null;
    binding.push(id);
  }

  return { rootId, nodeIds, binding };
}

/**
 * Is this match safe to replace with a single chip?
 *
 * Only the root's value may leave the instance. If some inner node also feeds
 * something outside — or is the circuit's output — swapping in a chip would
 * destroy that connection, so the instance is not replaceable.
 */
function isReplaceable(
  circuit: Circuit,
  match: PatternMatch,
  consumers: Map<NodeId, NodeId[]>,
): boolean {
  const inside = new Set(match.nodeIds);
  for (const id of match.nodeIds) {
    if (id === match.rootId) continue;
    if (circuit.outputId === id) return false;
    for (const consumer of consumers.get(id) ?? []) {
      if (!inside.has(consumer)) return false;
    }
  }
  return true;
}

/** Every replaceable occurrence of `pattern` anywhere in the circuit. */
export function findMatches(
  circuit: Circuit,
  pattern: Pattern,
): PatternMatch[] {
  const consumers = consumersOf(circuit);
  const found: PatternMatch[] = [];
  for (const id of circuit.nodes.keys()) {
    const match = matchAt(circuit, pattern, id);
    if (match && isReplaceable(circuit, match, consumers)) found.push(match);
  }
  return found;
}

/**
 * Reduce raw matches to a usable set: no two instances may overlap, and no two
 * may share a binding. `preferred` is kept if present, so the player's own
 * selection always survives.
 */
function selectInstances(
  matches: readonly PatternMatch[],
  preferredRootId: NodeId | null,
): PatternMatch[] {
  const ordered = [...matches].sort((a, b) => {
    if (a.rootId === preferredRootId) return -1;
    if (b.rootId === preferredRootId) return 1;
    return a.rootId.localeCompare(b.rootId);
  });

  const chosen: PatternMatch[] = [];
  const usedNodes = new Set<NodeId>();
  const usedBindings = new Set<string>();

  for (const match of ordered) {
    if (match.nodeIds.some((id) => usedNodes.has(id))) continue;
    const bindingKey = match.binding.join(',');
    if (usedBindings.has(bindingKey)) continue;

    chosen.push(match);
    for (const id of match.nodeIds) usedNodes.add(id);
    usedBindings.add(bindingKey);
  }
  return chosen;
}

/* ------------------------------------------------------------------ */
/* Proposing a merge                                                  */
/* ------------------------------------------------------------------ */

/**
 * Can this selection become a chip? Returns either a candidate ready to apply,
 * or a rejection the UI can explain to the player.
 */
export function proposeMerge(
  circuit: Circuit,
  selection: readonly NodeId[],
  registry: ChipRegistry = new Map(),
): MergeProposal {
  const selected = new Set(selection);

  if (selected.size === 0) {
    return reject('empty-selection', 'Select some gates first.');
  }
  if (selected.size > TUNING.maxChipNodes) {
    return reject(
      'too-many-nodes',
      `A chip may hold at most ${TUNING.maxChipNodes} gates; this selection has ${selected.size}.`,
    );
  }

  for (const id of selected) {
    const node = circuit.nodes.get(id);
    if (!node) {
      return reject('unknown-node', `Node "${id}" is not on the board.`);
    }
    if (node.kind === 'INPUT') {
      return reject(
        'contains-input',
        'Circuit inputs cannot go inside a chip — they become its pins.',
      );
    }
    if (node.kind === 'CHIP') {
      // Lifting this is the "tiered chips" feature, deliberately deferred.
      return reject(
        'contains-chip',
        'Chips cannot be nested yet. Select only primitive gates.',
      );
    }
  }

  // The root is the one selected node nothing else in the selection consumes.
  const roots = [...selected].filter((id) => {
    for (const other of selected) {
      if (other === id) continue;
      const node = circuit.nodes.get(other);
      if (node?.inputs.includes(id)) return false;
    }
    return true;
  });

  if (roots.length !== 1) {
    return reject(
      'multiple-outputs',
      `A chip must have exactly one output; this selection has ${roots.length}.`,
    );
  }
  const rootId = roots[0];

  const pattern = buildPattern(circuit, selected, rootId);

  // Defensive: in a DAG, exactly one sink implies every node reaches it, so the
  // single-root check above already guarantees connectivity. Kept as a cheap
  // invariant guard in case the root rule is ever loosened.
  if (pattern.nodes.length !== selected.size) {
    return reject(
      'not-connected',
      'Every selected gate must feed the selection’s output.',
    );
  }
  if (pattern.arity > TUNING.maxChipArity) {
    return reject(
      'too-many-params',
      `A chip may have at most ${TUNING.maxChipArity} pins; this one needs ${pattern.arity}.`,
    );
  }

  const consumers = consumersOf(circuit);
  const ownMatch = matchAt(circuit, pattern, rootId);
  if (!ownMatch || !isReplaceable(circuit, ownMatch, consumers)) {
    return reject(
      'internal-fanout',
      'Only the selection’s output may be used elsewhere. Something inside it feeds the outside.',
    );
  }

  const matches = selectInstances(findMatches(circuit, pattern), rootId);

  if (matches.length < TUNING.minChipInstances) {
    return reject(
      'not-enough-instances',
      `This shape appears ${matches.length} time(s) with different inputs. ` +
        `A chip needs ${TUNING.minChipInstances}. Build it somewhere else first.`,
      matches.length,
    );
  }

  // A merge that does not pay for itself is a trap, not a choice. One AND gate
  // used twice is a legal pattern, but wrapping it costs 1 + 1 pkg + 1 reuse = 3
  // against 2 inline. Rejecting these here keeps the UI from ever offering a
  // move that makes the score worse, and it puts the "chips start paying off at
  // three gates" cliff in the rule rather than only in the arithmetic.
  const gateCost = pattern.nodes.length;
  const saved =
    matches.length * gateCost -
    (gateCost + TUNING.packagingFee + (matches.length - 1) * TUNING.reuseFee);

  if (saved <= 0) {
    return reject(
      'no-saving',
      `Too small to be worth it — a ${gateCost}-gate chip used ${matches.length} times ` +
        `would ${saved === 0 ? 'break even' : `cost ${-saved} more`}. Find a bigger pattern.`,
      matches.length,
    );
  }

  const table = patternTable(pattern);
  const known = identify(pattern.arity, table);

  let existingChipId: ChipId | null = null;
  for (const chip of registry.values()) {
    if (chip.arity === pattern.arity && chip.table === table) {
      existingChipId = chip.id;
      break;
    }
  }

  return {
    ok: true,
    candidate: {
      pattern,
      matches,
      arity: pattern.arity,
      table,
      gateCost,
      saved,
      name: known ?? describeFunction(pattern.arity, table),
      known: known !== null,
      existingChipId,
    },
  };
}

/* ------------------------------------------------------------------ */
/* Applying a merge                                                   */
/* ------------------------------------------------------------------ */

function freshId(taken: ReadonlySet<NodeId>, prefix: string): NodeId {
  let n = 1;
  while (taken.has(`${prefix}${n}`)) n++;
  return `${prefix}${n}`;
}

export interface MergeOutcome {
  readonly circuit: Circuit;
  readonly registry: ChipRegistry;
  readonly chip: ChipDefinition;
  /** The chip nodes that replaced the matched subcircuits. */
  readonly placedNodeIds: readonly NodeId[];
}

/**
 * Rewrite the circuit, replacing every matched instance with a chip node.
 *
 * If the registry already holds a chip computing this exact function, that chip
 * is reused rather than duplicated — chip identity is behavioural, so a player
 * cannot end up with two XORs under different names.
 */
export function applyMerge(
  circuit: Circuit,
  candidate: MergeCandidate,
  registry: ChipRegistry = new Map(),
  options: { readonly name?: string } = {},
): MergeOutcome {
  const existing = candidate.existingChipId
    ? registry.get(candidate.existingChipId)
    : undefined;

  const chip: ChipDefinition =
    existing ??
    {
      id: `chip-${candidate.arity}-${candidate.table.toString(16)}`,
      name: options.name ?? candidate.name,
      arity: candidate.arity,
      table: candidate.table,
      gateCost: candidate.gateCost,
    };

  const nodes = new Map<NodeId, CircuitNode>(circuit.nodes);
  const taken = new Set<NodeId>(nodes.keys());
  const rootToChipNode = new Map<NodeId, NodeId>();
  const placedNodeIds: NodeId[] = [];

  for (const match of candidate.matches) {
    for (const id of match.nodeIds) nodes.delete(id);

    const chipNodeId = freshId(taken, 'c');
    taken.add(chipNodeId);
    nodes.set(chipNodeId, {
      id: chipNodeId,
      kind: 'CHIP',
      inputs: [...match.binding],
      chipId: chip.id,
    });
    rootToChipNode.set(match.rootId, chipNodeId);
    placedNodeIds.push(chipNodeId);
  }

  // Rewire anything that referenced a replaced instance's output.
  for (const [id, node] of nodes) {
    if (!node.inputs.some((ref) => rootToChipNode.has(ref))) continue;
    nodes.set(id, {
      ...node,
      inputs: node.inputs.map((ref) => rootToChipNode.get(ref) ?? ref),
    });
  }

  const outputId =
    circuit.outputId !== null
      ? rootToChipNode.get(circuit.outputId) ?? circuit.outputId
      : null;

  const nextRegistry = new Map(registry);
  nextRegistry.set(chip.id, chip);

  return {
    circuit: { inputCount: circuit.inputCount, nodes, outputId },
    registry: nextRegistry,
    chip,
    placedNodeIds,
  };
}
