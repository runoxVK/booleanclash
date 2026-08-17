/**
 * Scratch pad. Edit freely, run with `npm run play`.
 *
 * Walks the full loop the real UI has to support: build in primitives, notice a
 * repeated shape, merge it into a chip, watch the score drop. Also doubles as a
 * rough spec for the score panel and the merge button's tooltip.
 *
 * Nothing here is tested or shipped — break it, rewrite it, it's yours.
 */

import {
  CircuitBuilder,
  applyMerge,
  evaluateOutput,
  proposeMerge,
  score,
  solves,
  toRowString,
  type ChipRegistry,
  type Circuit,
  type NodeId,
} from '../packages/engine/src/index.js';

const INPUT_COUNT = 4;

/** XOR(a,b) OR XOR(c,d), spelled out entirely in NOT/AND/OR. */
function startingPosition() {
  const b = new CircuitBuilder(INPUT_COUNT);
  const ins = [b.input(0), b.input(1), b.input(2), b.input(3)];

  const xor = (x: NodeId, y: NodeId) => {
    const anyOf = b.or(x, y);
    const bothOf = b.and(x, y);
    const notBoth = b.not(bothOf);
    const root = b.and(anyOf, notBoth);
    return { root, all: [root, anyOf, bothOf, notBoth] };
  };

  const left = xor(ins[0], ins[1]);
  const right = xor(ins[2], ins[3]);
  b.setOutput(b.or(left.root, right.root));

  return { circuit: b.build(), left, right, ins };
}

function panel(
  label: string,
  circuit: Circuit,
  target: bigint,
  registry: ChipRegistry,
): void {
  const s = score(circuit, registry);
  const pad = (text: string, width = 32) =>
    text + ' '.repeat(Math.max(1, width - text.length));

  console.log(label);
  console.log(pad('  solved') + (solves(circuit, target, registry) ? 'YES' : 'no'));
  if (s.primitiveCount > 0) {
    console.log(pad(`  primitive gates x${s.primitiveCount}`) + s.primitiveCost);
  }
  for (const c of s.chips) {
    console.log(
      pad(`  ${c.name} x${c.instances}`) +
        `${c.subtotal}   (${c.definitionCost} + ${c.packagingFee} pkg + ${c.reuseFees} reuse)`,
    );
    console.log(
      ' '.repeat(32) + `      inline ${c.inlineCost}, saved ${c.saved}` +
        (c.wasteful ? '  <-- WASTEFUL' : ''),
    );
  }
  console.log('  ' + '-'.repeat(30));
  console.log(pad('  SCORE') + s.total);
  console.log();
}

/* ---------------------------------------------------------------- */

const start = startingPosition();
const target = evaluateOutput(start.circuit) ?? 0n;
let registry: ChipRegistry = new Map();

console.log(`\nTARGET  (${INPUT_COUNT} inputs)`);
console.log(`  ${toRowString(target, INPUT_COUNT)}\n`);

panel('BEFORE - everything in primitives', start.circuit, target, registry);

/* The player notices the left XOR and selects its four gates. */
console.log('MERGE ATTEMPT - the four gates of the left XOR');
const proposal = proposeMerge(start.circuit, start.left.all, registry);

if (!proposal.ok) {
  console.log(`  REJECTED (${proposal.reason})`);
  console.log(`  ${proposal.detail}\n`);
} else {
  const c = proposal.candidate;
  console.log(`  ALLOWED`);
  console.log(`  discovered   ${c.name}${c.known ? '  <-- a famous one!' : ''}`);
  console.log(`  pins         ${c.arity}`);
  console.log(`  body cost    ${c.gateCost} gates`);
  console.log(`  instances    ${c.matches.length} (bindings differ)\n`);

  const outcome = applyMerge(start.circuit, c, registry);
  registry = outcome.registry;
  panel('AFTER - XOR merged and reused', outcome.circuit, target, registry);
}

/* And the attempt that should fail: trying to swallow the whole answer. */
console.log('MERGE ATTEMPT - select the entire solution');
const greedy = proposeMerge(
  start.circuit,
  [...start.circuit.nodes.values()]
    .filter((n) => n.kind !== 'INPUT')
    .map((n) => n.id),
  registry,
);
if (!greedy.ok) {
  console.log(`  REJECTED (${greedy.reason})`);
  console.log(`  ${greedy.detail}\n`);
}
