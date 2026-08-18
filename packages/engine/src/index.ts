/**
 * @logiclash/engine — all game rules, zero dependencies, no rendering.
 *
 * This package must stay pure: it runs unchanged in the browser (for instant
 * feedback) and later on the server (as the scoring authority). If you find
 * yourself importing React here, or duplicating a rule in the app package,
 * stop — the whole anti-cheat story depends on there being one implementation.
 */

export * from './types.js';
export * from './tuning.js';
export * from './truthtable.js';
export * from './circuit.js';
export * from './cost.js';
export * from './codex.js';
export * from './merge.js';
export * from './edit.js';
export * from './board.js';
export * from './duel.js';
export * from './serialize.js';
export * from './random.js';
export * from './generate.js';
