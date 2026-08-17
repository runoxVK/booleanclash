import { describe, expect, it } from 'vitest';
import {
  dependsOnEveryInput,
  generatePuzzle,
} from '../src/generate.js';
import { makeRng } from '../src/random.js';
import { rowCount } from '../src/truthtable.js';

const SEEDS = Array.from({ length: 60 }, (_, i) => i + 1);

describe('rng', () => {
  it('is deterministic for a seed', () => {
    const a = Array.from({ length: 5 }, makeRng(42));
    const b = Array.from({ length: 5 }, makeRng(42));
    expect(a).toEqual(b);
  });

  it('differs between seeds', () => {
    expect(makeRng(1)()).not.toBe(makeRng(2)());
  });

  it('stays inside [0, 1)', () => {
    const rng = makeRng(7);
    for (let i = 0; i < 500; i++) {
      const v = rng();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });
});

describe('dependsOnEveryInput', () => {
  it('spots an ignored input', () => {
    // 2-input table that only reads parameter 0.
    expect(dependsOnEveryInput(0xan, 2)).toBe(false);
    // XOR reads both.
    expect(dependsOnEveryInput(0x6n, 2)).toBe(true);
  });
});

describe('generatePuzzle', () => {
  it('is reproducible from a seed', () => {
    const a = generatePuzzle(123);
    const b = generatePuzzle(123);
    expect(a).toEqual(b);
  });

  it('gives different seeds different puzzles', () => {
    const targets = new Set(SEEDS.map((s) => generatePuzzle(s).target));
    // Not all distinct necessarily, but the pool should not collapse.
    expect(targets.size).toBeGreaterThan(SEEDS.length / 2);
  });

  it('never ships a degenerate target', () => {
    for (const seed of SEEDS) {
      const puzzle = generatePuzzle(seed);
      const rows = rowCount(puzzle.inputCount);

      // Not constant.
      const first = puzzle.target & 1n;
      let varies = false;
      for (let r = 1; r < rows; r++) {
        if (((puzzle.target >> BigInt(r)) & 1n) !== first) varies = true;
      }
      expect(varies, `seed ${seed} is constant`).toBe(true);

      // Every input matters.
      expect(
        dependsOnEveryInput(puzzle.target, puzzle.inputCount),
        `seed ${seed} ignores an input`,
      ).toBe(true);
    }
  });

  it('always leaves a par worth playing for', () => {
    for (const seed of SEEDS) {
      const puzzle = generatePuzzle(seed);
      expect(puzzle.par, `seed ${seed}`).toBeGreaterThanOrEqual(4);
      expect(puzzle.par).toBeLessThanOrEqual(puzzle.parWithoutMerging);
      expect(puzzle.instances).toBeGreaterThanOrEqual(2);
    }
  });

  it('mostly produces puzzles where merging actually pays', () => {
    const withMergePlay = SEEDS.filter((s) => {
      const p = generatePuzzle(s);
      return p.par < p.parWithoutMerging;
    });
    // The whole point of building backwards from a repeated motif.
    expect(withMergePlay.length).toBeGreaterThan(SEEDS.length * 0.7);
  });

  it('supports 3 to 6 inputs and rejects the rest', () => {
    for (const n of [3, 4, 5]) {
      expect(generatePuzzle(9, n).inputCount).toBe(n);
    }
    expect(() => generatePuzzle(9, 2)).toThrow(RangeError);
    expect(() => generatePuzzle(9, 7)).toThrow(RangeError);
  });
});
