import {
  applyChip,
  and,
  inputColumn,
  maskFor,
  not,
  or,
} from './truthtable.js';
import {
  CircuitError,
  PRIMITIVE_ARITY,
  type ChipRegistry,
  type Circuit,
  type CircuitNode,
  type NodeId,
} from './types.js';

/* ------------------------------------------------------------------ */
/* Construction                                                       */
/* ------------------------------------------------------------------ */

/**
 * Mutable helper for assembling a circuit, then freezing it.
 *
 *   const b = new CircuitBuilder(2);
 *   const a = b.input(0);
 *   const bb = b.input(1);
 *   b.setOutput(b.and(b.or(a, bb), b.not(b.and(a, bb))));  // XOR in 4 gates
 *   const circuit = b.build();
 */
export class CircuitBuilder {
  private readonly nodes = new Map<NodeId, CircuitNode>();
  private outputId: NodeId | null = null;
  private nextId = 1;

  constructor(readonly inputCount: number) {
    if (!Number.isInteger(inputCount) || inputCount < 1) {
      throw new CircuitError(`inputCount must be a positive integer`);
    }
  }

  private add(node: Omit<CircuitNode, 'id'>): NodeId {
    const id = `n${this.nextId++}`;
    this.nodes.set(id, { id, ...node });
    return id;
  }

  input(index: number): NodeId {
    if (index < 0 || index >= this.inputCount) {
      throw new CircuitError(
        `Input index ${index} out of range for ${this.inputCount} inputs`,
      );
    }
    return this.add({ kind: 'INPUT', inputs: [], inputIndex: index });
  }

  not(a: NodeId): NodeId {
    return this.add({ kind: 'NOT', inputs: [a] });
  }

  and(a: NodeId, b: NodeId): NodeId {
    return this.add({ kind: 'AND', inputs: [a, b] });
  }

  or(a: NodeId, b: NodeId): NodeId {
    return this.add({ kind: 'OR', inputs: [a, b] });
  }

  chip(chipId: string, args: readonly NodeId[]): NodeId {
    return this.add({ kind: 'CHIP', inputs: [...args], chipId });
  }

  setOutput(id: NodeId): void {
    this.outputId = id;
  }

  build(): Circuit {
    const circuit: Circuit = {
      inputCount: this.inputCount,
      nodes: new Map(this.nodes),
      outputId: this.outputId,
    };
    validate(circuit);
    return circuit;
  }
}

/* ------------------------------------------------------------------ */
/* Validation                                                         */
/* ------------------------------------------------------------------ */

/**
 * Structural checks that do not need a chip registry: references resolve,
 * primitive arities are right, input indices are in range, no cycles.
 * Chip arity is checked at evaluation time, when the registry is known.
 */
export function validate(circuit: Circuit): void {
  for (const node of circuit.nodes.values()) {
    for (const ref of node.inputs) {
      if (!circuit.nodes.has(ref)) {
        throw new CircuitError(
          `Node "${node.id}" references unknown node "${ref}"`,
        );
      }
    }

    if (node.kind === 'CHIP') {
      if (node.chipId === undefined) {
        throw new CircuitError(`CHIP node "${node.id}" has no chipId`);
      }
    } else {
      const expected = PRIMITIVE_ARITY[node.kind];
      if (node.inputs.length !== expected) {
        throw new CircuitError(
          `${node.kind} node "${node.id}" expects ${expected} input(s), got ${node.inputs.length}`,
        );
      }
    }

    if (node.kind === 'INPUT') {
      const index = node.inputIndex;
      if (
        index === undefined ||
        !Number.isInteger(index) ||
        index < 0 ||
        index >= circuit.inputCount
      ) {
        throw new CircuitError(
          `INPUT node "${node.id}" has invalid inputIndex ${String(index)}`,
        );
      }
    }
  }

  if (circuit.outputId !== null && !circuit.nodes.has(circuit.outputId)) {
    throw new CircuitError(`Output node "${circuit.outputId}" does not exist`);
  }

  assertAcyclic(circuit);
}

