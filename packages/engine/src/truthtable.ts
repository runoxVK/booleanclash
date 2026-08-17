/**
 * Truth tables as bigints — the trick the whole engine rests on.
 *
 * A signal's complete behaviour over every possible input combination is one
 * bigint. For `n` inputs there are `2 ** n` rows, and bit `r` of the bigint is
 * the signal's value in row `r`. So evaluating a gate against EVERY input
 * combination at once is a single bitwise operation.
 *
 * Conventions (these matter — everything else assumes them):
 *   - Row index `r` encodes the inputs: bit `p` of `r` is the value of input
 *     `p` in that row. Row 0 is therefore "all inputs 0".
 *   - Input 0 is `a`, input 1 is `b`, and so on.
 *   - A truth table's bit `r` is the output for row `r`.
 *
 * With n = 4 that makes the input columns memorable constants:
 *   a = 0xAAAA   b = 0xCCCC   c = 0xF0F0   d = 0xFF00
 */

/** Number of rows in a truth table over `inputCount` inputs. */
export function rowCount(inputCount: number): number {
  return 1 << inputCount;
}

/** All-ones table for `inputCount` inputs — used to keep NOT from going negative. */
export function maskFor(inputCount: number): bigint {
  return (1n << BigInt(rowCount(inputCount))) - 1n;
}

/**
 * The truth table of a bare input: bit `r` is set iff input `index` is 1 in row `r`.
 * Cached, because these are requested constantly during evaluation.
 */
const columnCache = new Map<string, bigint>();

export function inputColumn(inputCount: number, index: number): bigint {
  if (index < 0 || index >= inputCount) {
    throw new RangeError(
      `Input index ${index} out of range for a ${inputCount}-input circuit`,
    );
  }
  const key = `${inputCount}:${index}`;
  const cached = columnCache.get(key);
  if (cached !== undefined) return cached;

  let column = 0n;
  const rows = rowCount(inputCount);
  for (let r = 0; r < rows; r++) {
    if ((r >> index) & 1) column |= 1n << BigInt(r);
  }
  columnCache.set(key, column);
  return column;
}

/* ------------------------------------------------------------------ */
/* Primitive operations                                               */
/* ------------------------------------------------------------------ */

export function and(a: bigint, b: bigint): bigint {
  return a & b;
}

export function or(a: bigint, b: bigint): bigint {
  return a | b;
}

/**
 * NOT needs the mask: bigints are arbitrary-precision, so `~a` alone would set
 * infinitely many high bits (and read as negative). Masking trims it back to
 * the circuit's row count.
 */
export function not(a: bigint, mask: bigint): bigint {
  return ~a & mask;
}

/**
 * Evaluate a chip instance.
 *
 * The chip knows its behaviour over its own `arity` parameters. Each argument
 * arrives as a full column over the OUTER circuit's rows. So for each outer row
 * we read off the parameter values, look up the chip's output for that
 * combination, and write it back into the outer column.
 */
export function applyChip(
  chipTable: bigint,
  args: readonly bigint[],
  inputCount: number,
): bigint {
  const rows = rowCount(inputCount);
  let out = 0n;
  for (let r = 0; r < rows; r++) {
    const shift = BigInt(r);
    let paramRow = 0;
    for (let p = 0; p < args.length; p++) {
      if ((args[p] >> shift) & 1n) paramRow |= 1 << p;
    }
    if ((chipTable >> BigInt(paramRow)) & 1n) out |= 1n << shift;
  }
  return out;
}

/* ------------------------------------------------------------------ */
/* Human-readable forms                                               */
/* ------------------------------------------------------------------ */

/**
 * Render a table as a row-ordered bit string: character `i` is the output for
 * row `i`, so the string reads top-to-bottom like a printed truth table.
 *
 * Note this is the REVERSE of how you'd read a binary literal, where the
 * leftmost digit is the most significant bit. Puzzle targets use this row order
 * because that is how a player reads them.
 */
export function toRowString(table: bigint, inputCount: number): string {
  const rows = rowCount(inputCount);
  let out = '';
  for (let r = 0; r < rows; r++) {
    out += (table >> BigInt(r)) & 1n ? '1' : '0';
  }
  return out;
}

/** Parse a row-ordered bit string (see toRowString) into a table + input count. */
export function fromRowString(bits: string): {
  table: bigint;
  inputCount: number;
} {
  if (!/^[01]+$/.test(bits)) {
    throw new SyntaxError('Truth table string must contain only 0 and 1');
  }
  const inputCount = Math.log2(bits.length);
  if (!Number.isInteger(inputCount)) {
    throw new SyntaxError(
      `Truth table length must be a power of two, got ${bits.length}`,
    );
  }
  let table = 0n;
  for (let r = 0; r < bits.length; r++) {
    if (bits[r] === '1') table |= 1n << BigInt(r);
  }
  return { table, inputCount };
}

const INPUT_NAMES = 'abcdefghijklmnop';

/** Pretty-print a full truth table. Development and debugging aid. */
export function formatTable(table: bigint, inputCount: number): string {
  const names: string[] = [];
  for (let p = inputCount - 1; p >= 0; p--) names.push(INPUT_NAMES[p]);

  const lines = [`${names.join(' ')} | out`];
  lines.push(`${names.map(() => '-').join('-')}-+----`);

  const rows = rowCount(inputCount);
  for (let r = 0; r < rows; r++) {
    const cells: string[] = [];
    for (let p = inputCount - 1; p >= 0; p--) cells.push(String((r >> p) & 1));
    const bit = (table >> BigInt(r)) & 1n;
    lines.push(`${cells.join(' ')} |  ${bit}`);
  }
  return lines.join('\n');
}
