/**
 * Every balance number in the game, in one place.
 *
 * These are the dials for M6 playtesting. Nothing else in the engine should
 * hardcode a cost — if you find a magic number elsewhere, it belongs here.
 *
 * Keep every cost an INTEGER. Scores are the thing players compare, argue about,
 * and post on leaderboards; "7.5 chips" is a worse experience than any balance
 * gain it could buy.
 */

export const TUNING = {
  /**
   * Cost of each primitive gate.
   *
   * All 1 for now, which makes the score a plain gate count — easy to read and
   * easy to reason about. Real hardware is lopsided (an inverter is far cheaper
   * than a 2-input gate), so making NOT cheaper is the obvious first experiment:
   * it would reward De Morgan manipulation and push players toward
   * inversion-heavy solutions. Try {NOT: 1, AND: 2, OR: 2} to see that meta.
   */
  gateCost: {
    NOT: 1,
    AND: 1,
    OR: 1,
  },

  /**
   * What one placed chip counts for, however many parts went into it.
   *
   * This is the whole economy: the score is a count of units on the board, and
   * packaging a recognised component turns several units into one. Raising it
   * above 1 would make chips a trade-off rather than a straight win; at 1 the
   * only question is whether you can SPOT the component, which is the intended
   * skill.
   */
  chipCost: 1,

  /**
   * Largest subcircuit that may become a chip, in nodes.
   *
   * Bounds how much value a single merge can capture. Enforced at merge time
   * (M3), not at scoring time. Without a cap the game degenerates into looking
   * for one enormous repeated structure instead of elegant small ones.
   */
  maxChipNodes: 8,

  /**
   * Most parameters (input pins) a chip may have.
   *
   * This is a legibility constraint as much as a balance one: a chip with nine
   * pins is unusable on a board, and an 8-node tree of ANDs would produce
   * exactly that. Real useful chips are small — XOR is 2, MUX and full-adder
   * are 3. Raising this past 5 mostly buys wide gates that flatten the puzzle.
   */
  maxChipArity: 4,

  /**
   * Two-player duel settings.
   *
   * `partBudget` is what stops a duel stalling forever. Both players want the
   * circuit finished but only whoever completes it scores, so each will burn
   * moves on waiting gates to make the finishing move land on their own turn.
   * Charging those to a shared pool means stalling has a cost and eventually
   * forces the issue. Packaging returns parts to the pool, which is what makes
   * recognising a component a tempo weapon rather than only an economy.
   *
   * `plyLimit` is the backstop: rewiring does not consume the budget, so
   * without it two stubborn players could shuffle wires indefinitely.
   */
  duel: {
    partBudget: 14,
    plyLimit: 40,
  },

} as const;

export type Tuning = typeof TUNING;
