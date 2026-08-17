import type { ChipDefinition } from '@logiclash/engine';

const PIN_LABELS = ['a', 'b', 'c', 'd'];

interface PartCardProps {
  readonly name: string;
  readonly arity: number;
  readonly isChip?: boolean;
  readonly hint: string;
  readonly onClick: () => void;
}

/**
 * A component in the toolbox, drawn as the thing it will become. Showing the
 * actual shape — pins and all — means the palette and the board speak the same
 * visual language, so you learn one vocabulary instead of two.
 */
function PartCard({ name, arity, isChip, hint, onClick }: PartCardProps) {
  const W = 76;
  const H = 38;
  const ox = 12;
  const oy = 13;

  return (
    <button
      className={`part-card${isChip ? ' chip' : ''}`}
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
  readonly onPlaceGate: (kind: 'NOT' | 'AND' | 'OR') => void;
  readonly onPlaceChip: (chipId: string) => void;
  readonly onTrash: () => void;
}

export function Toolbox({
  chips,
  onPlaceGate,
  onPlaceChip,
  onTrash,
}: ToolboxProps) {
  return (
    <div className="toolbox">
      <h2>Toolbox</h2>

      <div className="parts">
        <PartCard
          name="not"
          arity={1}
          hint="Inverts one signal. Select 1 signal, then click. (N)"
          onClick={() => onPlaceGate('NOT')}
        />
        <PartCard
          name="and"
          arity={2}
          hint="On when both inputs are on. Select 2 signals, then click. (A)"
          onClick={() => onPlaceGate('AND')}
        />
        <PartCard
          name="or"
          arity={2}
          hint="On when either input is on. Select 2 signals, then click. (O)"
          onClick={() => onPlaceGate('OR')}
        />

        {chips.length > 0 && <div className="divider">Discovered</div>}
        {chips.map((chip) => (
          <PartCard
            key={chip.id}
            name={chip.name}
            arity={chip.arity}
            isChip
            hint={`Your ${chip.name} chip — ${chip.gateCost} gates inside, costs 1 to reuse.`}
            onClick={() => onPlaceChip(chip.id)}
          />
        ))}
      </div>

      <button className="trash" onClick={onTrash} title="Delete selection (Del)">
        <svg width={26} height={26} viewBox="0 0 24 24">
          <path d="M4 6h16M9 6V4h6v2M6 6l1 15h10l1-15M10 10v8M14 10v8" />
        </svg>
      </button>
    </div>
  );
}
