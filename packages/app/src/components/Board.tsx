import type { ReactElement } from 'react';
import type { ChipRegistry, Circuit, NodeId } from '@logiclash/engine';
import { layout, NODE_H, NODE_W } from '../layout';

const INPUT_NAMES = 'abcdefgh';
/** Length of the pin stubs poking out of each side of a component. */
const STUB = 9;

interface BoardProps {
  readonly circuit: Circuit;
  readonly registry: ChipRegistry;
  readonly values: ReadonlyMap<NodeId, bigint>;
  readonly selection: readonly NodeId[];
  readonly target: bigint;
  /** Input combination being probed, or null to show whole truth tables. */
  readonly probeRow: number | null;
  readonly onToggle: (id: NodeId) => void;
}

function labelFor(circuit: Circuit, registry: ChipRegistry, id: NodeId): string {
  const node = circuit.nodes.get(id);
  if (!node) return '?';
  if (node.kind === 'INPUT') return INPUT_NAMES[node.inputIndex ?? 0] ?? '?';
  if (node.kind === 'CHIP') {
    return node.chipId ? registry.get(node.chipId)?.name ?? 'CHIP' : 'CHIP';
  }
  return node.kind;
}

function bitsFor(value: bigint, inputCount: number): string {
  const rows = 1 << inputCount;
  let out = '';
  for (let r = 0; r < rows; r++) out += (value >> BigInt(r)) & 1n ? '1' : '0';
  return out;
}

export function Board({
  circuit,
  registry,
  values,
  selection,
  target,
  probeRow,
  onToggle,
}: BoardProps) {
  const { positions, width, height } = layout(circuit);
  const selectionIndex = new Map(selection.map((id, i) => [id, i + 1]));

  /** The node's value under the probed input combination, if probing. */
  const bitOf = (id: NodeId): number | null => {
    if (probeRow === null) return null;
    const value = values.get(id);
    if (value === undefined) return null;
    return Number((value >> BigInt(probeRow)) & 1n);
  };

  /* Wires are routed as schematic elbows: out of the source, along a shared
     vertical, then into the target pin. Right angles read as a circuit diagram
     in a way that bezier curves do not. */
  const wires: ReactElement[] = [];
  for (const node of circuit.nodes.values()) {
    const to = positions.get(node.id);
    if (!to) continue;

    node.inputs.forEach((sourceId, i) => {
      const from = positions.get(sourceId);
      if (!from) return;

      const x1 = from.x + NODE_W + STUB;
      const y1 = from.y + NODE_H / 2;
      const x2 = to.x - STUB;
      const y2 = to.y + (NODE_H * (i + 1)) / (node.inputs.length + 1);
      const mx = (from.x + NODE_W + to.x) / 2;

      const hot = bitOf(sourceId) === 1;
      wires.push(
        <path
          key={`${sourceId}->${node.id}:${i}`}
          className={`wire${hot ? ' hot' : ''}`}
          d={`M ${x1} ${y1} H ${mx} V ${y2} H ${x2}`}
        />,
      );
    });
  }

  return (
    <div className="board-scroll">
      <svg className="board" width={width} height={height}>
        <g className="wires">{wires}</g>

        {[...circuit.nodes.values()].map((node) => {
          const at = positions.get(node.id);
          if (!at) return null;

          const value = values.get(node.id);
          const bit = bitOf(node.id);
          const order = selectionIndex.get(node.id);

          const classes = ['part', `kind-${node.kind.toLowerCase()}`];
          if (order !== undefined) classes.push('selected');
          if (value !== undefined && value === target) classes.push('matches');
          if (circuit.outputId === node.id) classes.push('output');
          if (bit === 1) classes.push('hot');

          const pinCount = node.inputs.length;

          return (
            <g
              key={node.id}
              className={classes.join(' ')}
              transform={`translate(${at.x} ${at.y})`}
              onClick={() => onToggle(node.id)}
            >
              {/* input pin stubs */}
              {node.inputs.map((sourceId, i) => {
                const y = (NODE_H * (i + 1)) / (pinCount + 1);
                return (
                  <line
                    key={`pin${i}`}
                    className={`pin${bitOf(sourceId) === 1 ? ' hot' : ''}`}
                    x1={-STUB}
                    y1={y}
                    x2={0}
                    y2={y}
                  />
                );
              })}
              {/* output pin stub */}
              <line
                className={`pin${bit === 1 ? ' hot' : ''}`}
                x1={NODE_W}
                y1={NODE_H / 2}
                x2={NODE_W + STUB}
                y2={NODE_H / 2}
              />

              <rect className="body" width={NODE_W} height={NODE_H} rx={3} />

              <text className="part-label" x={NODE_W / 2} y={probeRow === null ? 21 : 27}>
                {labelFor(circuit, registry, node.id)}
              </text>

              {probeRow === null && value !== undefined && (
                <text className="part-bits" x={NODE_W / 2} y={34}>
                  {bitsFor(value, circuit.inputCount)}
                </text>
              )}

              {bit !== null && (
                <text className="part-bit" x={NODE_W - 11} y={16}>
                  {bit}
                </text>
              )}

              {order !== undefined && (
                <>
                  <rect className="order-tag" x={-1} y={-1} width={17} height={15} rx={2} />
                  <text className="order-num" x={7.5} y={10}>
                    {order}
                  </text>
                </>
              )}

              {circuit.outputId === node.id && (
                <text className="out-tag" x={NODE_W / 2} y={NODE_H + 12}>
                  OUT
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}
