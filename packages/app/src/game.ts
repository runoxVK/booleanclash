import {
  applyMerge,
  CircuitBuilder,
  proposeMerge,
  type ChipId,
  type ChipRegistry,
  type Circuit,
  type CircuitNode,
  type NodeId,
} from '@logiclash/engine';
import type { Puzzle } from './puzzles';

/**
 * Game state and the moves that change it.
 *
 * The interaction model is "select signals, then apply a gate" rather than
 * dragging wires. Every gate is therefore fully wired the moment it exists, so
 * the circuit is always valid and the engine never has to model a half-built
 * gate. It is also faster to play, which matters once there is a clock.
 */
export interface GameState {
  readonly puzzle: Puzzle;
  readonly circuit: Circuit;
  readonly registry: ChipRegistry;
  /** Ordered: a gate's pins are filled in the order you clicked. */
  readonly selection: readonly NodeId[];
  readonly message: string | null;
}

export function newGame(puzzle: Puzzle): GameState {
  const builder = new CircuitBuilder(puzzle.inputCount);
  for (let i = 0; i < puzzle.inputCount; i++) builder.input(i);
  return {
    puzzle,
    circuit: builder.build(),
    registry: new Map(),
    selection: [],
    message: null,
  };
}

function freshNodeId(circuit: Circuit): NodeId {
  let n = 1;
  while (circuit.nodes.has(`g${n}`)) n++;
  return `g${n}`;
}

function withNodes(
  circuit: Circuit,
  nodes: Map<NodeId, CircuitNode>,
  outputId: NodeId | null = circuit.outputId,
): Circuit {
  return { inputCount: circuit.inputCount, nodes, outputId };
}

/* ------------------------------------------------------------------ */
/* Selection                                                          */
/* ------------------------------------------------------------------ */

export function toggleSelect(state: GameState, id: NodeId): GameState {
  const selection = state.selection.includes(id)
    ? state.selection.filter((s) => s !== id)
    : [...state.selection, id];
  return { ...state, selection, message: null };
}

export function clearSelection(state: GameState): GameState {
  return { ...state, selection: [], message: null };
}

/* ------------------------------------------------------------------ */
/* Placing gates and chips                                            */
/* ------------------------------------------------------------------ */

export function placeGate(
  state: GameState,
  kind: 'NOT' | 'AND' | 'OR',
): GameState {
  const arity = kind === 'NOT' ? 1 : 2;
  if (state.selection.length !== arity) {
    return {
      ...state,
      message: `${kind} takes ${arity} input${arity === 1 ? '' : 's'} — select exactly ${arity}.`,
    };
  }

  const id = freshNodeId(state.circuit);
  const nodes = new Map(state.circuit.nodes);
  nodes.set(id, { id, kind, inputs: [...state.selection] });

  // Select the new gate so builds chain naturally.
  return {
    ...state,
    circuit: withNodes(state.circuit, nodes),
    selection: [id],
    message: null,
  };
}

export function placeChip(state: GameState, chipId: ChipId): GameState {
  const chip = state.registry.get(chipId);
  if (!chip) return { ...state, message: 'That chip does not exist.' };

  if (state.selection.length !== chip.arity) {
    return {
      ...state,
      message: `${chip.name} takes ${chip.arity} inputs — select exactly ${chip.arity}.`,
    };
  }

  const id = freshNodeId(state.circuit);
  const nodes = new Map(state.circuit.nodes);
  nodes.set(id, { id, kind: 'CHIP', inputs: [...state.selection], chipId });

  return {
    ...state,
    circuit: withNodes(state.circuit, nodes),
    selection: [id],
    message: null,
  };
}

/* ------------------------------------------------------------------ */
/* Removing and designating                                           */
/* ------------------------------------------------------------------ */

/**
 * Delete the selection, cascading to anything downstream.
 *
 * Cascading rather than refusing: a gate whose input vanished would be invalid,
 * and making the player unpick a branch leaf by leaf is tedious.
 */
export function deleteSelected(state: GameState): GameState {
  const doomed = new Set<NodeId>();

  const condemn = (id: NodeId): void => {
    if (doomed.has(id)) return;
    doomed.add(id);
    for (const node of state.circuit.nodes.values()) {
      if (node.inputs.includes(id)) condemn(node.id);
    }
  };

  let refusedInput = false;
  for (const id of state.selection) {
    const node = state.circuit.nodes.get(id);
    if (!node) continue;
    if (node.kind === 'INPUT') {
      refusedInput = true;
      continue;
    }
    condemn(id);
  }

  if (doomed.size === 0) {
    return {
      ...state,
      message: refusedInput
        ? 'Circuit inputs cannot be deleted.'
        : 'Nothing selected to delete.',
    };
  }

  const nodes = new Map(state.circuit.nodes);
  for (const id of doomed) nodes.delete(id);

  const outputId =
    state.circuit.outputId !== null && doomed.has(state.circuit.outputId)
      ? null
      : state.circuit.outputId;

  const extra = doomed.size - state.selection.filter((id) => doomed.has(id)).length;

  return {
    ...state,
    circuit: withNodes(state.circuit, nodes, outputId),
    selection: [],
    message:
      extra > 0
        ? `Deleted ${doomed.size} gates (${extra} downstream).`
        : `Deleted ${doomed.size} gate${doomed.size === 1 ? '' : 's'}.`,
  };
}

export function setOutput(state: GameState): GameState {
  if (state.selection.length !== 1) {
    return { ...state, message: 'Select exactly one gate to make it the output.' };
  }
  const id = state.selection[0];
  const node = state.circuit.nodes.get(id);
  if (!node || node.kind === 'INPUT') {
    return { ...state, message: 'An input cannot be the output.' };
  }
  return {
    ...state,
    circuit: withNodes(state.circuit, new Map(state.circuit.nodes), id),
    message: null,
  };
}

/* ------------------------------------------------------------------ */
/* Merging                                                           */
/* ------------------------------------------------------------------ */

/** The live proposal for the current selection — drives the merge button. */
export function currentProposal(state: GameState) {
  return proposeMerge(state.circuit, [...state.selection], state.registry);
}

export function mergeSelection(state: GameState): GameState {
  const proposal = currentProposal(state);
  if (!proposal.ok) return { ...state, message: proposal.detail };

  const outcome = applyMerge(state.circuit, proposal.candidate, state.registry);
  const saved = proposal.candidate.saved;

  return {
    ...state,
    circuit: outcome.circuit,
    registry: outcome.registry,
    selection: [],
    message: `Discovered ${outcome.chip.name}. Saved ${saved} chip${saved === 1 ? '' : 's'}.`,
  };
}
