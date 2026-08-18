import { describe, expect, it } from 'vitest';
import { decide, msLeft } from '../src/race.js';

/** A race row carrying only the fields a verdict depends on. */
function race(over: Record<string, unknown>) {
  return {
    id: 'r',
    player0: 'a',
    player1: 'b',
    input_count: 4,
    target: '0x6ff6',
    par: 7,
    time_limit_ms: 60_000,
    started_at: Date.now(),
    circuit0: null,
    score0: null,
    solved0_at: null,
    close0: 0,
    circuit1: null,
    score1: null,
    solved1_at: null,
    close1: 0,
    result: null,
    created_at: 0,
    updated_at: 0,
    ...over,
  } as Parameters<typeof decide>[0];
}

const EXPIRED = { started_at: Date.now() - 120_000 };

describe('while the clock runs', () => {
  it('stays undecided when only one has solved', () => {
    // The other may still solve it in fewer parts, so it is not over yet.
    expect(decide(race({ solved0_at: 1, score0: 7 }))).toBeNull();
  });

  it('stays undecided when neither has solved', () => {
    expect(decide(race({ close0: 12, close1: 9 }))).toBeNull();
  });

  it('decides the moment both have solved', () => {
    expect(decide(race({ solved0_at: 1, score0: 9, solved1_at: 2, score1: 6 }))).toEqual(
      { kind: 'win', winner: 1, reason: 'fewer-parts' },
    );
  });
});

describe('fewest parts wins', () => {
  it('goes to the smaller circuit even if it arrived later', () => {
    expect(
      decide(race({ solved0_at: 100, score0: 5, solved1_at: 1, score1: 8 })),
    ).toEqual({ kind: 'win', winner: 0, reason: 'fewer-parts' });
  });

  it('falls back to who got there first on equal scores', () => {
    expect(
      decide(race({ solved0_at: 50, score0: 7, solved1_at: 20, score1: 7 })),
    ).toEqual({ kind: 'win', winner: 1, reason: 'faster' });
  });

  it('is a draw on the same score at the same instant', () => {
    expect(
      decide(race({ solved0_at: 20, score0: 7, solved1_at: 20, score1: 7 })),
    ).toEqual({ kind: 'draw', reason: 'identical' });
  });
});

describe('when the clock runs out', () => {
  it('goes to the only solver', () => {
    expect(decide(race({ ...EXPIRED, solved0_at: 5, score0: 9 }))).toEqual({
      kind: 'win',
      winner: 0,
      reason: 'only-solver',
    });
  });

  it('goes to whoever matched more rows when nobody solved', () => {
    expect(decide(race({ ...EXPIRED, close0: 11, close1: 14 }))).toEqual({
      kind: 'win',
      winner: 1,
      reason: 'closer',
    });
  });

  it('is a draw when nobody solved and both got equally close', () => {
    expect(decide(race({ ...EXPIRED, close0: 13, close1: 13 }))).toEqual({
      kind: 'draw',
      reason: 'neither-solved',
    });
  });
});

describe('msLeft', () => {
  it('counts down and never goes negative', () => {
    expect(msLeft(race({ started_at: Date.now() }))).toBeGreaterThan(58_000);
    expect(msLeft(race(EXPIRED))).toBe(0);
  });
});
