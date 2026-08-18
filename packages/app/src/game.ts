import {
  addChip,
  addGate,
  applyMerge,
  canConnect,
  CircuitBuilder,
  connect,
  disconnect,
  proposeMerge,
  removeNodes,
  setOutput as setCircuitOutput,
  type ChipId,
  type ChipRegistry,
  type Circuit,
  type NodeId,
} from '@logiclash/engine';
import {
  firstFreeCell,
  inputCells,
  occupant,
  type Cell,
  type CellMap,
} from './grid';
import type { Puzzle } from './puzzles';

/**
 * Game state and the moves that change it.
 *
 * Parts are placed on a grid wherever the player wants and wired pin to pin by
 * hand. Both are deliberate: arranging the board is how you make a repeated
 * shape visible to yourself, and spotting that repeat is the skill the game is
 * actually about.
 */

/** What the toolbox has armed for placement, if anything. */
export type Tool =
  | { readonly kind: 'gate'; readonly gate: 'NOT' | 'AND' | 'OR' }
  | { readonly kind: 'chip'; readonly chipId: ChipId };

export interface GameState {
  readonly puzzle: Puzzle;
  readonly circuit: Circuit;
  readonly registry: ChipRegistry;
  readonly cells: CellMap;
  readonly selection: readonly NodeId[];
  readonly armed: Tool | null;
  readonly message: string | null;
}

export function newGame(puzzle: Puzzle): GameState {
  const builder = new CircuitBuilder(puzzle.inputCount);
  const ids: NodeId[] = [];
  for (let i = 0; i < puzzle.inputCount; i++) ids.push(builder.input(i));

  const homes = inputCells(puzzle.inputCount);
  const cells = new Map<NodeId, Cell>();
  ids.forEach((id, i) => cells.set(id, homes[i]));

  return {
    puzzle,
    circuit: builder.build(),
    registry: new Map(),
    cells,
    selection: [],
    armed: null,
    message: null,
  };
}

/* ------------------------------------------------------------------ */
/* Selection and tools                                                */
/* ------------------------------------------------------------------ */

export function toggleSelect(state: GameState, id: NodeId): GameState {
  const selection = state.selection.includes(id)
    ? state.selection.filter((s) => s !== id)
    : [...state.selection, id];
  return { ...state, selection, message: null };
}

export function clearSelection(state: GameState): GameState {
  return { ...state, selection: [], armed: null, message: null };
}

export function arm(state: GameState, tool: Tool | null): GameState {
  return { ...state, armed: tool, message: null };
}

/* ------------------------------------------------------------------ */
/* Placing and moving                                                 */
/* ------------------------------------------------------------------ */

/** Drop the armed part into a cell. Stays armed, so you can place a run of them. */
export function placeArmed(state: GameState, cell: Cell): GameState {
  if (!state.armed) return state;
  if (occupant(state.cells, cell) !== null) {
    return { ...state, message: 'That cell is taken.' };
  }

  let placed;
  if (state.armed.kind === 'gate') {
    placed = addGate(state.circuit, state.armed.gate);
  } else {
    const chip = state.registry.get(state.armed.chipId);
    if (!chip) return { ...state, message: 'That chip does not exist.' };
    placed = addChip(state.circuit, chip);
  }

  const cells = new Map(state.cells);
  cells.set(placed.id, cell);

  return {
    ...state,
    circuit: placed.circuit,
    cells,
    selection: [],
    message: null,
  };
}

export function moveNode(state: GameState, id: NodeId, cell: Cell): GameState {
  const taken = occupant(state.cells, cell);
  if (taken !== null && taken !== id) return state;

  const cells = new Map(state.cells);
  cells.set(id, cell);
  return { ...state, cells, message: null };
}

/* ------------------------------------------------------------------ */
/* Wiring                                                             */
/* ------------------------------------------------------------------ */

export function wire(
  state: GameState,
  targetId: NodeId,
  pin: number,
  sourceId: NodeId,
): GameState {
  const check = canConnect(state.circuit, targetId, pin, sourceId);
  if (!check.ok) {
    return { ...state, message: check.detail ?? 'That wire is not allowed.' };
  }
  return {
    ...state,
    circuit: connect(state.circuit, targetId, pin, sourceId),
    message: null,
  };
}

export function unwire(
  state: GameState,
  targetId: NodeId,
  pin: number,
): GameState {
  return {
    ...state,
    circuit: disconnect(state.circuit, targetId, pin),
    message: null,
  };
}

/* ------------------------------------------------------------------ */
/* Removing and designating                                           */
/* ------------------------------------------------------------------ */

export function deleteSelected(state: GameState): GameState {
  const removable = state.selection.filter(
    (id) => state.circuit.nodes.get(id)?.kind !== 'INPUT',
  );
  if (removable.length === 0) {
    return { ...state, message: 'Nothing selected that can be removed.' };
  }

  const cells = new Map(state.cells);
  for (const id of removable) cells.delete(id);

  return {
    ...state,
    circuit: removeNodes(state.circuit, removable),
    cells,
    selection: [],
    message: `Removed ${removable.length} part${removable.length === 1 ? '' : 's'}.`,
  };
}

export function dockOutput(state: GameState, id: NodeId): GameState {
  return { ...state, circuit: setCircuitOutput(state.circuit, id) };
}

export function setOutput(state: GameState): GameState {
  if (state.selection.length !== 1) {
    return { ...state, message: 'Select exactly one part to make it the output.' };
  }
  const id = state.selection[0];
  if (state.circuit.nodes.get(id)?.kind === 'INPUT') {
    return { ...state, message: 'An input cannot be the output.' };
  }
  return { ...state, circuit: setCircuitOutput(state.circuit, id) };
}

/* ------------------------------------------------------------------ */
/* Merging                                                            */
/* ------------------------------------------------------------------ */

/**
 * The live proposal for the current selection.
 *
 * Note what this deliberately is NOT: a search of the board for merges the
 * player has not noticed. Finding the repeat is the game. This only answers
 * "is what you picked a legal chip?", which is feedback on a decision the
 * player already made.
 */
export function currentProposal(state: GameState) {
  return proposeMerge(state.circuit, [...state.selection], state.registry);
}

export function mergeSelection(state: GameState): GameState {
  const proposal = currentProposal(state);
  if (!proposal.ok) return { ...state, message: proposal.detail };

  const outcome = applyMerge(state.circuit, proposal.candidate, state.registry);
  const { candidate } = proposal;

  /* Each new chip takes the cell of the shape it replaced, so the board keeps
     the arrangement the player built rather than jumping around. */
  const cells = new Map(state.cells);
  candidate.matches.forEach((match, i) => {
    const home = state.cells.get(match.rootId);
    for (const id of match.nodeIds) cells.delete(id);
    const chipNode = outcome.placedNodeIds[i];
    if (chipNode !== undefined) {
      cells.set(chipNode, home ?? firstFreeCell(cells) ?? { col: 0, row: 0 });
    }
  });

  return {
    ...state,
    circuit: outcome.circuit,
    registry: outcome.registry,
    cells,
    selection: [],
    armed: null,
    message: `Discovered ${outcome.chip.name}. Saved ${candidate.saved}.`,
  };
}
