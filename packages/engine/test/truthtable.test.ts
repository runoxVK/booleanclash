import { describe, expect, it } from 'vitest';
import {
  and,
  applyChip,
  formatTable,
  fromRowString,
  inputColumn,
  maskFor,
  not,
  or,
  rowCount,
  toRowString,
} from '../src/truthtable.js';

describe('table geometry', () => {
  it('has 2^n rows', () => {
    expect(rowCount(1)).toBe(2);
    expect(rowCount(4)).toBe(16);
    expect(rowCount(6)).toBe(64);
  });

  it('masks to all ones', () => {
    expect(maskFor(2)).toBe(0xfn);
    expect(maskFor(4)).toBe(0xffffn);
  });
});

describe('inputColumn', () => {
  it('produces the memorable 4-input constants', () => {
    expect(inputColumn(4, 0)).toBe(0xaaaan); // a
    expect(inputColumn(4, 1)).toBe(0xccccn); // b
    expect(inputColumn(4, 2)).toBe(0xf0f0n); // c
    expect(inputColumn(4, 3)).toBe(0xff00n); // d
  });

  it('works for 2 inputs', () => {
    expect(inputColumn(2, 0)).toBe(0xan); // 0b1010
    expect(inputColumn(2, 1)).toBe(0xcn); // 0b1100
  });

  it('rejects out-of-range indices', () => {
    expect(() => inputColumn(2, 2)).toThrow(RangeError);
    expect(() => inputColumn(2, -1)).toThrow(RangeError);
  });
});

describe('primitives', () => {
  const a = inputColumn(2, 0);
  const b = inputColumn(2, 1);
  const mask = maskFor(2);

  it('computes AND, OR, NOT over every row at once', () => {
    expect(and(a, b)).toBe(0x8n); // only the row where both are 1
    expect(or(a, b)).toBe(0xen); // every row but the all-zero one
    expect(not(a, mask)).toBe(0x5n);
  });

  it('keeps NOT inside the mask instead of going negative', () => {
    expect(not(0n, maskFor(4))).toBe(0xffffn);
    expect(not(0n, mask) > 0n).toBe(true);
  });
});

describe('applyChip', () => {
  const XOR = 0x6n; // arity 2

  it('applies a 2-input chip to inputs c and d of a 4-input circuit', () => {
    const c = inputColumn(4, 2);
    const d = inputColumn(4, 3);
    expect(applyChip(XOR, [c, d], 4)).toBe(0x0ff0n);
    expect(applyChip(XOR, [c, d], 4)).toBe(c ^ d);
  });

  it('applies the same chip to a different binding', () => {
    const a = inputColumn(4, 0);
    const b = inputColumn(4, 1);
    // The whole point of chips: same function, different signals.
    expect(applyChip(XOR, [a, b], 4)).toBe(a ^ b);
  });
});

describe('row strings', () => {
  it('reads row 0 first, not most-significant-bit first', () => {
    // XOR over 2 inputs: rows 0..3 output 0,1,1,0
    expect(toRowString(0x6n, 2)).toBe('0110');
  });

  it('round-trips', () => {
    const { table, inputCount } = fromRowString('0110');
    expect(table).toBe(0x6n);
    expect(inputCount).toBe(2);
    expect(toRowString(table, inputCount)).toBe('0110');
  });

  it('rejects malformed targets', () => {
    expect(() => fromRowString('011')).toThrow(SyntaxError); // not a power of two
    expect(() => fromRowString('01x0')).toThrow(SyntaxError);
  });
});

describe('formatTable', () => {
  it('prints inputs in textbook order, a rightmost', () => {
    const printed = formatTable(0x6n, 2);
    expect(printed.split('\n')[0]).toBe('b a | out');
    expect(printed).toContain('0 0 |  0');
    expect(printed).toContain('0 1 |  1');
  });
});
