import { describe, expect, it } from 'vitest';
import { BOARD_ROWS } from '../src/board.js';
import {
  applyMove,
  createDuel,
  partsLeft,
  replay,
  type DuelMove,
  type DuelState,
} from '../src/duel.js';
import { TUNING } from '../src/tuning.js';
import type { NodeId } from '../src/types.js';

/** XOR of a and b — reachable in four parts, so duels finish quickly. */
const XOR_PUZZLE = { inputCount: 2, target: 0x6n };
/** Something no single part can be, for tests that must not end early. */
const HARD_PUZZLE = { inputCount: 4, target: 0x6ff6n };

function inputs(state: DuelState): NodeId[] {
  return [...state.circuit.nodes.values()]
    .filter((n) => n.kind === 'INPUT')
    .map((n) => n.id);
}

/** Play a move that must succeed, and hand back the new state. */
function play(state: DuelState, move: DuelMove): DuelState {
  const outcome = applyMove(state, state.turn, move);
  if (!outcome.ok) throw new Error(`${outcome.reason}: ${outcome.detail}`);
  return outcome.state;
}

let spare = 0;
/** A free cell, so tests never collide over placement. */
function nextCell() {
  spare += 1;
  return { col: spare % 9, row: Math.floor(spare / 9) % (BOARD_ROWS - 1) };
}

describe('setting up', () => {
  it('starts with only the circuit inputs, on the floor', () => {
    const state = createDuel(XOR_PUZZLE);
    expect(state.circuit.nodes.size).toBe(2);
    expect(state.turn).toBe(0);
    expect(state.ply).toBe(0);
    expect(state.result).toBeNull();
    for (const cell of state.cells.values()) {
      expect(cell.row).toBe(BOARD_ROWS - 1);
    }
  });

  it('gives both players a shared pool of parts', () => {
    expect(partsLeft(createDuel(XOR_PUZZLE))).toBe(TUNING.duel.partBudget);
  });
});

