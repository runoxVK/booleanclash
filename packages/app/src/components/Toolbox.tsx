import type { ChipDefinition } from '@logiclash/engine';
import type { Tool } from '../game';

const PIN_LABELS = ['a', 'b', 'c', 'd'];

interface PartCardProps {
  readonly name: string;
  readonly arity: number;
  readonly isChip?: boolean;
  readonly armed: boolean;
  readonly hint: string;
  readonly onClick: () => void;
}

/**
 * A part in the toolbox, drawn as the thing it will become, so the palette and
 * the board speak one visual language.
 *
 * Clicking arms it rather than placing it: the board decides where it lands.
 * The card stays armed after a drop so a run of the same gate is one click each.
 */
function PartCard({
  name,
  arity,
  isChip,
  armed,
  hint,
  onClick,
}: PartCardProps) {
  const W = 76;
  const H = 38;
  const ox = 12;
  const oy = 13;

  return (
    <button
      className={`part-card${isChip ? ' chip' : ''}${armed ? ' armed' : ''}`}
      onClick={onClick}
      title={hint}
    >
      <svg width={100} height={64}>
        <g className="card-part">
          <circle className="pin" cx={ox + W / 2} cy={oy} r={8} />
          <rect className="body" x={ox} y={oy} width={W} height={H} rx={8} />
          <text className="name" x={ox + W / 2} y={oy + H / 2 + 5}>
            {name}
          </text>
          {Array.from({ length: arity }, (_, i) => {
            const x = ox + (W * (i + 1)) / (arity + 1);
            return (
              <g key={i}>
                <circle className="pin" cx={x} cy={oy + H} r={8} />
                {arity > 1 && (
                  <text className="pin-label" x={x} y={oy + H + 3.5}>
                    {PIN_LABELS[i]}
                  </text>
                )}
              </g>
            );
          })}
        </g>
      </svg>
    </button>
  );
}

interface ToolboxProps {
  readonly chips: readonly ChipDefinition[];
  readonly armed: Tool | null;
  readonly onArm: (tool: Tool | null) => void;
  readonly onTrash: () => void;
}

export function Toolbox({ chips, armed, onArm, onTrash }: ToolboxProps) {
  const armedGate = armed?.kind === 'gate' ? armed.gate : null;
  const armedChip = armed?.kind === 'chip' ? armed.chipId : null;

  const gate = (gateKind: 'NOT' | 'AND' | 'OR') => () =>
    onArm(armedGate === gateKind ? null : { kind: 'gate', gate: gateKind });

  return (
    <div className="toolbox">
      <h2>Toolbox</h2>
      <p className="toolbox-note">
        {armed
          ? 'Click a free cell to drop it.'
          : 'Pick a part, then click a cell.'}
      </p>

      <div className="parts">
        <PartCard
          name="not"
          arity={1}
          armed={armedGate === 'NOT'}
          hint="Inverts one signal. (N)"
          onClick={gate('NOT')}
        />
        <PartCard
          name="and"
          arity={2}
          armed={armedGate === 'AND'}
          hint="On when both inputs are on. (A)"
          onClick={gate('AND')}
        />
        <PartCard
          name="or"
          arity={2}
          armed={armedGate === 'OR'}
          hint="On when either input is on. (O)"
          onClick={gate('OR')}
        />

        {chips.length > 0 && <div className="divider">Discovered</div>}
        {chips.map((chip) => (
          <PartCard
            key={chip.id}
            name={chip.name}
            arity={chip.arity}
            isChip
            armed={armedChip === chip.id}
            hint={`${chip.gateCost} gates inside, but costs 1 to place again.`}
            onClick={() =>
              onArm(
                armedChip === chip.id ? null : { kind: 'chip', chipId: chip.id },
              )
            }
          />
        ))}
      </div>

      <button className="trash" onClick={onTrash} title="Remove selection (Del)">
        <svg width={26} height={26} viewBox="0 0 24 24">
          <path d="M4 6h16M9 6V4h6v2M6 6l1 15h10l1-15M10 10v8M14 10v8" />
        </svg>
      </button>
    </div>
  );
}
