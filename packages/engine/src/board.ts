/**
 * Where parts sit.
 *
 * Grid size lives in the engine rather than the app because in a duel,
 * placement is a rule: a cell holds one part, and running out of room is a real
 * constraint on what you can play. Pixel sizes stay in the app — those are
 * presentation.
 */
export const BOARD_COLS = 11;
export const BOARD_ROWS = 8;

export interface Cell {
  readonly col: number;
  readonly row: number;
}

export function sameCell(a: Cell, b: Cell): boolean {
  return a.col === b.col && a.row === b.row;
}

export function inBounds(cell: Cell): boolean {
  return (
    Number.isInteger(cell.col) &&
    Number.isInteger(cell.row) &&
    cell.col >= 0 &&
    cell.col < BOARD_COLS &&
    cell.row >= 0 &&
    cell.row < BOARD_ROWS
  );
}

/** Starting cells for the circuit inputs: spread along the bottom row. */
export function inputCells(inputCount: number): Cell[] {
  const gap = Math.max(1, Math.floor(BOARD_COLS / inputCount));
  const used = gap * (inputCount - 1) + 1;
  const start = Math.max(0, Math.floor((BOARD_COLS - used) / 2));
  return Array.from({ length: inputCount }, (_, i) => ({
    col: Math.min(BOARD_COLS - 1, start + i * gap),
    row: BOARD_ROWS - 1,
  }));
}
