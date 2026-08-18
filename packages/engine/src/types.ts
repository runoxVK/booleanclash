/**
 * Core data model for Logiclash circuits.
 *
 * A circuit is a DAG. Nodes are gates; edges are wires. Wires may fan out
 * freely (one node's output can feed many nodes) and fan-out is FREE — that is
 * the fundamental economy of the game. Chips exist for the other kind of
 * reuse: the same *function* applied to *different* signals.
 */

export type NodeId = string;
export type ChipId = string;

export type GateKind = 'INPUT' | 'NOT' | 'AND' | 'OR' | 'CHIP';

/** Fixed input counts for the primitive kinds. CHIP arity varies per chip. */
export const PRIMITIVE_ARITY = {
  INPUT: 0,
  NOT: 1,
  AND: 2,
  OR: 2,
} as const satisfies Partial<Record<GateKind, number>>;

export interface CircuitNode {
  readonly id: NodeId;
  readonly kind: GateKind;
  /**
   * Source nodes feeding this gate, in pin order. Length always matches arity;
   * `null` is a pin that exists but has nothing plugged into it yet.
   *
   * Half-wired gates are a real state in an editor where you place a part and
   * then wire it, so they are modelled here rather than papered over. A node
   * with an unconnected pin simply has no value.
   */
  readonly inputs: readonly (NodeId | null)[];
  /** Which circuit input this reads (0-based). Present iff kind === 'INPUT'. */
  readonly inputIndex?: number;
  /** Which chip definition this instantiates. Present iff kind === 'CHIP'. */
  readonly chipId?: ChipId;
}

export interface Circuit {
  /** Number of independent binary inputs, i.e. `a`, `b`, `c`, ... */
  readonly inputCount: number;
  readonly nodes: ReadonlyMap<NodeId, CircuitNode>;
  /** The node whose value is compared against the puzzle target. */
  readonly outputId: NodeId | null;
}

/**
 * A crystallized subcircuit the player has merged into a reusable unit.
 *
 * Identity is behavioural, not structural: two chips with the same `arity` and
 * `table` are the same chip no matter how they were wired. That is what lets
 * the game recognize "you discovered XOR" and prevents hoarding variants.
 */
export interface ChipDefinition {
  readonly id: ChipId;
  /** Display name — a well-known label like "XOR", or a player-chosen one. */
  readonly name: string;
  /** Number of formal parameters (p0, p1, ...). */
  readonly arity: number;
  /** Behaviour, as a truth table over `arity` parameters. See truthtable.ts. */
  readonly table: bigint;
  /** Primitive gate count of the body — the chip's definition cost. */
  readonly gateCost: number;
}

export type ChipRegistry = ReadonlyMap<ChipId, ChipDefinition>;

/** Thrown for structurally invalid circuits: bad arity, cycles, dangling refs. */
export class CircuitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CircuitError';
  }
}
