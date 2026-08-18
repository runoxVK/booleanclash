import type { GameState } from './game';

/**
 * The coach line: one sentence saying how to operate the board.
 *
 * Note the hard limit on what it is allowed to know. It explains the CONTROLS —
 * place a part, wire a pin, flip a switch — and it never searches the board for
 * a repeated shape. Spotting the repeat is the skill the whole game is built on;
 * a hint that points at it is not a teaching aid, it is the game playing itself.
 * The only merge feedback anywhere is the Merge button confirming or refusing a
 * selection the player made on their own.
 */

export interface Coaching {
  readonly text: string;
  /** `do` = here is how, `ready` = an action is available, `win` = solved. */
  readonly tone: 'do' | 'ready' | 'win';
}

export function coach(
  state: GameState,
  solved: boolean,
  total: number,
  par: number,
): Coaching {
  const { circuit, selection, armed } = state;

  if (solved) {
    return {
      text:
        total <= par
          ? `Solved in ${total} — par is ${par}. Take the next puzzle, or keep trimming.`
          : `Solved in ${total}, but par is ${par}. Look for a component hiding in your circuit.`,
      tone: 'win',
    };
  }

  if (armed) {
    const what = armed.kind === 'gate' ? armed.gate.toLowerCase() : 'chip';
    return {
      text: `Click an empty cell to drop the ${what}. Press Esc to put it back.`,
      tone: 'ready',
    };
  }

  const parts = [...circuit.nodes.values()];
  const placed = parts.filter((n) => n.kind !== 'INPUT');

  if (placed.length === 0) {
    return {
      text: 'Pick a gate from the toolbox, then click a cell on the grid to place it.',
      tone: 'do',
    };
  }

  const emptyPins = placed.reduce(
    (n, node) => n + node.inputs.filter((ref) => ref === null).length,
    0,
  );
  if (emptyPins > 0) {
    return {
      text: `${emptyPins} pin${emptyPins === 1 ? '' : 's'} still unwired. Drag from a part's top pin down into an empty bottom pin.`,
      tone: 'do',
    };
  }

  if (selection.length > 1) {
    return {
      text: `${selection.length} selected. If they add up to a component from the catalogue, press M to package them into one.`,
      tone: 'do',
    };
  }
  if (selection.length === 1) {
    return {
      text: 'One part selected. Add the rest of the cluster you think forms a component, then press M.',
      tone: 'do',
    };
  }

  if (circuit.outputId === null) {
    return {
      text: 'Everything is wired. Flip the switches to check it, and the part that matches the target becomes the output.',
      tone: 'do',
    };
  }

  return {
    text: `${total} units used, par is ${par}. Spot a component in there and you can package it into one.`,
    tone: 'do',
  };
}

/** Short label under the target table, naming what the puzzle wants. */
export function describeGoal(inputCount: number): string {
  const names = 'abcdefgh'.slice(0, inputCount).split('').join(', ');
  return `Build a circuit whose output matches the WANT column for every setting of ${names}.`;
}