function assertAcyclic(circuit: Circuit): void {
  const state = new Map<NodeId, 'visiting' | 'done'>();

  const walk = (id: NodeId, trail: NodeId[]): void => {
    const mark = state.get(id);
    if (mark === 'done') return;
    if (mark === 'visiting') {
      throw new CircuitError(
        `Cycle detected: ${[...trail, id].join(' -> ')}`,
      );
    }
    state.set(id, 'visiting');
    const node = circuit.nodes.get(id);
    if (node) {
      for (const ref of node.inputs) walk(ref, [...trail, id]);
    }
    state.set(id, 'done');
  };

  for (const id of circuit.nodes.keys()) walk(id, []);
}

/* ------------------------------------------------------------------ */
/* Evaluation                                                         */
/* ------------------------------------------------------------------ */

/**
 * Compute the truth table of every node in one pass.
 *
 * Returns all nodes, not just the reachable ones, because the UI wants to show
 * the table on every wire the player has built — including experiments hanging
 * off to the side.
 */
export function evaluate(
  circuit: Circuit,
  registry: ChipRegistry = new Map(),
): Map<NodeId, bigint> {
  const mask = maskFor(circuit.inputCount);
  const values = new Map<NodeId, bigint>();

  const visit = (id: NodeId): bigint => {
    const cached = values.get(id);
    if (cached !== undefined) return cached;

    const node = circuit.nodes.get(id);
    if (!node) throw new CircuitError(`Unknown node "${id}"`);

    // validate() already proved the graph is acyclic, so plain recursion is safe.
    const args = node.inputs.map(visit);

    let value: bigint;
    switch (node.kind) {
      case 'INPUT': {
        if (node.inputIndex === undefined) {
          throw new CircuitError(`INPUT node "${id}" has no inputIndex`);
        }
        value = inputColumn(circuit.inputCount, node.inputIndex);
        break;
      }
      case 'NOT':
        value = not(args[0], mask);
        break;
      case 'AND':
        value = and(args[0], args[1]);
        break;
      case 'OR':
        value = or(args[0], args[1]);
        break;
      case 'CHIP': {
        const chip = node.chipId ? registry.get(node.chipId) : undefined;
        if (!chip) {
          throw new CircuitError(
            `Node "${id}" instantiates unknown chip "${String(node.chipId)}"`,
          );
        }
        if (args.length !== chip.arity) {
          throw new CircuitError(
            `Chip "${chip.name}" expects ${chip.arity} argument(s), got ${args.length}`,
          );
        }
        value = applyChip(chip.table, args, circuit.inputCount);
        break;
      }
    }

    values.set(id, value);
    return value;
  };

  for (const id of circuit.nodes.keys()) visit(id);
  return values;
}

/** The truth table of the circuit's output, or null if no output is wired up. */
export function evaluateOutput(
  circuit: Circuit,
  registry: ChipRegistry = new Map(),
): bigint | null {
  if (circuit.outputId === null) return null;
  return evaluate(circuit, registry).get(circuit.outputId) ?? null;
}

/** Does this circuit produce the target function? */
export function solves(
  circuit: Circuit,
  target: bigint,
  registry: ChipRegistry = new Map(),
): boolean {
  return evaluateOutput(circuit, registry) === target;
}

/* ------------------------------------------------------------------ */
/* Structure                                                          */
/* ------------------------------------------------------------------ */

/** Every node that feeds `id`, including `id` itself. */
export function reachableFrom(circuit: Circuit, id: NodeId): Set<NodeId> {
  const seen = new Set<NodeId>();
  const stack = [id];
  while (stack.length > 0) {
    const current = stack.pop() as NodeId;
    if (seen.has(current)) continue;
    seen.add(current);
    const node = circuit.nodes.get(current);
    if (node) stack.push(...node.inputs);
  }
  return seen;
}

/** Nodes that actually contribute to the output. Side experiments are free. */
export function liveNodes(circuit: Circuit): Set<NodeId> {
  if (circuit.outputId === null) return new Set();
  return reachableFrom(circuit, circuit.outputId);
}

/**
 * Placed-unit count: live gates, with each chip instance counting as one unit.
 *
 * This is a raw count, NOT the score. Real scoring — definition costs,
 * the packaging fee, and the reuse fee — lands in cost.ts at M2.
 */
export function gateCount(circuit: Circuit): number {
  let count = 0;
  for (const id of liveNodes(circuit)) {
    const node = circuit.nodes.get(id);
    if (node && node.kind !== 'INPUT') count++;
  }
  return count;
}
