import { useEffect, useRef, useState, type ReactElement } from 'react';
import type { ChipRegistry, Circuit, NodeId } from '@logiclash/engine';
import { layout, NODE_H, NODE_W } from '../layout';

const INPUT_NAMES = 'abcdefgh';
const PIN_R = 9;
const PIN_LABELS = ['a', 'b', 'c', 'd'];

interface BoardProps {
  readonly circuit: Circuit;
  readonly registry: ChipRegistry;
  readonly values: ReadonlyMap<NodeId, bigint>;
  readonly selection: readonly NodeId[];
  readonly target: bigint;
  /** Which row of the truth table the switches are currently set to. */
  readonly probeRow: number;
  readonly onToggle: (id: NodeId) => void;
  readonly onFlipInput: (index: number) => void;
}

function labelFor(circuit: Circuit, registry: ChipRegistry, id: NodeId): string {
  const node = circuit.nodes.get(id);
  if (!node) return '?';
  if (node.kind === 'INPUT') return INPUT_NAMES[node.inputIndex ?? 0] ?? '?';
  if (node.kind === 'CHIP') {
    return node.chipId ? registry.get(node.chipId)?.name ?? 'chip' : 'chip';
  }
  return node.kind.toLowerCase();
}

function bitsFor(value: bigint, inputCount: number): string {
  const rows = 1 << inputCount;
  let out = '';
  for (let r = 0; r < rows; r++) out += (value >> BigInt(r)) & 1n ? '1' : '0';
  return out;
}

/** Where a part's output pin sits. */
function outPin(at: { x: number; y: number }) {
  return { x: at.x + NODE_W / 2, y: at.y };
}

/** Where a part's i-th input pin sits along its bottom edge. */
function inPin(at: { x: number; y: number }, i: number, count: number) {
  return { x: at.x + (NODE_W * (i + 1)) / (count + 1), y: at.y + NODE_H };
}

