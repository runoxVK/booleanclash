const INPUT_NAMES = 'abcdefgh';

interface TruthTableProps {
  readonly inputCount: number;
  readonly target: bigint;
  /** The signal being compared, if any. */
  readonly actual: bigint | null;
  /** What `actual` refers to, for the column header. */
  readonly actualLabel: string;
  /** Row currently being probed on the board. */
  readonly probeRow: number | null;
  readonly onProbe: (row: number | null) => void;
}

/**
 * Target versus current, row by row.
 *
 * Two jobs. First, the row-by-row diff is the main feedback channel: it says not
 * just that you are wrong but exactly which input combinations are wrong, which
 * is what makes the next move findable. Second, clicking a row probes it — the
 * board then shows real signal values for that combination instead of whole
 * truth tables, so you can watch one case flow through the circuit.
 */
export function TruthTable({
  inputCount,
  target,
  actual,
  actualLabel,
  probeRow,
  onProbe,
}: TruthTableProps) {
  const rows = 1 << inputCount;
  const names: string[] = [];
  for (let p = inputCount - 1; p >= 0; p--) names.push(INPUT_NAMES[p]);

  return (
    <table className="truth">
      <thead>
        <tr>
          {names.map((n) => (
            <th key={n} className="in">
              {n}
            </th>
          ))}
          <th className="want">want</th>
          <th className="got">{actualLabel}</th>
        </tr>
      </thead>
      <tbody>
        {Array.from({ length: rows }, (_, r) => {
          const want = (target >> BigInt(r)) & 1n;
          const got = actual === null ? null : (actual >> BigInt(r)) & 1n;

          const classes = [
            got === null ? 'blank' : got === want ? 'hit' : 'miss',
          ];
          if (probeRow === r) classes.push('probed');

          return (
            <tr
              key={r}
              className={classes.join(' ')}
              onClick={() => onProbe(probeRow === r ? null : r)}
            >
              {names.map((n, i) => (
                <td key={n} className="in">
                  {(r >> (inputCount - 1 - i)) & 1}
                </td>
              ))}
              <td className="want">{String(want)}</td>
              <td className="got">{got === null ? '·' : String(got)}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