describe('taking turns', () => {
  it('passes the turn after a move', () => {
    const start = createDuel(HARD_PUZZLE);
    const ins = inputs(start);
    const after = play(start, {
      kind: 'place',
      gate: 'AND',
      cell: nextCell(),
      inputs: [ins[0], ins[1]],
    });
    expect(after.turn).toBe(1);
    expect(after.ply).toBe(1);
  });

  it('refuses a move from the player whose turn it is not', () => {
    const start = createDuel(HARD_PUZZLE);
    const ins = inputs(start);
    const outcome = applyMove(start, 1, {
      kind: 'place',
      gate: 'AND',
      cell: nextCell(),
      inputs: [ins[0], ins[1]],
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('not-your-turn');
  });

  it('refuses any move once the game is over', () => {
    const start = createDuel(XOR_PUZZLE);
    const done = play(start, { kind: 'resign' });
    const outcome = applyMove(done, done.turn, { kind: 'resign' });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('game-over');
  });
});

describe('placing parts', () => {
  it('places a part fully wired, in one move', () => {
    const start = createDuel(HARD_PUZZLE);
    const ins = inputs(start);
    const after = play(start, {
      kind: 'place',
      gate: 'AND',
      cell: { col: 3, row: 4 },
      inputs: [ins[0], ins[1]],
    });

    const placed = [...after.circuit.nodes.values()].find(
      (n) => n.kind === 'AND',
    );
    expect(placed?.inputs).toEqual([ins[0], ins[1]]);
    expect(partsLeft(after)).toBe(TUNING.duel.partBudget - 1);
  });

  it('refuses a cell that is taken, or off the board', () => {
    const start = createDuel(HARD_PUZZLE);
    const ins = inputs(start);
    const after = play(start, {
      kind: 'place',
      gate: 'AND',
      cell: { col: 3, row: 4 },
      inputs: [ins[0], ins[1]],
    });

    const taken = applyMove(after, after.turn, {
      kind: 'place',
      gate: 'OR',
      cell: { col: 3, row: 4 },
      inputs: [ins[0], ins[1]],
    });
    expect(taken.ok).toBe(false);
    if (!taken.ok) expect(taken.reason).toBe('cell-taken');

    const off = applyMove(after, after.turn, {
      kind: 'place',
      gate: 'OR',
      cell: { col: 99, row: 0 },
      inputs: [ins[0], ins[1]],
    });
    expect(off.ok).toBe(false);
    if (!off.ok) expect(off.reason).toBe('off-board');
  });

  it('refuses the wrong number of pins', () => {
    const start = createDuel(HARD_PUZZLE);
    const ins = inputs(start);
    const outcome = applyMove(start, 0, {
      kind: 'place',
      gate: 'AND',
      cell: nextCell(),
      inputs: [ins[0]],
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('wrong-pin-count');
  });

  it('refuses a wire that would loop', () => {
    const start = createDuel(HARD_PUZZLE);
    const ins = inputs(start);
    let state = play(start, {
      kind: 'place',
      gate: 'NOT',
      cell: { col: 1, row: 5 },
      inputs: [ins[0]],
    });
    const notId = [...state.circuit.nodes.values()].find(
      (n) => n.kind === 'NOT',
    )!.id;

    const outcome = applyMove(state, state.turn, {
      kind: 'rewire',
      target: notId,
      pin: 0,
      source: notId,
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('illegal-wire');
  });
});

describe('winning', () => {
  it('is won by whoever completes the target on their turn', () => {
    // XOR in four parts. Player 0 moves on plies 1 and 3, so player 0 lands
    // the fourth part and takes it — the whole tempo problem in miniature.
    let state = createDuel(XOR_PUZZLE);
    const ins = inputs(state);

    state = play(state, {
      kind: 'place',
      gate: 'OR',
      cell: { col: 2, row: 5 },
      inputs: [ins[0], ins[1]],
    });
    const orId = [...state.circuit.nodes.values()].find((n) => n.kind === 'OR')!.id;

    state = play(state, {
      kind: 'place',
      gate: 'AND',
      cell: { col: 5, row: 5 },
      inputs: [ins[0], ins[1]],
    });
    const andId = [...state.circuit.nodes.values()].find(
      (n) => n.kind === 'AND',
    )!.id;

    state = play(state, {
      kind: 'place',
      gate: 'NOT',
      cell: { col: 5, row: 4 },
      inputs: [andId],
    });
    const notId = [...state.circuit.nodes.values()].find(
      (n) => n.kind === 'NOT',
    )!.id;
    expect(state.result).toBeNull();

    // Player 1 to move, and the finish is right there for the taking.
    expect(state.turn).toBe(1);
    state = play(state, {
      kind: 'place',
      gate: 'AND',
      cell: { col: 3, row: 3 },
      inputs: [orId, notId],
    });

    expect(state.result).toEqual({
      kind: 'win',
      winner: 1,
      reason: 'solved',
      by: expect.any(String),
    });
  });

  it('is lost by resigning', () => {
    const state = play(createDuel(XOR_PUZZLE), { kind: 'resign' });
    expect(state.result).toEqual({
      kind: 'win',
      winner: 1,
      reason: 'resignation',
    });
  });

  it('does not end on an input matching the target', () => {
    // A bare input is not a part anybody placed, so it cannot win a game.
    const state = createDuel({ inputCount: 2, target: 0xan });
    expect(state.result).toBeNull();
  });
});

describe('the shared budget', () => {
  it('refuses a placement once the parts run out', () => {
    let state = createDuel(HARD_PUZZLE);
    const ins = inputs(state);

    for (let i = 0; i < TUNING.duel.partBudget; i++) {
      state = play(state, {
        kind: 'place',
        gate: 'NOT',
        cell: { col: i % 10, row: Math.floor(i / 10) },
        inputs: [ins[0]],
      });
      if (state.result) break;
    }

    expect(partsLeft(state)).toBe(0);
    const outcome = applyMove(state, state.turn, {
      kind: 'place',
      gate: 'NOT',
      cell: { col: 10, row: 6 },
      inputs: [ins[1]],
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('no-parts-left');
  });

  it('gives parts back when a component is packaged', () => {
    // Packaging is the one move that buys a turn AND returns budget, which is
    // what makes spotting a component a tempo weapon and not just economy.
    let state = createDuel(HARD_PUZZLE);
    const ins = inputs(state);

    state = play(state, { kind: 'place', gate: 'OR', cell: { col: 1, row: 5 }, inputs: [ins[0], ins[1]] });
    const orId = [...state.circuit.nodes.values()].find((n) => n.kind === 'OR')!.id;
    state = play(state, { kind: 'place', gate: 'AND', cell: { col: 3, row: 5 }, inputs: [ins[0], ins[1]] });
    const andId = [...state.circuit.nodes.values()].find((n) => n.kind === 'AND')!.id;
    state = play(state, { kind: 'place', gate: 'NOT', cell: { col: 3, row: 4 }, inputs: [andId] });
    const notId = [...state.circuit.nodes.values()].find((n) => n.kind === 'NOT')!.id;
    state = play(state, { kind: 'place', gate: 'AND', cell: { col: 2, row: 3 }, inputs: [orId, notId] });

    const before = partsLeft(state);
    const xorRoot = [...state.circuit.nodes.values()].find(
      (n) => n.kind === 'AND' && n.inputs.includes(orId),
    )!.id;

    state = play(state, {
      kind: 'package',
      nodeIds: [xorRoot, orId, andId, notId],
    });

    expect(partsLeft(state)).toBe(before + 3);
    expect([...state.registry.values()][0].name).toBe('XOR');
  });

  it('refuses a package that is not a component', () => {
    let state = createDuel(HARD_PUZZLE);
    const ins = inputs(state);
    state = play(state, { kind: 'place', gate: 'OR', cell: { col: 1, row: 5 }, inputs: [ins[0], ins[1]] });
    const orId = [...state.circuit.nodes.values()].find((n) => n.kind === 'OR')!.id;
    state = play(state, { kind: 'place', gate: 'AND', cell: { col: 1, row: 4 }, inputs: [orId, ins[2]] });
    const andId = [...state.circuit.nodes.values()].find((n) => n.kind === 'AND')!.id;

    const outcome = applyMove(state, state.turn, {
      kind: 'package',
      nodeIds: [andId, orId],
    });
    expect(outcome.ok).toBe(false);
    if (!outcome.ok) expect(outcome.reason).toBe('illegal-package');
  });
});

describe('replay', () => {
  it('rebuilds the same game from its move list', () => {
    // This is how a server trusts a client: it does not, it replays.
    const ins = ['n1', 'n2'];
    const moves: DuelMove[] = [
      { kind: 'place', gate: 'OR', cell: { col: 2, row: 5 }, inputs: [ins[0], ins[1]] },
      { kind: 'place', gate: 'AND', cell: { col: 5, row: 5 }, inputs: [ins[0], ins[1]] },
    ];

    const first = replay(XOR_PUZZLE, moves);
    const second = replay(XOR_PUZZLE, moves);
    expect(first.ok).toBe(true);
    expect(second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(first.state.ply).toBe(2);
    expect(first.state.circuit.nodes.size).toBe(second.state.circuit.nodes.size);
  });

  it('rejects a move list containing an illegal move', () => {
    const outcome = replay(XOR_PUZZLE, [
      { kind: 'place', gate: 'AND', cell: { col: 0, row: 0 }, inputs: ['nope', 'nope'] },
    ]);
    expect(outcome.ok).toBe(false);
  });
});
