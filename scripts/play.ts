/**
 * Scratch pad. Edit freely, run with `npm run play`.
 *
 * This is where you poke at the engine by hand before there is any UI. It also
 * doubles as a rough spec for the score panel the real interface needs to draw.
 * Nothing here is tested or shipped — break it, rewrite it, it's yours.
 */

import {
  CircuitBuilder,
  evaluateOutput,
  score,
  solves,
  toRowString,
  type ChipDefinition,
  type ChipRegistry,
  type Circuit,
  type ScoreBreakdown,
} from '../packages/engine/src/index.js';

const INPUT_COUNT = 4;

/* The chip the player would discover partway through this puzzle. */
const XOR: ChipDefinition = {
  id: 'chip-xor',
  name: 'XOR',
  arity: 2,
  table: 0x6n,
  gateCost: 4,
};
const registry: ChipRegistry = new Map([[XOR.id, XOR]]);

/* ---------------------------------------------------------------- */

/** XOR(a,b) OR XOR(c,d), built entirely from primitives. */
function allPrimitives(): Circuit {
  const b = new CircuitBuilder(INPUT_COUNT);
  const ins = [b.input(0), b.input(1), b.input(2), b.input(3)];

  const xor = (x: string, y: string) =>
    b.and(b.or(x, y), b.not(b.and(x, y)));

  b.setOutput(b.or(xor(ins[0], ins[1]), xor(ins[2], ins[3])));
  return b.build();
}

/** The same function, with XOR crystallized into a chip and reused. */
function withChip(): Circuit {
  const b = new CircuitBuilder(INPUT_COUNT);
  const ins = [b.input(0), b.input(1), b.input(2), b.input(3)];
  b.setOutput(
    b.or(b.chip(XOR.id, [ins[0], ins[1]]), b.chip(XOR.id, [ins[2], ins[3]])),
  );
  return b.build();
}

/* ---------------------------------------------------------------- */

function panel(label: string, circuit: Circuit, target: bigint): void {
  const s: ScoreBreakdown = score(circuit, registry);

  console.log(`${label}`);
  console.log(`  solved${' '.repeat(22)}${solves(circuit, target, registry) ? 'YES' : 'no'}`);

  if (s.primitiveCount > 0) {
    const line = `  primitive gates x${s.primitiveCount}`;
    console.log(`${line}${' '.repeat(Math.max(1, 30 - line.length))}${s.primitiveCost}`);
  }

  for (const c of s.chips) {
    const line = `  ${c.name} x${c.instances}`;
    const math = `${c.definitionCost} + ${c.packagingFee} pkg + ${c.reuseFees} reuse`;
    console.log(
      `${line}${' '.repeat(Math.max(1, 30 - line.length))}${c.subtotal}   (${math})`,
    );
    console.log(
      `${' '.repeat(30)}      inline ${c.inlineCost}, saved ${c.saved}${c.wasteful ? '  <-- WASTEFUL' : ''}`,
    );
  }

  if (s.deadGateCount > 0) {
    console.log(`  unused experiments x${s.deadGateCount}${' '.repeat(9)}0   (free)`);
  }

  console.log(`  ${'-'.repeat(28)}`);
  console.log(`  SCORE${' '.repeat(25)}${s.total}`);
  if (s.totalSaved !== 0) console.log(`  merging saved you            ${s.totalSaved}`);
  console.log();
}

/* ---------------------------------------------------------------- */

const target = evaluateOutput(allPrimitives()) ?? 0n;

console.log(`\nTARGET  (${INPUT_COUNT} inputs)`);
console.log(`  ${toRowString(target, INPUT_COUNT)}`);
console.log(`  0x${target.toString(16).toUpperCase()}\n`);

panel('BUILD A - all primitives', allPrimitives(), target);
panel('BUILD B - XOR merged and reused', withChip(), target);
