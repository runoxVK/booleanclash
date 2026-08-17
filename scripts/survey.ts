/**
 * Survey the puzzle generator: `npm run survey`.
 *
 * Prints the shape of a batch of generated puzzles so you can see, at a glance,
 * whether the pool is varied and whether merging is paying off often enough.
 * This is the instrument for M6 tuning — change a number in tuning.ts, rerun,
 * and watch the distribution move.
 */

import { generatePuzzle, toRowString } from '../packages/engine/src/index.js';

const COUNT = 40;
const INPUT_COUNT = 4;

const puzzles = Array.from({ length: COUNT }, (_, i) =>
  generatePuzzle(i + 1, INPUT_COUNT),
);

console.log(`\n${COUNT} puzzles, ${INPUT_COUNT} inputs\n`);
console.log('seed  par  raw  save  uses  chip        target');
console.log('-'.repeat(64));

for (const p of puzzles) {
  const save = p.parWithoutMerging - p.par;
  console.log(
    [
      String(p.seed).padStart(4),
      String(p.par).padStart(4),
      String(p.parWithoutMerging).padStart(4),
      String(save).padStart(5),
      String(p.instances).padStart(5),
      (p.keyChip ?? '—').padEnd(11),
      toRowString(p.target, p.inputCount),
    ].join(' '),
  );
}

const pars = puzzles.map((p) => p.par);
const withPlay = puzzles.filter((p) => p.par < p.parWithoutMerging);
const chips = new Map<string, number>();
for (const p of puzzles) {
  const key = p.keyChip ?? 'unnamed';
  chips.set(key, (chips.get(key) ?? 0) + 1);
}

console.log('-'.repeat(64));
console.log(`par        min ${Math.min(...pars)}  max ${Math.max(...pars)}  mean ${(pars.reduce((a, b) => a + b, 0) / pars.length).toFixed(1)}`);
console.log(`merge pays ${withPlay.length}/${COUNT}  (avg saving ${(withPlay.reduce((a, p) => a + (p.parWithoutMerging - p.par), 0) / Math.max(1, withPlay.length)).toFixed(1)})`);
console.log(`distinct targets ${new Set(puzzles.map((p) => p.target)).size}/${COUNT}`);
console.log(`key chips  ${[...chips].map(([k, v]) => `${k}:${v}`).join('  ')}\n`);
