/**
 * Scratch pad. Edit freely, run with `npm run play`.
 *
 * This is where you poke at the engine by hand before there is any UI.
 * Nothing here is tested or shipped — break it, rewrite it, it's yours.
 */

import {
  CircuitBuilder,
  evaluateOutput,
  formatTable,
  fromRowString,
  gateCount,
  solves,
  toRowString,
} from '../packages/engine/src/index.js';

/* A puzzle target, written the way a player reads it: row 0 first. */
const { table: target, inputCount } = fromRowString('0110');

console.log('TARGET');
console.log(formatTable(target, inputCount));
console.log();

/* Attempt 1: XOR as (a OR b) AND NOT(a AND b) */
const b = new CircuitBuilder(inputCount);
const a0 = b.input(0);
const a1 = b.input(1);
b.setOutput(b.and(b.or(a0, a1), b.not(b.and(a0, a1))));
const circuit = b.build();

const result = evaluateOutput(circuit);

console.log('YOUR CIRCUIT');
console.log(formatTable(result ?? 0n, inputCount));
console.log();
console.log('row string :', toRowString(result ?? 0n, inputCount));
console.log('chips used :', gateCount(circuit));
console.log('solved     :', solves(circuit, target) ? 'YES' : 'no');
