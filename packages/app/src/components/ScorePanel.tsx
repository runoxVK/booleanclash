import type { ScoreBreakdown } from '@logiclash/engine';

interface ScorePanelProps {
  readonly breakdown: ScoreBreakdown;
  readonly par: number;
  readonly solved: boolean;
  /** Best score recorded for this puzzle, if it has been solved before. */
  readonly best?: number;
}

/**
 * The itemized score.
 *
 * Showing the arithmetic rather than a bare number is deliberate: the score is
 * what players optimize and argue about, so every point has to be traceable to
 * something on the board.
 */
export function ScorePanel({ breakdown, par, solved, best }: ScorePanelProps) {
  const verdict = !solved
    ? null
    : breakdown.total < par
      ? { text: `Under par by ${par - breakdown.total}`, tone: 'great' }
      : breakdown.total === par
        ? { text: 'Par', tone: 'good' }
        : { text: `${breakdown.total - par} over par`, tone: 'okay' };

  return (
    <div className="panel">
      <h2>
        Score <span className="score-total">{breakdown.total}</span>
      </h2>

      <div className="ledger">
        {breakdown.primitiveCount > 0 && (
          <div className="ledger-row">
            <span>gates &times;{breakdown.primitiveCount}</span>
            <span>{breakdown.primitiveCost}</span>
          </div>
        )}

        {breakdown.chips.map((chip) => (
          <div key={chip.chipId} className="ledger-row chip-row">
            <span>
              {chip.name} &times;{chip.instances}
              <em>
                {chip.definitionCost} + {chip.packagingFee} pkg
                {chip.reuseFees > 0 ? ` + ${chip.reuseFees} reuse` : ''}
              </em>
            </span>
            <span>
              {chip.subtotal}
              {chip.saved !== 0 && (
                <em className={chip.wasteful ? 'bad' : 'good'}>
                  {chip.wasteful ? `${chip.saved}` : `saved ${chip.saved}`}
                </em>
              )}
            </span>
          </div>
        ))}

        {breakdown.deadGateCount > 0 && (
          <div className="ledger-row muted">
            <span>unused &times;{breakdown.deadGateCount}</span>
            <span>0</span>
          </div>
        )}

        {breakdown.total === 0 && (
          <div className="ledger-row muted">
            <span>nothing wired to the output yet</span>
            <span />
          </div>
        )}
      </div>

      <div className="par">
        par <strong>{par}</strong>
        {best !== undefined && <span className="best">best {best}</span>}
        {verdict && <span className={`verdict ${verdict.tone}`}>{verdict.text}</span>}
      </div>
    </div>
  );
}
