# Logiclash

Build a target logic function from NOT/AND/OR using the fewest chips.

## Commands

First time, or after pulling:

```bash
npm install
```

Everything CI runs — typecheck plus tests. This is the one to use before pushing:

```bash
npm run check
```

Re-runs the affected tests every time you save. Leave it open while working:

```bash
npm run test:watch
```

Runs `scripts/play.ts`, a scratch pad for poking at the engine by hand. Edit it
freely — it is not tested and not shipped:

```bash
npm run play
```

CI runs `npm run check` on every push and pull request
(`.github/workflows/ci.yml`).

## Layout

```
packages/engine/   All game rules. Zero dependencies. No rendering.
packages/app/      Vite + React + hand-rolled SVG board. Owns no rules.
scripts/play.ts    Dev scratch pad.
```

**The one architectural rule:** every game rule lives in `engine`, which knows
nothing about pixels. `engine` runs unchanged in the browser (instant feedback)
and later on the server (scoring authority + anti-cheat). If a rule ever exists
in two places, the anti-cheat story is dead. No exceptions.

This is enforced by the compiler, not by good intentions:
`packages/engine/tsconfig.json` sets `"types": []`, which strips `@types/node`
from that project. Reaching for `process`, `Buffer`, or `fs` inside the engine is
a compile error, because the engine has to run in a browser too. Dev scripts get
Node globals; the engine does not.

## Truth table conventions

A signal's behaviour over *every* input combination is a single `bigint`. This is
the trick the engine rests on — evaluating a gate against all combinations at
once is one bitwise op.

- Row index `r` encodes the inputs: bit `p` of `r` is the value of input `p`.
  Row 0 is "all inputs 0".
- Input 0 is `a`, input 1 is `b`, and so on.
- A truth table's bit `r` is the output for row `r`.
- Puzzle target strings are **row-ordered**: character `i` is the output for row
  `i`. This is the reverse of reading a binary literal, and it is deliberate —
  it matches how a player reads a printed truth table top to bottom.

With 4 inputs the columns are memorable constants:

| input | column |
|---|---|
| `a` | `0xAAAA` |
| `b` | `0xCCCC` |
| `c` | `0xF0F0` |
| `d` | `0xFF00` |

## The economy

Two kinds of reuse, and keeping them distinct is what stops the game collapsing:

- **Wire fan-out** reuses the same *signal*. Free.
- **A chip** reuses the same *function* on *different* signals. Costs.

A subcircuit may be merged into a chip only if it appears **≥2 times with
different input bindings**. The final top-level solution is bound to the actual
inputs exactly once, so it can never qualify — "merge everything into one chip"
is impossible by construction, with no whitelist needed.

Costs: define = expanded gate count + 1 packaging fee; each later instance = 1;
chip size cap ~8 nodes. All four numbers live in
[`tuning.ts`](packages/engine/src/tuning.ts) and are the M6 dials — nothing else
in the engine hardcodes a cost.

Two properties worth not breaking, both locked in by tests in
`test/cost.test.ts`:

- A 2-gate chip used twice **breaks even**, so micro-merges are pointless and
  players must find real structure. The cliff sits at 3 gates.
- Faking a second instance at the same binding to earn a merge **loses points**,
  independently of M3 rejecting it at merge time.

## Merging

`proposeMerge(circuit, selection, registry)` returns either a candidate or a
typed rejection. The UI should surface `detail` verbatim when the merge button is
dark — that explanation is most of how players learn the rule.

| Rejection | Meaning |
|---|---|
| `empty-selection` | Nothing selected. |
| `unknown-node` | Selection references a node not on the board. |
| `contains-input` | Circuit inputs are pins, not gates. |
| `contains-chip` | No nesting yet — the deferred "tiered chips" feature. |
| `too-many-nodes` | Over `maxChipNodes`. |
| `too-many-params` | Over `maxChipArity`. |
| `multiple-outputs` | A chip needs exactly one output. |
| `internal-fanout` | Something inside the selection feeds the outside, so it cannot be swapped for one chip. |
| `not-enough-instances` | The shape does not appear often enough at *different* bindings. Carries `instances`. |

Parameter numbering comes from a deterministic traversal, so identical shapes
always produce the same pattern key. An external signal met twice maps to the
same parameter, which makes `AND(x, x)` an arity-1 pattern rather than arity-2.

Codex lookups are canonical under parameter permutation, so a pin-shuffled MUX is
still recognized as a MUX. That is for *naming* only — chip identity stays exact,
because pin order matters when wiring.

Chip identity is **behavioural, not structural** — same arity + same truth table
means same chip, however it was wired. That is what powers "you discovered XOR"
and prevents hoarding variants.

## Roadmap

| | |
|---|---|
| M0 | Scaffold — **done** |
| M1 | Truth tables + circuit model + evaluation — **done** |
| M2 | `cost.ts` — scoring with itemized breakdown — **done** |
| M3 | `merge.ts` + `codex.ts` — pattern matching, binding check, chip creation — **done** |
| M5 | `packages/app` — playable UI, hand-authored puzzles — **done** |
| M4 | `generate.ts` — puzzle curation, filtered for paradigm diversity |
| M6 | Playtest and tune the four constants |

M4 and M5 are swapped deliberately: the merge economy cannot be judged from a
test suite, so the UI came first. `packages/app/src/puzzles.ts` holds four
hand-authored puzzles until the generator lands.

## Playing it

```bash
npm run dev
```

Click signals on the board, then apply a gate — click `a`, click `b`, press
<kbd>A</kbd> for AND. Keyboard: <kbd>N</kbd>/<kbd>A</kbd>/<kbd>O</kbd> place
gates, <kbd>M</kbd> merges, <kbd>Enter</kbd> sets the output, <kbd>Esc</kbd>
clears the selection.

There is no wire dragging. Gates are applied to already-selected signals, so
every gate is fully wired the moment it exists, the circuit is always valid, and
layout can be automatic. It is also faster to play, which will matter once there
is a clock. Free-form dragging can come back later if it turns out to be missed.

Trace logging (every placement, in order) goes in from the first playable
version — it is the anti-cheat signal *and* the replay feature, and it cannot be
reconstructed retroactively.

MVP scope is solo. No networking, accounts, or ELO until the merge economy is
proven fun.
