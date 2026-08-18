import {
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
  type ReactElement,
} from 'react';
import type { ChipRegistry, Circuit, NodeId } from '@logiclash/engine';
import {
  BOARD_H,
  BOARD_W,
  CELL_H,
  CELL_W,
  COLS,
  DOCK_H,
  PART_H,
  PART_W,
  ROWS,
  cellAtPoint,
  inPin,
  occupant,
  outPin,
  partOrigin,
  type Cell,
  type CellMap,
} from '../grid';
import type { Tool } from '../game';

const INPUT_NAMES = 'abcdefgh';
const PIN_R = 9;
const PIN_LABELS = ['a', 'b', 'c', 'd'];
/** How close a dropped wire has to land to count as hitting a pin. */
const SNAP = 26;
/** Movement beyond this turns a click into a drag. */
const DRAG_SLOP = 5;

interface BoardProps {
  readonly circuit: Circuit;
  readonly registry: ChipRegistry;
  readonly values: ReadonlyMap<NodeId, bigint>;
  readonly cells: CellMap;
  readonly selection: readonly NodeId[];
  readonly armed: Tool | null;
  /** True when the current selection adds up to a component. */
  readonly selectionPackages: boolean;
  readonly target: bigint;
  readonly probeRow: number;
  readonly onSelect: (id: NodeId) => void;
  readonly onPlace: (cell: Cell) => void;
  readonly onMove: (id: NodeId, cell: Cell) => void;
  readonly onWire: (targetId: NodeId, pin: number, sourceId: NodeId) => void;
  readonly onUnwire: (targetId: NodeId, pin: number) => void;
  readonly onFlipInput: (index: number) => void;
  readonly onBackground: () => void;
}

type Drag =
  | {
      readonly kind: 'move';
      readonly id: NodeId;
      readonly originX: number;
      readonly originY: number;
      readonly x: number;
      readonly y: number;
      readonly moved: boolean;
    }
  | {
      readonly kind: 'wire';
      readonly sourceId: NodeId;
      readonly x: number;
      readonly y: number;
    }
  | null;

function labelFor(circuit: Circuit, registry: ChipRegistry, id: NodeId): string {
  const node = circuit.nodes.get(id);
  if (!node) return '?';
  if (node.kind === 'INPUT') return INPUT_NAMES[node.inputIndex ?? 0] ?? '?';
  if (node.kind === 'CHIP') {
    return node.chipId ? registry.get(node.chipId)?.name ?? 'chip' : 'chip';
  }
  return node.kind.toLowerCase();
}

/** Orthogonal route from an output pin up into an input pin. */
function wirePath(
  from: { x: number; y: number },
  to: { x: number; y: number },
): string {
  const mid = (from.y + to.y) / 2;
  return `M ${from.x} ${from.y} V ${mid} H ${to.x} V ${to.y}`;
}

/** Pin offsets within a part, independent of which cell it sits in. */
function localInPin(index: number, count: number): { x: number; y: number } {
  return { x: (PART_W * (index + 1)) / (count + 1), y: PART_H };
}

