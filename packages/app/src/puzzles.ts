import { fromRowString } from '@logiclash/engine';

/**
 * Hand-authored puzzles for the first playable build.
 *
 * M4 replaces this with a generated pool filtered for paradigm diversity. These
 * exist so the merge loop can be played and judged before that lands, so they
 * are chosen to teach rather than to be fair: each one isolates one idea.
 */
export interface Puzzle {
  readonly id: string;
  readonly name: string;
  readonly inputCount: number;
  readonly target: bigint;
  /** A good score. Beating it should feel like an achievement. */
  readonly par: number;
  readonly hint: string;
}

function puzzle(
  id: string,
  name: string,
  rowString: string,
  par: number,
  hint: string,
): Puzzle {
  const { table, inputCount } = fromRowString(rowString);
  return { id, name, inputCount, target: table, par, hint };
}

export const PUZZLES: readonly Puzzle[] = [
  puzzle(
    'warmup',
    'Warm-up',
    '0110',
    4,
    'On when exactly one input is on. Nothing to merge here — just find it.',
  ),
  puzzle(
    'double',
    'Double Trouble',
    '0110111111110110',
    7,
    'Two halves that look awfully similar. Build one, then build the other.',
  ),
  puzzle(
    'parity',
    'Odd One Out',
    '0110100110010110',
    7,
    'On when an odd number of inputs are on. The same shape shows up three times.',
  ),
  puzzle(
    'majority',
    'Majority Rules',
    '00010111',
    5,
    'On when at least two of the three are on. Not every puzzle has a merge.',
  ),
];
