import { fromRowString, generatePuzzle } from '@logiclash/engine';

/**
 * The puzzle list: a few hand-written teaching puzzles, then a generated
 * campaign.
 *
 * The tutorial ones exist because generated puzzles all have merge play by
 * construction, and a player needs to meet the idea somewhere gentle first —
 * including one puzzle with no merge in it at all, so "look for the repeat" does
 * not become a reflex applied blindly.
 */
export interface Puzzle {
  readonly id: string;
  readonly name: string;
  readonly inputCount: number;
  readonly target: bigint;
  /** A good score. Beating it should feel like an achievement. */
  readonly par: number;
  readonly hint: string;
  readonly kind: 'tutorial' | 'campaign';
}

function handmade(
  id: string,
  name: string,
  rowString: string,
  par: number,
  hint: string,
): Puzzle {
  const { table, inputCount } = fromRowString(rowString);
  return { id, name, inputCount, target: table, par, hint, kind: 'tutorial' };
}

const TUTORIAL: readonly Puzzle[] = [
  handmade(
    'warmup',
    'Warm-up',
    '0110',
    4,
    'On when exactly one input is on. Nothing to merge — just find it.',
  ),
  handmade(
    'double',
    'Double Trouble',
    '0110111111110110',
    7,
    'Two halves that look awfully similar. Build one, then build the other.',
  ),
  handmade(
    'parity',
    'Odd One Out',
    '0110100110010110',
    7,
    'On when an odd number of inputs are on. The same shape shows up three times.',
  ),
  handmade(
    'majority',
    'Majority Rules',
    '00010111',
    5,
    'On when at least two of the three are on. Not every puzzle has a merge.',
  ),
];

/** Seeds chosen per width; the ramp comes from sorting on par afterwards. */
const CAMPAIGN_SEEDS: ReadonlyArray<{ inputCount: number; seeds: number[] }> = [
  { inputCount: 3, seeds: [4, 11, 23] },
  { inputCount: 4, seeds: [2, 7, 13, 25, 32, 39] },
  { inputCount: 5, seeds: [5, 18] },
];

function describeHint(pins: number, instances: number, named: string | null): string {
  const shape =
    named === null
      ? `the same ${pins}-input shape`
      : `the same ${pins}-input shape (it has a name)`;
  return `Somewhere in here ${shape} appears ${instances} times on different signals.`;
}

function buildCampaign(): Puzzle[] {
  const built = CAMPAIGN_SEEDS.flatMap(({ inputCount, seeds }) =>
    seeds.map((seed) => {
      const p = generatePuzzle(seed, inputCount);
      return {
        seed,
        inputCount: p.inputCount,
        target: p.target,
        par: p.par,
        hint: describeHint(p.keyChipPins, p.instances, p.keyChip),
      };
    }),
  );

  /* Ramp on par, not on width. A three-input target at par 9 is harder than a
     four-input one at par 6, and with only three inputs there is exactly one way
     to bind a three-pin motif — so narrow puzzles are forced onto XOR-shaped
     motifs and end up denser, not gentler. Par is the honest difficulty signal. */
  built.sort((a, b) => a.par - b.par || a.inputCount - b.inputCount);

  return built.map((p, i) => ({
    id: `level-${i + 1}`,
    name: `Level ${i + 1}`,
    inputCount: p.inputCount,
    target: p.target,
    par: p.par,
    hint: p.hint,
    kind: 'campaign' as const,
  }));
}

export const PUZZLES: readonly Puzzle[] = [...TUTORIAL, ...buildCampaign()];

export function puzzleById(id: string): Puzzle | undefined {
  return PUZZLES.find((p) => p.id === id);
}

export function nextPuzzle(id: string): Puzzle | undefined {
  const index = PUZZLES.findIndex((p) => p.id === id);
  return index >= 0 ? PUZZLES[index + 1] : undefined;
}
