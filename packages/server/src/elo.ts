/**
 * Standard Elo.
 *
 * K of 32 is the usual choice for a small, active pool: ratings move fast
 * enough to find their level within a handful of games, which matters far more
 * than precision when there are barely any games to learn from.
 */
export const START_RATING = 1200;
const K = 32;

export function expectedScore(rating: number, against: number): number {
  return 1 / (1 + 10 ** ((against - rating) / 400));
}

/** New ratings after a game. `score` is 1 win, 0.5 draw, 0 loss, for player A. */
export function updateRatings(
  ratingA: number,
  ratingB: number,
  score: number,
): { a: number; b: number } {
  const expectedA = expectedScore(ratingA, ratingB);
  return {
    a: Math.round(ratingA + K * (score - expectedA)),
    b: Math.round(ratingB + K * (1 - score - (1 - expectedA))),
  };
}
