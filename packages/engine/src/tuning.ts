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
   * One-off charge for crystallizing a chip, on top of its gate cost.
   *
   * This is what stops spammy micro-merges. With a packaging fee of 1 and a
   * reuse fee of 1, merging a 2-gate pattern used twice costs 2+1+1=4 against
   * 2*2=4 inline — exactly break-even, so tiny merges are pointless and the
   * player has to find real structure. Raising this makes chips a bigger
   * commitment; lowering it to 0 lets players merge everything cheaply.
   */
  packagingFee: 1,

  /**
   * Cost of each chip instance after the first.
   *
   * The main dial on how dramatic the payoff feels. At 1, a 4-gate chip used
   * twice saves 2 — noticeable. Raising it toward the chip's real gate cost
   * makes chips nearly worthless; dropping it to 0 makes big chips explosively
   * strong and pushes the meta toward hunting one giant repeated blob.
   */
  reuseFee: 1,

  /**
   * Largest subcircuit that may become a chip, in nodes.
   *
   * Bounds how much value a single merge can capture. Enforced at merge time
   * (M3), not at scoring time. Without a cap the game degenerates into looking
   * for one enormous repeated structure instead of elegant small ones.
   */
  maxChipNodes: 8,

  /**
   * How many times a pattern must appear before it can be merged.
   *
   * The rule the whole design rests on. Instances must have DIFFERENT input
   * bindings — free wire fan-out already covers reusing the same signal, so
   * chips exist for applying the same function to different signals. Because the
   * top-level solution is bound to the real inputs exactly once, it can never
   * reach this threshold, which is why "merge the whole answer into one chip" is
   * impossible without any whitelist. Raising this to 3 makes chips rare and
   * precious.
   */
  minChipInstances: 2,
} as const;

export type Tuning = typeof TUNING;
