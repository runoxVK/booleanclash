import { validate } from './circuit.js';
import { rowCount } from './truthtable.js';
import {
  CircuitError,
  type ChipDefinition,
  type ChipRegistry,
  type Circuit,
  type CircuitNode,
  type NodeId,
} from './types.js';

/**
 * Putting a circuit on the wire.
 *
 * JSON has no bigint, so truth tables travel as hex strings. Everything here is
 * paranoid on the way in: a submitted circuit is data from a stranger, and the
 * server has to be able to score it without trusting a word of it.
 */

export interface WireNode {
  readonly id: NodeId;
  readonly kind: string;
  readonly inputs: readonly (NodeId | null)[];
  readonly inputIndex?: number;
  readonly chipId?: string;
}

export interface WireChip {
  readonly id: string;
  readonly name: string;
  readonly arity: number;
  /** Hex, because JSON cannot carry a bigint. */
  readonly table: string;
  readonly gateCost: number;
}

export interface WireCircuit {
  readonly inputCount: number;
  readonly outputId: NodeId | null;
  readonly nodes: readonly WireNode[];
  readonly chips: readonly WireChip[];
}

export function toWire(circuit: Circuit, registry: ChipRegistry): WireCircuit {
  return {
    inputCount: circuit.inputCount,
    outputId: circuit.outputId,
    nodes: [...circuit.nodes.values()].map((node) => ({
      id: node.id,
      kind: node.kind,
      inputs: [...node.inputs],
      ...(node.inputIndex === undefined ? {} : { inputIndex: node.inputIndex }),
      ...(node.chipId === undefined ? {} : { chipId: node.chipId }),
    })),
    chips: [...registry.values()].map((chip) => ({
      id: chip.id,
      name: chip.name,
      arity: chip.arity,
      table: `0x${chip.table.toString(16)}`,
      gateCost: chip.gateCost,
    })),
  };
}

const KINDS = new Set(['INPUT', 'NOT', 'AND', 'OR', 'CHIP']);

function asRecord(value: unknown, what: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new CircuitError(`${what} must be an object`);
  }
  return value as Record<string, unknown>;
}

/**
 * Rebuild a circuit from untrusted input.
 *
 * Throws rather than repairing: a submission the server cannot understand is a
 * submission it must not score. `maxNodes` keeps a hostile payload from turning
 * into an evaluation that never finishes.
 */
export function fromWire(
  value: unknown,
  options: { readonly maxNodes?: number } = {},
): { circuit: Circuit; registry: ChipRegistry } {
  const maxNodes = options.maxNodes ?? 400;
  const raw = asRecord(value, 'circuit');

  const inputCount = raw.inputCount;
  if (typeof inputCount !== 'number' || !Number.isInteger(inputCount) || inputCount < 1 || inputCount > 8) {
    throw new CircuitError('inputCount must be an integer from 1 to 8');
  }

  if (!Array.isArray(raw.nodes)) throw new CircuitError('nodes must be an array');
  if (raw.nodes.length > maxNodes) {
    throw new CircuitError(`Too many nodes (limit ${maxNodes})`);
  }

  const registry = new Map<string, ChipDefinition>();
  const chips = Array.isArray(raw.chips) ? raw.chips : [];
  for (const entry of chips) {
    const chip = asRecord(entry, 'chip');
    const arity = chip.arity;
    if (typeof chip.id !== 'string' || typeof chip.name !== 'string') {
      throw new CircuitError('chip needs a string id and name');
    }
    if (typeof arity !== 'number' || !Number.isInteger(arity) || arity < 1 || arity > 6) {
      throw new CircuitError('chip arity must be an integer from 1 to 6');
    }
    if (typeof chip.table !== 'string' || !/^0x[0-9a-fA-F]+$/.test(chip.table)) {
      throw new CircuitError('chip table must be a hex string');
    }
    const table = BigInt(chip.table);
    if (table < 0n || table >= 1n << BigInt(rowCount(arity))) {
      throw new CircuitError(`chip table does not fit ${arity} parameters`);
    }
    const gateCost =
      typeof chip.gateCost === 'number' && Number.isInteger(chip.gateCost) && chip.gateCost >= 0
        ? chip.gateCost
        : 1;
    registry.set(chip.id, { id: chip.id, name: chip.name, arity, table, gateCost });
  }

  const nodes = new Map<NodeId, CircuitNode>();
  for (const entry of raw.nodes) {
    const node = asRecord(entry, 'node');
    if (typeof node.id !== 'string' || node.id.length === 0 || node.id.length > 40) {
      throw new CircuitError('node id must be a short string');
    }
    if (nodes.has(node.id)) throw new CircuitError(`duplicate node "${node.id}"`);
    if (typeof node.kind !== 'string' || !KINDS.has(node.kind)) {
      throw new CircuitError(`unknown node kind "${String(node.kind)}"`);
    }
    if (!Array.isArray(node.inputs)) throw new CircuitError('node inputs must be an array');

    const inputs = node.inputs.map((ref) => {
      if (ref === null) return null;
      if (typeof ref !== 'string') throw new CircuitError('input must be a node id or null');
      return ref;
    });

    nodes.set(node.id, {
      id: node.id,
      kind: node.kind as CircuitNode['kind'],
      inputs,
      ...(typeof node.inputIndex === 'number' ? { inputIndex: node.inputIndex } : {}),
      ...(typeof node.chipId === 'string' ? { chipId: node.chipId } : {}),
    });
  }

  const outputId =
    raw.outputId === null || raw.outputId === undefined
      ? null
      : typeof raw.outputId === 'string'
        ? raw.outputId
        : (() => {
            throw new CircuitError('outputId must be a node id or null');
          })();

  const circuit: Circuit = { inputCount, nodes, outputId };
  // Catches dangling references, wrong arity, bad input indices and cycles.
  validate(circuit);
  return { circuit, registry };
}

/**
 * How many rows of the target this signal already gets right.
 *
 * Used to settle a race where the clock ran out with nobody finished: closest
 * wins. Note a constant matches some rows for nothing, so there is a floor —
 * but it is the same floor for both players.
 */
export function rowsMatching(
  actual: bigint,
  target: bigint,
  inputCount: number,
): number {
  const rows = rowCount(inputCount);
  let matched = 0;
  for (let r = 0; r < rows; r++) {
    if (((actual >> BigInt(r)) & 1n) === ((target >> BigInt(r)) & 1n)) matched++;
  }
  return matched;
}
