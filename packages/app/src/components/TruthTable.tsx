const INPUT_NAMES = 'abcdefgh';

interface TruthTableProps {
  readonly inputCount: number;
  readonly target: bigint;
  /** The signal being compared, if any. */
  readonly actual: bigint | null;
  /** What `actual` refers to, for the column header. */
  readonly actualLabel: string;
}

/**
 * Target versus current, row by row.
 *
 * The row-by-row diff is the game's main feedback channel: it tells the player
 * not just that they are wrong but exactly which input combinations are wrong,
 * which is what makes the next move findable.
 */
export function TruthTable({
  inputCount,
  target,
  actual,
  actualLabel,
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
          const state =
            got === null ? 'blank' : got === want ? 'hit' : 'miss';

          return (
            <tr key={r} className={state}>
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
