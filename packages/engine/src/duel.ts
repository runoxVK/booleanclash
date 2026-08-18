import { inBounds, inputCells, sameCell, type Cell } from './board.js';
import { CircuitBuilder, evaluate } from './circuit.js';
import {
  addChip,
  addGate,
  canConnect,
  connect,
  disconnect,
} from './edit.js';
import { applyMerge, proposeMerge } from './merge.js';
import { TUNING } from './tuning.js';
import {
  PRIMITIVE_ARITY,
  type ChipId,
  type ChipRegistry,
  type Circuit,
  type NodeId,
} from './types.js';

/**
 * Two-player duel: one board, one target, alternating turns.
 *
 * Separate boards would make turns meaningless — nothing either player did
 * would affect the other, so it would be a race with pauses in it. Sharing a
 * circuit is what makes a turn cost something.
 *
 * You win by making some part on the board compute the target ON YOUR TURN. So
 * both players are building toward the same thing while trying to be the one
 * who lands the last move, and the interesting play is tempo: setting up a
 * finish your opponent cannot take first, and spending waiting moves when the
 * parity is against you. The shared part budget is what stops that stalling
 * forever, and packaging — which hands parts back to the budget — is the one
 * move that buys tempo without paying for it.
 *
 * Every rule lives here rather than in the server, because the server has to
 * replay these moves to trust them and the client has to predict them to feel
 * responsive. One implementation, no drift.
 */

export interface DuelPuzzle {
  readonly inputCount: number;
  readonly target: bigint;
}

export type DuelMove =
  | {
      /* Placement is atomic: a part arrives fully wired. Spending three turns
         to place one gate and connect its pins would make the tempo game
         unreadable. */
      readonly kind: 'place';
      readonly gate: 'NOT' | 'AND' | 'OR';
      readonly cell: Cell;
      readonly inputs: readonly NodeId[];
    }
  | {
      readonly kind: 'place-chip';
      readonly chipId: ChipId;
      readonly cell: Cell;
      readonly inputs: readonly NodeId[];
    }
  | {
      readonly kind: 'rewire';
      readonly target: NodeId;
      readonly pin: number;
      /** null pulls the wire out. */
      readonly source: NodeId | null;
    }
  | { readonly kind: 'package'; readonly nodeIds: readonly NodeId[] }
  | { readonly kind: 'resign' };

export type DuelResult =
  | {
      readonly kind: 'win';
      readonly winner: 0 | 1;
      readonly reason: 'solved' | 'resignation';
      /** The part that computed the target, when one did. */
      readonly by?: NodeId;
    }
  | { readonly kind: 'draw'; readonly reason: 'no-parts-left' | 'move-limit' };

export interface DuelState {
  readonly puzzle: DuelPuzzle;
  readonly circuit: Circuit;
  readonly registry: ChipRegistry;
  readonly cells: ReadonlyMap<NodeId, Cell>;
  /** Whose move it is. */
  readonly turn: 0 | 1;
  /** How many moves have been played. */
  readonly ply: number;
  readonly result: DuelResult | null;
}

export type DuelRefusal =
  | 'game-over'
  | 'not-your-turn'
  | 'off-board'
  | 'cell-taken'
  | 'no-parts-left'
  | 'wrong-pin-count'
  | 'unknown-part'
  | 'unknown-chip'
  | 'illegal-wire'
  | 'illegal-package';

export type MoveOutcome =
  | { readonly ok: true; readonly state: DuelState }
  | { readonly ok: false; readonly reason: DuelRefusal; readonly detail: string };

function refuse(reason: DuelRefusal, detail: string): MoveOutcome {
  return { ok: false, reason, detail };
}

export function createDuel(puzzle: DuelPuzzle): DuelState {
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
    turn: 0,
    ply: 0,
    result: null,
  };
}

/** Parts on the board, not counting the fixed circuit inputs. */
export function partsUsed(state: DuelState): number {
  let used = 0;
  for (const node of state.circuit.nodes.values()) {
    if (node.kind !== 'INPUT') used++;
  }
  return used;
}

export function partsLeft(state: DuelState): number {
  return TUNING.duel.partBudget - partsUsed(state);
}

function occupied(cells: ReadonlyMap<NodeId, Cell>, cell: Cell): boolean {
  for (const at of cells.values()) {
    if (sameCell(at, cell)) return true;
  }
  return false;
}

/**
 * Has anybody built the target?
 *
 * Any part will do — there is no separate "declare this the output" step to
 * discover or forget. Which cuts both ways: build the second-to-last piece of
 * an obvious solution and your opponent simply finishes it on their turn.
 */
function solvedBy(state: DuelState): NodeId | null {
  const values = evaluate(state.circuit, state.registry);
  for (const [id, value] of values) {
    if (value !== state.puzzle.target) continue;
    if (state.circuit.nodes.get(id)?.kind !== 'INPUT') return id;
  }
  return null;
}

/** Work out the consequences of a move having been played. */
function settle(next: DuelState, mover: 0 | 1): DuelState {
  const winning = solvedBy(next);
  if (winning !== null) {
    return {
      ...next,
      result: { kind: 'win', winner: mover, reason: 'solved', by: winning },
    };
  }

  if (next.ply >= TUNING.duel.plyLimit) {
    return { ...next, result: { kind: 'draw', reason: 'move-limit' } };
  }
  if (partsLeft(next) <= 0 && !anyRewirePossible(next)) {
    return { ...next, result: { kind: 'draw', reason: 'no-parts-left' } };
  }

  return { ...next, turn: mover === 0 ? 1 : 0 };
}

