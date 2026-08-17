import type { Circuit, NodeId } from '@logiclash/engine';

/**
 * Automatic left-to-right layout.
 *
 * Because gates are created by applying them to already-placed signals, the
 * graph is always a DAG flowing forward, so a simple layering by depth reads
 * well and the player never has to arrange anything. If free-form dragging
 * arrives later, this becomes the "tidy up" button rather than the only mode.
 */

export const NODE_W = 100;
export const NODE_H = 46;
const COL_GAP = 78;
const ROW_GAP = 20;
const PAD = 28;

export interface Placement {
  readonly x: number;
  readonly y: number;
}

export interface LayoutResult {
  readonly positions: ReadonlyMap<NodeId, Placement>;
  readonly width: number;
  readonly height: number;
}

export function layout(circuit: Circuit): LayoutResult {
  const order = [...circuit.nodes.keys()];
  const rank = new Map<NodeId, number>(order.map((id, i) => [id, i]));
  const depths = new Map<NodeId, number>();

  const depthOf = (id: NodeId): number => {
    const cached = depths.get(id);
    if (cached !== undefined) return cached;

    const node = circuit.nodes.get(id);
    let depth = 0;
    if (node && node.kind !== 'INPUT' && node.inputs.length > 0) {
      depth = 1 + Math.max(...node.inputs.map(depthOf));
    }
    depths.set(id, depth);
    return depth;
  };

  const columns = new Map<number, NodeId[]>();
  for (const id of order) {
    const depth = depthOf(id);
    const column = columns.get(depth);
    if (column) column.push(id);
    else columns.set(depth, [id]);
  }

  for (const column of columns.values()) {
    column.sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
  }

  const tallest = Math.max(1, ...[...columns.values()].map((c) => c.length));
  const height = PAD * 2 + tallest * NODE_H + (tallest - 1) * ROW_GAP;
  const columnCount = Math.max(1, ...[...columns.keys()].map((d) => d + 1));
  const width = PAD * 2 + columnCount * NODE_W + (columnCount - 1) * COL_GAP;

  const positions = new Map<NodeId, Placement>();
  for (const [depth, ids] of columns) {
    const span = ids.length * NODE_H + (ids.length - 1) * ROW_GAP;
    const top = (height - span) / 2;
    ids.forEach((id, i) => {
      positions.set(id, {
        x: PAD + depth * (NODE_W + COL_GAP),
        y: top + i * (NODE_H + ROW_GAP),
      });
    });
  }

  return { positions, width, height };
}
