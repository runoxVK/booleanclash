import type { ChipDefinition } from '@logiclash/engine';

const PIN_LABELS = ['a', 'b', 'c', 'd'];

interface PartCardProps {
  readonly name: string;
  readonly arity: number;
  readonly isChip?: boolean;
  /** How many parts are selected right now. */
  readonly selected: number;
  readonly hint: string;
  readonly onClick: () => void;
}

/**
 * A component in the toolbox, drawn as the thing it will become.
 *
 * The card also answers "can I use this right now?" without being clicked. A
 * gate needs exactly as many selected signals as it has pins, and that rule is
 * invisible until you break it — so the card states its requirement, greys out
 * when the selection does not fit, and lights up when it does.
 */
function PartCard({
  name,
  arity,
  isChip,
  selected,
  hint,
  onClick,
}: PartCardProps) {
  const W = 76;
  const H = 38;
  const ox = 12;
  const oy = 13;

  const ready = selected === arity;
  const classes = ['part-card'];
  if (isChip) classes.push('chip');
  /* Only dim once there IS a selection that does not fit. Dimming everything
     when nothing is selected makes the whole toolbox look broken on arrival,
     which is the first thing anybody sees. */
  if (ready) classes.push('ready');
  else if (selected > 0) classes.push('waiting');

  return (
    <button className={classes.join(' ')} onClick={onClick} title={hint}>
      <svg width={100} height={58}>
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
      <span className="needs">
        {ready ? 'ready' : `needs ${arity}`}
      </span>
    </button>
  );
}

interface ToolboxProps {
  readonly chips: readonly ChipDefinition[];
  readonly selected: number;
  readonly onPlaceGate: (kind: 'NOT' | 'AND' | 'OR') => void;
  readonly onPlaceChip: (chipId: string) => void;
  readonly onTrash: () => void;
}

export function Toolbox({
  chips,
  selected,
  onPlaceGate,
  onPlaceChip,
  onTrash,
}: ToolboxProps) {
  return (
    <div className="toolbox">
      <h2>Toolbox</h2>
      <p className="toolbox-note">
        {selected === 0
          ? 'Select parts on the board first'
          : `${selected} selected`}
      </p>

      <div className="parts">
        <PartCard
          name="not"
          arity={1}
          selected={selected}
          hint="Inverts one signal. Select 1 part, then click. (N)"
          onClick={() => onPlaceGate('NOT')}
        />
        <PartCard
          name="and"
          arity={2}
          selected={selected}
          hint="On when both inputs are on. Select 2 parts, then click. (A)"
          onClick={() => onPlaceGate('AND')}
        />
        <PartCard
          name="or"
          arity={2}
          selected={selected}
          hint="On when either input is on. Select 2 parts, then click. (O)"
          onClick={() => onPlaceGate('OR')}
        />

        {chips.length > 0 && <div className="divider">Discovered</div>}
        {chips.map((chip) => (
          <PartCard
            key={chip.id}
            name={chip.name}
            arity={chip.arity}
            isChip
            selected={selected}
            hint={`Your ${chip.name} chip — ${chip.gateCost} gates inside, but only 1 to place again.`}
            onClick={() => onPlaceChip(chip.id)}
          />
        ))}
      </div>

      <button className="trash" onClick={onTrash} title="Delete selection (Del)">
        <svg width={24} height={24} viewBox="0 0 24 24">
          <path d="M4 6h16M9 6V4h6v2M6 6l1 15h10l1-15M10 10v8M14 10v8" />
        </svg>
      </button>
    </div>
  );
}