export function Board({
  circuit,
  registry,
  values,
  cells,
  selection,
  armed,
  selectionPackages,
  target,
  probeRow,
  onSelect,
  onPlace,
  onMove,
  onWire,
  onUnwire,
  onFlipInput,
  onBackground,
}: BoardProps) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<Drag>(null);
  const [hover, setHover] = useState<Cell | null>(null);

  const selectionIndex = new Map(selection.map((id, i) => [id, i + 1]));

  const bitOf = (id: NodeId | null): number | null => {
    if (id === null) return null;
    const value = values.get(id);
    if (value === undefined) return null;
    return Number((value >> BigInt(probeRow)) & 1n);
  };

  /** Client coordinates into board coordinates, independent of zoom. */
  const toBoard = (event: ReactPointerEvent): { x: number; y: number } => {
    const svg = svgRef.current;
    const ctm = svg?.getScreenCTM();
    if (!svg || !ctm) return { x: 0, y: 0 };
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(
      ctm.inverse(),
    );
    return { x: point.x, y: point.y };
  };

  /* Every pin on the board, so a dropped wire can snap to the nearest one.
     Hit-testing by geometry rather than by event target keeps the drop working
     even though the pointer is captured by the surface, not the pin. */
  const pinTargets: { id: NodeId; pin: number; x: number; y: number }[] = [];
  for (const node of circuit.nodes.values()) {
    const cell = cells.get(node.id);
    if (!cell) continue;
    node.inputs.forEach((_, i) => {
      const at = inPin(cell, i, node.inputs.length);
      pinTargets.push({ id: node.id, pin: i, x: at.x, y: at.y });
    });
  }

  const nearestPin = (x: number, y: number) => {
    let best: { id: NodeId; pin: number } | null = null;
    let bestDistance = SNAP * SNAP;
    for (const t of pinTargets) {
      const distance = (t.x - x) ** 2 + (t.y - y) ** 2;
      if (distance < bestDistance) {
        bestDistance = distance;
        best = { id: t.id, pin: t.pin };
      }
    }
    return best;
  };

  /* ---------------- pointer handling ---------------- */

  /**
   * Start a drag properly.
   *
   * preventDefault stops the browser treating the drag as a text selection,
   * which otherwise smears highlight across the page as you pull a wire.
   * Capturing the pointer on the surface means the drag keeps tracking even when
   * the cursor wanders off the board, instead of dying halfway.
   */
  const beginDrag = (event: ReactPointerEvent) => {
    event.preventDefault();
    event.stopPropagation();
    try {
      svgRef.current?.setPointerCapture(event.pointerId);
    } catch {
      // Some pointers cannot be captured; the drag still works, it just stops
      // tracking if the cursor leaves the board.
    }
  };

  const onSurfacePointerDown = (event: ReactPointerEvent) => {
    event.preventDefault();
    const { x, y } = toBoard(event);
    const cell = cellAtPoint(x, y);
    if (armed && cell && occupant(cells, cell) === null) {
      onPlace(cell);
      return;
    }
    if (!cell || occupant(cells, cell) === null) onBackground();
  };

  const onPointerMove = (event: ReactPointerEvent) => {
    const { x, y } = toBoard(event);
    setHover(cellAtPoint(x, y));
    if (!drag) return;

    if (drag.kind === 'move') {
      const moved =
        drag.moved ||
        Math.abs(x - drag.originX) > DRAG_SLOP ||
        Math.abs(y - drag.originY) > DRAG_SLOP;
      setDrag({ ...drag, x, y, moved });
    } else {
      setDrag({ ...drag, x, y });
    }
  };

  const onPointerUp = (event: ReactPointerEvent) => {
    try {
      if (svgRef.current?.hasPointerCapture(event.pointerId)) {
        svgRef.current.releasePointerCapture(event.pointerId);
      }
    } catch {
      // Nothing to release.
    }
    if (!drag) return;
    const { x, y } = toBoard(event);

    if (drag.kind === 'move') {
      // A press that never moved is a click, and a click selects.
      if (!drag.moved) {
        onSelect(drag.id);
      } else {
        const cell = cellAtPoint(x, y);
        if (cell) onMove(drag.id, cell);
      }
    } else {
      const hit = nearestPin(x, y);
      if (hit && hit.id !== drag.sourceId) {
        onWire(hit.id, hit.pin, drag.sourceId);
      }
    }
    setDrag(null);
  };

  /* ---------------- geometry ---------------- */

  const wires: ReactElement[] = [];
  for (const node of circuit.nodes.values()) {
    const to = cells.get(node.id);
    if (!to) continue;
    node.inputs.forEach((sourceId, i) => {
      if (sourceId === null) return;
      const from = cells.get(sourceId);
      if (!from) return;
      wires.push(
        <path
          key={`${sourceId}->${node.id}:${i}`}
          className={`wire${bitOf(sourceId) === 1 ? ' hot' : ''}`}
          d={wirePath(outPin(from), inPin(to, i, node.inputs.length))}
        />,
      );
    });
  }

  const dock = { x: BOARD_W / 2, y: 30 };
  const outBit = circuit.outputId !== null ? bitOf(circuit.outputId) : null;
  const outCell =
    circuit.outputId !== null ? cells.get(circuit.outputId) : undefined;
  const dragSourceCell =
    drag?.kind === 'wire' ? cells.get(drag.sourceId) : undefined;

  return (
    <div className="board-scroll">
      <svg
        ref={svgRef}
        className={`board${armed ? ' placing' : ''}`}
        viewBox={`0 0 ${BOARD_W} ${BOARD_H}`}
        preserveAspectRatio="xMidYMid meet"
        onPointerDown={onSurfacePointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerLeave={() => setHover(null)}
        onPointerCancel={() => setDrag(null)}
      >
        <rect className="canvas" width={BOARD_W} height={BOARD_H} />

        <g className="grid">
          {Array.from({ length: ROWS + 1 }, (_, r) => (
            <line
              key={`h${r}`}
              x1={0}
              y1={DOCK_H + r * CELL_H}
              x2={BOARD_W}
              y2={DOCK_H + r * CELL_H}
            />
          ))}
          {Array.from({ length: COLS + 1 }, (_, c) => (
            <line
              key={`v${c}`}
              x1={c * CELL_W}
              y1={DOCK_H}
              x2={c * CELL_W}
              y2={BOARD_H}
            />
          ))}
        </g>

        {armed && hover && occupant(cells, hover) === null && (
          <rect
            className="cell-hint"
            x={hover.col * CELL_W + 3}
            y={DOCK_H + hover.row * CELL_H + 3}
            width={CELL_W - 6}
            height={CELL_H - 6}
            rx={5}
          />
        )}

        <g className="wires">{wires}</g>

        {outCell && (
          <path
            className={`wire${outBit === 1 ? ' hot' : ''}`}
            d={wirePath(outPin(outCell), { x: dock.x, y: dock.y + 22 })}
          />
        )}

        {drag?.kind === 'wire' && dragSourceCell && (
          <path
            className="wire dragging"
            d={wirePath(outPin(dragSourceCell), { x: drag.x, y: drag.y })}
          />
        )}

        <g className={`terminal${outBit === 1 ? ' hot' : ''}`}>
          <rect
            className="value-box"
            x={dock.x - 15}
            y={dock.y - 16}
            width={30}
            height={26}
            rx={4}
          />
          <text className="value" x={dock.x} y={dock.y + 3}>
            {outBit === null ? '·' : outBit}
          </text>
          <circle className="pin" cx={dock.x} cy={dock.y + 22} r={PIN_R} />
        </g>
        <text className="dock-label" x={12} y={dock.y + 4}>
          Output
        </text>

        {[...circuit.nodes.values()].map((node) => {
          const cell = cells.get(node.id);
          if (!cell) return null;

          const lifted = drag?.kind === 'move' && drag.id === node.id && drag.moved;
          const at = lifted
            ? { x: drag.x - PART_W / 2, y: drag.y - PART_H / 2 }
            : partOrigin(cell);

          const value = values.get(node.id);
          const bit = bitOf(node.id);
          const order = selectionIndex.get(node.id);
          const pins = node.inputs.length;

          const classes = ['part', `kind-${node.kind.toLowerCase()}`];
          if (order !== undefined) classes.push('selected');
          if (order !== undefined && selectionPackages) classes.push('packages');
          if (value !== undefined && value === target) classes.push('matches');
          if (circuit.outputId === node.id) classes.push('is-output');
          if (bit === 1) classes.push('hot');
          if (lifted) classes.push('lifted');
          if (node.inputs.some((ref) => ref === null)) classes.push('unfinished');

          return (
            <g
              key={node.id}
              className={classes.join(' ')}
              transform={`translate(${at.x} ${at.y})`}
            >
              <rect
                className="body"
                width={PART_W}
                height={PART_H}
                rx={9}
                onPointerDown={(event) => {
                  beginDrag(event);
                  const p = toBoard(event);
                  setDrag({
                    kind: 'move',
                    id: node.id,
                    originX: p.x,
                    originY: p.y,
                    x: p.x,
                    y: p.y,
                    moved: false,
                  });
                }}
              />
              <text className="part-label" x={PART_W / 2} y={PART_H / 2 + 5}>
                {labelFor(circuit, registry, node.id)}
              </text>

              {node.inputs.map((sourceId, i) => {
                const local = localInPin(i, pins);
                const filled = sourceId !== null;
                return (
                  <g
                    key={`pin${i}`}
                    className={
                      'pin-group' +
                      (bitOf(sourceId) === 1 ? ' hot' : '') +
                      (filled ? '' : ' empty')
                    }
                    onPointerDown={(event) => {
                      event.preventDefault();
                      event.stopPropagation();
                      if (filled) onUnwire(node.id, i);
                    }}
                  >
                    <circle className="pin" cx={local.x} cy={local.y} r={PIN_R} />
                    {pins > 1 && (
                      <text className="pin-label" x={local.x} y={local.y + 3.5}>
                        {PIN_LABELS[i]}
                      </text>
                    )}
                  </g>
                );
              })}

              <g
                className={`pin-group out${bit === 1 ? ' hot' : ''}`}
                onPointerDown={(event) => {
                  beginDrag(event);
                  const p = toBoard(event);
                  setDrag({ kind: 'wire', sourceId: node.id, x: p.x, y: p.y });
                }}
              >
                <circle className="pin" cx={PART_W / 2} cy={0} r={PIN_R} />
                {bit !== null && (
                  <text className="pin-value" x={PART_W / 2} y={3.5}>
                    {bit}
                  </text>
                )}
              </g>

              {node.kind === 'INPUT' && (
                <g
                  className={`switch${bit === 1 ? ' on' : ''}`}
                  onPointerDown={(event) => {
                    event.preventDefault();
                    event.stopPropagation();
                    onFlipInput(node.inputIndex ?? 0);
                  }}
                >
                  <rect
                    className="track"
                    x={PART_W / 2 - 20}
                    y={PART_H + 8}
                    width={40}
                    height={18}
                    rx={9}
                  />
                  <circle
                    className="knob"
                    cx={PART_W / 2 + (bit === 1 ? 11 : -11)}
                    cy={PART_H + 17}
                    r={7}
                  />
                </g>
              )}

              {order !== undefined && (
                <g className="order">
                  <rect x={4} y={4} width={17} height={16} rx={3} />
                  <text x={12.5} y={16}>
                    {order}
                  </text>
                </g>
              )}
            </g>
          );
        })}

        <text className="dock-label" x={12} y={BOARD_H - 14}>
          Input
        </text>
      </svg>
    </div>
  );
}
