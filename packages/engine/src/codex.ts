import { rowCount } from './truthtable.js';

/**
 * The codex: recognizing which famous function a player just built.
 *
 * "You discovered XOR" is the game's dopamine hit, so recognition has to be
 * robust. The catch is that a pattern's parameter order comes from a graph
 * traversal, which is arbitrary — a player might build a MUX whose pins come out
 * in a different order than the textbook one. So lookups are done on a form that
 * is canonical under parameter permutation: of all the ways to reorder the pins,
 * take the numerically smallest table.
 *
 * Note this is only for NAMING. Chip identity for dedup and placement stays
 * exact, because pin order matters when you are wiring something up.
 */

/**
 * Rewrite a truth table as if its parameters had been reordered, where
 * `perm[i]` is the old parameter now sitting in position `i`.
 */
export function permuteTable(
  table: bigint,
  arity: number,
  perm: readonly number[],
): bigint {
  const rows = rowCount(arity);
  let out = 0n;
  for (let r = 0; r < rows; r++) {
    let sourceRow = 0;
    for (let i = 0; i < arity; i++) {
      if ((r >> i) & 1) sourceRow |= 1 << perm[i];
    }
    if ((table >> BigInt(sourceRow)) & 1n) out |= 1n << BigInt(r);
  }
  return out;
}

function permutations(n: number): number[][] {
  if (n <= 1) return [[0].slice(0, n)];
  const result: number[][] = [];
  const build = (current: number[], remaining: number[]): void => {
    if (remaining.length === 0) {
      result.push([...current]);
      return;
    }
    for (let i = 0; i < remaining.length; i++) {
      build(
        [...current, remaining[i]],
        [...remaining.slice(0, i), ...remaining.slice(i + 1)],
      );
    }
  };
  build(
    [],
    Array.from({ length: n }, (_, i) => i),
  );
  return result;
}

/** Smallest table reachable by reordering parameters. Cheap: arity is <= 5. */
export function canonicalUnderPermutation(table: bigint, arity: number): bigint {
  let best = table;
  for (const perm of permutations(arity)) {
    const candidate = permuteTable(table, arity, perm);
    if (candidate < best) best = candidate;
  }
  return best;
}

/**
 * Well-known functions, declared with their natural (textbook) tables. The
 * canonical forms are computed at load, so nothing here is hand-canonicalized.
 *
 * Tables follow the engine's row convention: bit `p` of the row index is the
 * value of parameter `p`, and row 0 is all-zeroes.
 */
const KNOWN: ReadonlyArray<{ arity: number; table: bigint; name: string }> = [
  // arity 1
  { arity: 1, table: 0x1n, name: 'NOT' },
  { arity: 1, table: 0x2n, name: 'BUFFER' },

  // arity 2
  { arity: 2, table: 0x0n, name: 'ALWAYS 0' },
  { arity: 2, table: 0x1n, name: 'NOR' },
  { arity: 2, table: 0x2n, name: 'ANDNOT' },
  { arity: 2, table: 0x6n, name: 'XOR' },
  { arity: 2, table: 0x7n, name: 'NAND' },
  { arity: 2, table: 0x8n, name: 'AND' },
  { arity: 2, table: 0x9n, name: 'XNOR' },
  { arity: 2, table: 0xbn, name: 'IMPLIES' },
  { arity: 2, table: 0xen, name: 'OR' },
  { arity: 2, table: 0xfn, name: 'ALWAYS 1' },

  // arity 3
  { arity: 3, table: 0x01n, name: 'NOR3' },
  { arity: 3, table: 0x80n, name: 'AND3' },
  { arity: 3, table: 0x7fn, name: 'NAND3' },
  { arity: 3, table: 0xfen, name: 'OR3' },
  { arity: 3, table: 0x96n, name: 'XOR3' },
  { arity: 3, table: 0xe8n, name: 'MAJORITY' },
  { arity: 3, table: 0xcan, name: 'MUX' },
];

const codex = new Map<string, string>();
for (const entry of KNOWN) {
  const key = `${entry.arity}:${canonicalUnderPermutation(entry.table, entry.arity)}`;
  // First declaration wins, so earlier names are the preferred label.
  if (!codex.has(key)) codex.set(key, entry.name);
}

/** The famous name for this function, or null if it is not a known one. */
export function identify(arity: number, table: bigint): string | null {
  const key = `${arity}:${canonicalUnderPermutation(table, arity)}`;
  return codex.get(key) ?? null;
}

/**
 * A label for any function: its famous name if it has one, otherwise a stable
 * generated tag. Players can rename chips, so this is only the default.
 */
export function describeFunction(arity: number, table: bigint): string {
  return identify(arity, table) ?? `F${arity}-${table.toString(16).toUpperCase()}`;
}