/**
 * With the budget gone, a player can still rewire — so the board is only truly
 * dead when there is nothing left to rewire either.
 */
function anyRewirePossible(state: DuelState): boolean {
  for (const node of state.circuit.nodes.values()) {
    if (node.kind === 'INPUT') continue;
    if (node.inputs.length > 0) return true;
  }
  return false;
}

export function applyMove(
  state: DuelState,
  player: 0 | 1,
  move: DuelMove,
): MoveOutcome {
  if (state.result !== null) {
    return refuse('game-over', 'This game has finished.');
  }
  if (player !== state.turn) {
    return refuse('not-your-turn', 'It is your opponent’s move.');
  }

  const advance = (partial: Omit<DuelState, 'turn' | 'result' | 'ply'>) =>
    ({ ok: true, state: settle({ ...state, ...partial, ply: state.ply + 1 }, player) }) as const;

  switch (move.kind) {
    case 'resign':
      return {
        ok: true,
        state: {
          ...state,
          ply: state.ply + 1,
          result: {
            kind: 'win',
            winner: player === 0 ? 1 : 0,
            reason: 'resignation',
          },
        },
      };

    case 'place':
    case 'place-chip': {
      if (!inBounds(move.cell)) {
        return refuse('off-board', 'That cell is not on the board.');
      }
      if (occupied(state.cells, move.cell)) {
        return refuse('cell-taken', 'A part is already in that cell.');
      }
      if (partsLeft(state) <= 0) {
        return refuse(
          'no-parts-left',
          'The shared part budget is spent — rewire or package instead.',
        );
      }

      let arity: number;
      let placed: { circuit: Circuit; id: NodeId };
      if (move.kind === 'place') {
        arity = PRIMITIVE_ARITY[move.gate];
        placed = addGate(state.circuit, move.gate);
      } else {
        const chip = state.registry.get(move.chipId);
        if (!chip) return refuse('unknown-chip', 'No such component.');
        arity = chip.arity;
        placed = addChip(state.circuit, chip);
      }

      if (move.inputs.length !== arity) {
        return refuse(
          'wrong-pin-count',
          `That part has ${arity} pin(s); ${move.inputs.length} were given.`,
        );
      }

      let circuit = placed.circuit;
      for (let pin = 0; pin < move.inputs.length; pin++) {
        const source = move.inputs[pin];
        if (!circuit.nodes.has(source)) {
          return refuse('unknown-part', `No part called "${source}".`);
        }
        const check = canConnect(circuit, placed.id, pin, source);
        if (!check.ok) {
          return refuse('illegal-wire', check.detail ?? 'That wire is not allowed.');
        }
        circuit = connect(circuit, placed.id, pin, source);
      }

      const cells = new Map(state.cells);
      cells.set(placed.id, move.cell);
      return advance({ ...state, circuit, cells });
    }

    case 'rewire': {
      const node = state.circuit.nodes.get(move.target);
      if (!node) return refuse('unknown-part', 'No such part.');
      if (move.pin < 0 || move.pin >= node.inputs.length) {
        return refuse('wrong-pin-count', 'That part has no such pin.');
      }

      if (move.source === null) {
        const circuit = disconnect(state.circuit, move.target, move.pin);
        if (circuit === state.circuit) {
          return refuse('illegal-wire', 'That pin is already empty.');
        }
        return advance({ ...state, circuit });
      }

      const check = canConnect(
        state.circuit,
        move.target,
        move.pin,
        move.source,
      );
      if (!check.ok) {
        return refuse('illegal-wire', check.detail ?? 'That wire is not allowed.');
      }
      return advance({
        ...state,
        circuit: connect(state.circuit, move.target, move.pin, move.source),
      });
    }

    case 'package': {
      const proposal = proposeMerge(
        state.circuit,
        [...move.nodeIds],
        state.registry,
      );
      if (!proposal.ok) return refuse('illegal-package', proposal.detail);

      const outcome = applyMerge(
        state.circuit,
        proposal.candidate,
        state.registry,
      );

      /* The chip lands where the cluster's output was, and joins the registry
         — which both players draw from. Packaging arms your opponent too. */
      const cells = new Map(state.cells);
      const home = state.cells.get(proposal.candidate.nodeIds[0]);
      for (const id of proposal.candidate.nodeIds) cells.delete(id);
      cells.set(outcome.placedNodeId, home ?? { col: 0, row: 0 });

      return advance({
        ...state,
        circuit: outcome.circuit,
        registry: outcome.registry,
        cells,
      });
    }
  }
}

/** Replay a whole game from its move list. This is how the server trusts it. */
export function replay(
  puzzle: DuelPuzzle,
  moves: readonly DuelMove[],
): MoveOutcome {
  let state = createDuel(puzzle);
  for (const move of moves) {
    const outcome = applyMove(state, state.turn, move);
    if (!outcome.ok) return outcome;
    state = outcome.state;
  }
  return { ok: true, state };
}
