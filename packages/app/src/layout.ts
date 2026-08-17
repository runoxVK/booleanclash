import type { Circuit, NodeId } from '@logiclash/engine';

/**
 * Automatic bottom-to-top layout.
 *
 * Signal flows upward: circuit inputs sit on the floor, each gate rises above
 * whatever feeds it, and the output terminal docks at the ceiling. That is the
 * orientation a breadboard-style schematic reads in, and it means depth in the
 * graph maps directly to height on screen.
 *
 * Because gates are created by applying them to already-placed signals, the
 * graph is always a DAG flowing one way, so layering by depth is enough and the
 * player never has to arrange anything.
 */

export const NODE_W = 86;
export const NODE_H = 54;
/** Room above the top layer for the output terminal. */
export const CEILING = 78;

const COL_GAP = 32;
const ROW_GAP = 48;
const PAD_X = 30;
const PAD_BOTTOM = 30;

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

  const layers = new Map<number, NodeId[]>();
  for (const id of order) {
    const depth = depthOf(id);
    const layer = layers.get(depth);
    if (layer) layer.push(id);
    else layers.set(depth, [id]);
  }

  for (const layer of layers.values()) {
    layer.sort((a, b) => (rank.get(a) ?? 0) - (rank.get(b) ?? 0));
  }

  const topDepth = Math.max(0, ...layers.keys());
  const layerCount = topDepth + 1;
  const widest = Math.max(1, ...[...layers.values()].map((l) => l.length));

  const width = PAD_X * 2 + widest * NODE_W + (widest - 1) * COL_GAP;
  const height =
    CEILING + PAD_BOTTOM + layerCount * NODE_H + (layerCount - 1) * ROW_GAP;

  const positions = new Map<NodeId, Placement>();
  for (const [depth, ids] of layers) {
    const span = ids.length * NODE_W + (ids.length - 1) * COL_GAP;
    const left = (width - span) / 2;
    // Depth 0 sits on the floor; higher depths climb toward the ceiling.
    const y = CEILING + (topDepth - depth) * (NODE_H + ROW_GAP);
    ids.forEach((id, i) => {
      positions.set(id, { x: left + i * (NODE_W + COL_GAP), y });
    });
  }

  return { positions, width, height };
}