export function Board({
  circuit,
  registry,
  values,
  selection,
  target,
  probeRow,
  onToggle,
  onFlipInput,
}: BoardProps) {
  const selectionIndex = new Map(selection.map((id, i) => [id, i + 1]));

  /* The work area should fill its pane rather than sitting as a small box in a
     large empty one. Measure the pane, scale a small circuit up a little to suit
     it, and centre the result; oversized circuits keep their size and scroll. */
  const pane = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });

  useEffect(() => {
    const el = pane.current;
    if (!el) return;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  /* Zoom has to respect BOTH dimensions. Sizing on width alone blows a
     multi-layer circuit up until it overflows the bottom of the pane. */
  const natural = layout(circuit);
  const scale =
    box.w > 0 && box.h > 0
      ? Math.max(
          0.5,
          Math.min(1.6, box.w / natural.width, box.h / natural.height),
        )
      : 1;

  const { positions, width, height } = layout(
    circuit,
    box.h > 0 ? box.h / scale : 0,
  );

  const canvasW = Math.max(box.w, width * scale);
  const canvasH = Math.max(box.h, height * scale);
  const offsetX = (canvasW - width * scale) / 2;

  const bitOf = (id: NodeId): number | null => {
    const value = values.get(id);
    if (value === undefined) return null;
    return Number((value >> BigInt(probeRow)) & 1n);
  };

  /* Wires run upward: out of the source's top pin, across a shared horizontal,
     then up into the target's bottom pin. Right angles read as a diagram. */
  const wires: ReactElement[] = [];
  for (const node of circuit.nodes.values()) {
    const to = positions.get(node.id);
    if (!to) continue;

    node.inputs.forEach((sourceId, i) => {
      const from = positions.get(sourceId);
      if (!from) return;

      const a = outPin(from);
      const b = inPin(to, i, node.inputs.length);
      const my = (a.y + b.y) / 2;

      wires.push(
        <path
          key={`${sourceId}->${node.id}:${i}`}
          className={`wire${bitOf(sourceId) === 1 ? ' hot' : ''}`}
          d={`M ${a.x} ${a.y} V ${my} H ${b.x} V ${b.y}`}
        />,
      );
    });
  }

  /* The output terminal is a fixed dock on the ceiling. */
  const outX = width / 2;
  const outY = 26;
  const outBit =
    circuit.outputId !== null ? bitOf(circuit.outputId) : null;
  const outSource =
    circuit.outputId !== null ? positions.get(circuit.outputId) : undefined;

  return (
    <div className="board-scroll" ref={pane}>
      <svg className="board" width={canvasW} height={canvasH}>
        <rect className="canvas" x={0} y={0} width={canvasW} height={canvasH} />

        <g transform={`translate(${offsetX} 0) scale(${scale})`}>
        {outSource && (
          <path
            className={`wire${outBit === 1 ? ' hot' : ''}`}
            d={`M ${outPin(outSource).x} ${outPin(outSource).y} V ${(outPin(outSource).y + outY + 22) / 2} H ${outX} V ${outY + 22}`}
          />
        )}

        <g className="wires">{wires}</g>

        {/* Output terminal */}
        <g className={`terminal out${outBit === 1 ? ' hot' : ''}`}>
          <rect className="value-box" x={outX - 15} y={outY - 16} width={30} height={26} rx={4} />
          <text className="value" x={outX} y={outY + 3}>
            {outBit === null ? '·' : outBit}
          </text>
          <circle className="pin" cx={outX} cy={outY + 22} r={PIN_R} />
          <path className="arrow" d={`M ${outX - 8} ${outY + 34} L ${outX + 8} ${outY + 34} L ${outX} ${outY + 46} Z`} />
        </g>
        <text className="dock-label" x={10} y={outY + 4} textAnchor="start">
          Output
        </text>

        {[...circuit.nodes.values()].map((node) => {
          const at = positions.get(node.id);
          if (!at) return null;

          const value = values.get(node.id);
          const bit = bitOf(node.id);
          const order = selectionIndex.get(node.id);
          const isInput = node.kind === 'INPUT';

          const classes = ['part', `kind-${node.kind.toLowerCase()}`];
          if (order !== undefined) classes.push('selected');
          if (value !== undefined && value === target) classes.push('matches');
          if (circuit.outputId === node.id) classes.push('is-output');
          if (bit === 1) classes.push('hot');

          const pinCount = node.inputs.length;

          return (
            <g key={node.id} className={classes.join(' ')} transform={`translate(${at.x} ${at.y})`}>
              <title>
                {value === undefined
                  ? labelFor(circuit, registry, node.id)
                  : `${labelFor(circuit, registry, node.id)}  ${bitsFor(value, circuit.inputCount)}`}
              </title>

              <rect
                className="body"
                width={NODE_W}
                height={NODE_H}
                rx={9}
                onClick={() => onToggle(node.id)}
              />

              <text className="part-label" x={NODE_W / 2} y={NODE_H / 2 + 5} onClick={() => onToggle(node.id)}>
                {labelFor(circuit, registry, node.id)}
              </text>

              {/* input pins along the bottom edge */}
              {node.inputs.map((sourceId, i) => {
                const p = inPin({ x: 0, y: 0 }, i, pinCount);
                return (
                  <g key={`pin${i}`} className={bitOf(sourceId) === 1 ? 'pin-group hot' : 'pin-group'}>
                    <circle className="pin" cx={p.x} cy={p.y} r={PIN_R} />
                    {pinCount > 1 && (
                      <text className="pin-label" x={p.x} y={p.y + 3.5}>
                        {PIN_LABELS[i]}
                      </text>
                    )}
                  </g>
                );
              })}

              {/* output pin on the top edge, carrying the live value */}
              <g className={bit === 1 ? 'pin-group hot' : 'pin-group'}>
                <circle className="pin" cx={NODE_W / 2} cy={0} r={PIN_R} />
                {bit !== null && (
                  <text className="pin-value" x={NODE_W / 2} y={3.5}>
                    {bit}
                  </text>
                )}
              </g>

              {/* switches let you drive the circuit by hand */}
              {isInput && (
                <g
                  className={`switch${bit === 1 ? ' on' : ''}`}
                  onClick={() => onFlipInput(node.inputIndex ?? 0)}
                >
                  <rect className="track" x={NODE_W / 2 - 20} y={NODE_H + 10} width={40} height={18} rx={9} />
                  <circle className="knob" cx={NODE_W / 2 + (bit === 1 ? 11 : -11)} cy={NODE_H + 19} r={7} />
                </g>
              )}

              {/* Square, because round numbered badges would read as pins —
                  and a pin's number is a signal value, not a selection order. */}
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

        <text className="dock-label" x={10} y={height - 18} textAnchor="start">
          Input
        </text>
        </g>
      </svg>
    </div>
  );
}
