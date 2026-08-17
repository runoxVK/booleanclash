# Logiclash

Build a target logic function from NOT/AND/OR using the fewest chips.

## Commands

```bash
npm test
```

```bash
npm run test:watch
```

```bash
npm run typecheck
```

## Layout

```
packages/engine/   All game rules. Zero dependencies. No rendering.
packages/app/      (M5) Vite + React + @xyflow/react. Owns no rules.
```

**The one architectural rule:** every game rule lives in `engine`, which knows
nothing about pixels. `engine` runs unchanged in the browser (instant feedback)
and later on the server (scoring authority + anti-cheat). If a rule ever exists
in two places, the anti-cheat story is dead. No exceptions.

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
chip size cap ~8 nodes. All four numbers are tuning knobs (M6).

Chip identity is **behavioural, not structural** — same arity + same truth table
means same chip, however it was wired. That is what powers "you discovered XOR"
and prevents hoarding variants.

## Roadmap

| | |
|---|---|
| M0 | Scaffold — **done** |
| M1 | Truth tables + circuit model + evaluation — **done** |
| M2 | `cost.ts` — real scoring: definition cost, packaging fee, reuse fee |
| M3 | `merge.ts` — pattern matching, binding check, chip registry, codex |
| M4 | `generate.ts` — puzzle curation, filtered for paradigm diversity |
| M5 | `packages/app` — the editor UI |
| M6 | Playtest and tune the four constants |

Trace logging (every placement, in order) goes in from the first playable
version — it is the anti-cheat signal *and* the replay feature, and it cannot be
reconstructed retroactively.

MVP scope is solo. No networking, accounts, or ELO until the merge economy is
proven fun.
