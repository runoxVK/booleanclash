import type { ReactElement } from 'react';
import type { ChipRegistry, Circuit, NodeId } from '@logiclash/engine';
import { layout, NODE_H, NODE_W } from '../layout';

const INPUT_NAMES = 'abcdefgh';

interface BoardProps {
  readonly circuit: Circuit;
  readonly registry: ChipRegistry;
  readonly values: ReadonlyMap<NodeId, bigint>;
  readonly selection: readonly NodeId[];
  readonly target: bigint;
  readonly onToggle: (id: NodeId) => void;
}

function labelFor(
  circuit: Circuit,
  registry: ChipRegistry,
  id: NodeId,
): string {
  const node = circuit.nodes.get(id);
  if (!node) return '?';
  if (node.kind === 'INPUT') return INPUT_NAMES[node.inputIndex ?? 0] ?? '?';
  if (node.kind === 'CHIP') {
    return node.chipId ? registry.get(node.chipId)?.name ?? 'CHIP' : 'CHIP';
  }
  return node.kind;
}

export function Board({
  circuit,
  registry,
  values,
  selection,
  target,
  onToggle,
}: BoardProps) {
  const { positions, width, height } = layout(circuit);
  const selectionIndex = new Map(selection.map((id, i) => [id, i + 1]));

  const edges: ReactElement[] = [];
  for (const node of circuit.nodes.values()) {
    const to = positions.get(node.id);
    if (!to) continue;
    node.inputs.forEach((sourceId, i) => {
      const from = positions.get(sourceId);
      if (!from) return;

      const x1 = from.x + NODE_W;
      const y1 = from.y + NODE_H / 2;
      const x2 = to.x;
      const y2 = to.y + (NODE_H * (i + 1)) / (node.inputs.length + 1);
      const mid = (x1 + x2) / 2;

      edges.push(
        <path
          key={`${sourceId}->${node.id}:${i}`}
          className="wire"
          d={`M ${x1} ${y1} C ${mid} ${y1}, ${mid} ${y2}, ${x2} ${y2}`}
        />,
      );
    });
  }

  return (
    <div className="board-scroll">
      <svg className="board" width={width} height={height}>
        <g>{edges}</g>
        {[...circuit.nodes.values()].map((node) => {
          const at = positions.get(node.id);
          if (!at) return null;

          const value = values.get(node.id);
          const isSolved = value !== undefined && value === target;
          const order = selectionIndex.get(node.id);

          const classes = ['node', `kind-${node.kind.toLowerCase()}`];
          if (order !== undefined) classes.push('selected');
          if (isSolved) classes.push('matches');
          if (circuit.outputId === node.id) classes.push('output');

          return (
            <g
              key={node.id}
              className={classes.join(' ')}
              transform={`translate(${at.x} ${at.y})`}
              onClick={() => onToggle(node.id)}
            >
              <rect width={NODE_W} height={NODE_H} rx={8} />
              <text className="node-label" x={NODE_W / 2} y={20}>
                {labelFor(circuit, registry, node.id)}
              </text>
              {value !== undefined && (
                <text className="node-bits" x={NODE_W / 2} y={35}>
                  {bitsFor(value, circuit.inputCount)}
                </text>
              )}
              {order !== undefined && (
                <>
                  <circle className="order-dot" cx={10} cy={10} r={9} />
                  <text className="order-num" x={10} y={14}>
                    {order}
                  </text>
                </>
              )}
              {isSolved && (
                <text className="match-tick" x={NODE_W - 9} y={15}>
                  ✓
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

function bitsFor(value: bigint, inputCount: number): string {
  const rows = 1 << inputCount;
  let out = '';
  for (let r = 0; r < rows; r++) out += (value >> BigInt(r)) & 1n ? '1' : '0';
  return out;
}
