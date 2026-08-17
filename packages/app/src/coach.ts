import type { MergeProposal, NodeId } from '@logiclash/engine';
import type { GameState } from './game';

/**
 * The coach line: one sentence, always on screen, saying the next thing to do.
 *
 * The game's interaction model — select signals, then apply a gate to them — is
 * not one anybody arrives already knowing, and a board full of parts with no
 * prompt is a dead end. So rather than a tutorial you sit through once and then
 * forget, the game reads its own state and says the next move out loud, forever.
 * It costs nothing once you know the game and rescues you when you do not.
 *
 * Rules are checked in priority order: the most useful thing to say wins.
 */

export interface Coaching {
  readonly text: string;
  /** `do` = here's your next move, `ready` = something good is available now. */
  readonly tone: 'do' | 'ready' | 'win';
}

export function coach(
  state: GameState,
  values: ReadonlyMap<NodeId, bigint>,
  proposal: MergeProposal,
  solved: boolean,
  total: number,
  par: number,
  /** A merge sitting on the board that the player has not selected yet. */
  suggestion: { name: string; saved: number } | null,
): Coaching {
  const { selection, registry, puzzle } = state;
  const count = selection.length;

  if (solved) {
    if (suggestion) {
      return {
        text: `Solved in ${total} — but you built the same shape twice. Press F to highlight it, then Merge to save ${suggestion.saved}.`,
        tone: 'ready',
      };
    }
    return {
      text:
        total <= par
          ? `Solved in ${total} — par is ${par}. Take the next puzzle, or keep trimming.`
          : `Solved in ${total}, but par is ${par}. Look for a shape you built more than once.`,
      tone: 'win',
    };
  }

  /* A live merge is the most valuable thing on screen — it is the whole game. */
  if (proposal.ok) {
    const { name, matches, saved } = proposal.candidate;
    return {
      text: `You built the same shape ${matches.length} times. Merge it into a ${name} chip and save ${saved}.`,
      tone: 'ready',
    };
  }

  /* A merge sitting unnoticed on the board beats any build advice: it is the
     mechanic the whole game turns on, and it is invisible until pointed at. */
  if (suggestion) {
    return {
      text: `There is a repeated shape on the board — merging it into a ${suggestion.name} chip saves ${suggestion.saved}. Press F to highlight it.`,
      tone: 'ready',
    };
  }

  if (count === 0) {
    const built = [...state.circuit.nodes.values()].some(
      (n) => n.kind !== 'INPUT',
    );
    return {
      text: built
        ? 'Click a part to select it. Gates take their inputs from whatever you have selected.'
        : `Click input a, then input b. Then pick a gate from the toolbox to join them.`,
      tone: 'do',
    };
  }

  if (count === 1) {
    const chip = [...registry.values()].find((c) => c.arity === 1);
    return {
      text: `1 selected. Press N for NOT${chip ? ` or place ${chip.name}` : ''}, or click a second part to unlock AND and OR.`,
      tone: 'do',
    };
  }

  if (count === 2) {
    const chip = [...registry.values()].find((c) => c.arity === 2);
    return {
      text: `2 selected. Press A for AND, O for OR${chip ? `, or place your ${chip.name} chip` : ''}.`,
      tone: 'ready',
    };
  }

  const chip = [...registry.values()].find((c) => c.arity === count);
  if (chip) {
    return {
      text: `${count} selected — your ${chip.name} chip takes exactly that many. Place it from the toolbox.`,
      tone: 'ready',
    };
  }

  /* More than two selected is only useful for merging, so say what is missing. */
  if (!proposal.ok && proposal.reason === 'not-enough-instances') {
    return {
      text: `That shape only appears once. Build it again somewhere else — on different signals — and you can merge them.`,
      tone: 'do',
    };
  }

  return {
    text: `${count} parts selected. Gates take 1 or 2 inputs — press Esc to clear, or merge a repeated shape.`,
    tone: 'do',
  };
}

/** Short label under the target table, naming what the puzzle wants. */
export function describeGoal(inputCount: number): string {
  const names = 'abcdefgh'.slice(0, inputCount).split('').join(', ');
  return `Build a circuit whose output matches the WANT column for every setting of ${names}.`;
}
