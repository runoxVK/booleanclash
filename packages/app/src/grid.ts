import type { NodeId } from '@logiclash/engine';

/**
 * The board is a fixed tiled grid. One part per cell, placed where you put it.
 *
 * Automatic layout was tidier but took the board away from the player: you could
 * not group a sub-circuit, leave space to work in, or lay two copies of a shape
 * side by side to compare them. Since spotting a repeated shape is the whole
 * skill of this game, being able to arrange the board so a repeat is *visible*
 * is not cosmetic — it is the main tool for playing well.
 */

/* Roomier than fits comfortably on screen at 1:1 — the board zooms and pans,
   so the grid is sized for the circuits people actually build rather than for
   what fits in one glance. */
export const COLS = 11;
export const ROWS = 8;

export const CELL_W = 104;
export const CELL_H = 78;
export const PART_W = 84;
export const PART_H = 54;

/** Strip above the grid holding the output terminal. */
export const DOCK_H = 76;
/** Strip below the last row, because input switches hang under their part. */
export const FLOOR_H = 30;

export const BOARD_W = COLS * CELL_W;
export const BOARD_H = DOCK_H + ROWS * CELL_H + FLOOR_H;

export interface Cell {
  readonly col: number;
  readonly row: number;
}

export type CellMap = ReadonlyMap<NodeId, Cell>;

export function sameCell(a: Cell, b: Cell): boolean {
  return a.col === b.col && a.row === b.row;
}

export function inBounds(cell: Cell): boolean {
  return (
    cell.col >= 0 && cell.col < COLS && cell.row >= 0 && cell.row < ROWS
  );
}

/** Top-left corner of the part drawn in this cell. */
export function partOrigin(cell: Cell): { x: number; y: number } {
  return {
    x: cell.col * CELL_W + (CELL_W - PART_W) / 2,
    y: DOCK_H + cell.row * CELL_H + (CELL_H - PART_H) / 2,
  };
}

/** Which cell a board-space point falls in, or null if it is off the grid. */
export function cellAtPoint(x: number, y: number): Cell | null {
  const col = Math.floor(x / CELL_W);
  const row = Math.floor((y - DOCK_H) / CELL_H);
  const cell = { col, row };
  return inBounds(cell) ? cell : null;
}

export function occupant(cells: CellMap, cell: Cell): NodeId | null {
  for (const [id, at] of cells) {
    if (sameCell(at, cell)) return id;
  }
  return null;
}

/** Where a part's output pin sits. */
export function outPin(cell: Cell): { x: number; y: number } {
  const at = partOrigin(cell);
  return { x: at.x + PART_W / 2, y: at.y };
}

/** Where a part's i-th input pin sits along its bottom edge. */
export function inPin(
  cell: Cell,
  index: number,
  count: number,
): { x: number; y: number } {
  const at = partOrigin(cell);
  return {
    x: at.x + (PART_W * (index + 1)) / (count + 1),
    y: at.y + PART_H,
  };
}

/** Starting cells for the circuit inputs: spread along the bottom row. */
export function inputCells(inputCount: number): Cell[] {
  const gap = Math.max(1, Math.floor(COLS / inputCount));
  const used = gap * (inputCount - 1) + 1;
  const start = Math.max(0, Math.floor((COLS - used) / 2));
  return Array.from({ length: inputCount }, (_, i) => ({
    col: Math.min(COLS - 1, start + i * gap),
    row: ROWS - 1,
  }));
}

/** First free cell scanning from the bottom up, for auto-placement fallbacks. */
export function firstFreeCell(cells: CellMap): Cell | null {
  for (let row = ROWS - 2; row >= 0; row--) {
    for (let col = 0; col < COLS; col++) {
      const cell = { col, row };
      if (occupant(cells, cell) === null) return cell;
    }
  }
  return null;
}
