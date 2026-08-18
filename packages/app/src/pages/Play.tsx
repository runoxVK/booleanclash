import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { evaluate, score, type NodeId } from '@logiclash/engine';
import { coach, describeGoal } from '../coach';
import { Board } from '../components/Board';
import { Catalogue } from '../components/Catalogue';
import { HowToPlay } from '../components/HowToPlay';
import { ScorePanel } from '../components/ScorePanel';
import { Toolbox } from '../components/Toolbox';
import { TruthTable } from '../components/TruthTable';
import {
  arm,
  clearSelection,
  currentProposal,
  deleteSelected,
  dockOutput,
  mergeSelection,
  moveNode,
  newGame,
  placeArmed,
  setOutput,
  toggleSelect,
  unwire,
  wire,
  type GameState,
} from '../game';
import type { Cell } from '../grid';
import { recordSolve, type Progress } from '../progress';
import { nextPuzzle, PUZZLES, puzzleById } from '../puzzles';

const OPENING_PUZZLE = PUZZLES[0];
const UNDO_LIMIT = 60;
const SEEN_HELP_KEY = 'logiclash.seenHelp.v1';

interface PlayProps {
  /** False while another page is showing. Play stays mounted to keep the
      circuit, but its shortcuts must not fire from under other pages. */
  readonly active: boolean;
  readonly progress: Progress;
  readonly onProgress: (next: Progress) => void;
  /** A puzzle requested from elsewhere in the site. The ticket changes even
      when the same puzzle is picked twice, so replaying works. */
  readonly request: { readonly id: string; readonly ticket: number } | null;
}

export function Play({ active, progress, onProgress, request }: PlayProps) {
  const [state, setState] = useState<GameState>(() => newGame(OPENING_PUZZLE));
  const [past, setPast] = useState<GameState[]>([]);
  const [inputBits, setInputBits] = useState<boolean[]>(() =>
    new Array(OPENING_PUZZLE.inputCount).fill(false),
  );
  const [showHelp, setShowHelp] = useState(() => {
    try {
      return localStorage.getItem(SEEN_HELP_KEY) === null;
    } catch {
      return true;
    }
  });

  const dismissHelp = useCallback(() => {
    setShowHelp(false);
    try {
      localStorage.setItem(SEEN_HELP_KEY, '1');
    } catch {
      // Private browsing; showing the card again is a fine failure mode.
    }
  }, []);

  /** Switch positions and truth-table row are the same state seen two ways. */
  const probeRow = inputBits.reduce(
    (acc, on, i) => (on ? acc | (1 << i) : acc),
    0,
  );

  /* Any move that changes the circuit or the arrangement is undoable. */
  const apply = useCallback((move: (s: GameState) => GameState) => {
    setState((current) => {
      const next = move(current);
      const changed =
        next.circuit !== current.circuit ||
        next.registry !== current.registry ||
        next.cells !== current.cells;
      if (changed) setPast((stack) => [...stack, current].slice(-UNDO_LIMIT));
      return next;
    });
  }, []);

  const undo = useCallback(() => {
    setPast((stack) => {
      if (stack.length === 0) return stack;
      setState(stack[stack.length - 1]);
      return stack.slice(0, -1);
    });
  }, []);

  const startPuzzle = useCallback((puzzleId: string) => {
    const puzzle = puzzleById(puzzleId);
    if (!puzzle) return;
    setState(newGame(puzzle));
    setPast([]);
    setInputBits(new Array(puzzle.inputCount).fill(false));
  }, []);

  const lastTicket = useRef<number | null>(null);
  useEffect(() => {
    if (!request || request.ticket === lastTicket.current) return;
    lastTicket.current = request.ticket;
    startPuzzle(request.id);
  }, [request, startPuzzle]);

  const values = useMemo(() => {
    try {
      return evaluate(state.circuit, state.registry);
    } catch {
      return new Map<NodeId, bigint>();
    }
  }, [state.circuit, state.registry]);

  const breakdown = useMemo(
    () => score(state.circuit, state.registry),
    [state.circuit, state.registry],
  );

  /* Whether the CURRENT SELECTION is a component. Note this only ever answers a
     question the player asked by selecting something — it never scans the board
     for clusters they have not noticed. */
  const proposal = useMemo(() => currentProposal(state), [state]);

  const focusId: NodeId | null =
    state.selection.length === 1 ? state.selection[0] : state.circuit.outputId;
  const actual = focusId !== null ? values.get(focusId) ?? null : null;
  const actualLabel =
    focusId === null ? 'got' : state.selection.length === 1 ? 'sel' : 'out';

  const solved =
    state.circuit.outputId !== null &&
    values.get(state.circuit.outputId) === state.puzzle.target;

  /* The moment a part computes the target, dock it. Hunting for a separate
     "set as output" step is a dead end nobody enjoys finding. */
  useEffect(() => {
    if (state.circuit.outputId !== null) return;
    for (const [id, value] of values) {
      if (value !== state.puzzle.target) continue;
      const node = state.circuit.nodes.get(id);
      if (node && node.kind !== 'INPUT') {
        setState((s) => (s.circuit.outputId === null ? dockOutput(s, id) : s));
        return;
      }
    }
  }, [values, state.circuit, state.puzzle.target]);

  const guidance = coach(state, solved, breakdown.total, state.puzzle.par);

  /* Bank the score the moment it is achieved, not on some "submit" button. */
  const bankedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!solved) return;
    const stamp = `${state.puzzle.id}:${breakdown.total}`;
    if (bankedFor.current === stamp) return;
    bankedFor.current = stamp;
    onProgress(recordSolve(progress, state.puzzle.id, breakdown.total));
  }, [solved, state.puzzle.id, breakdown.total, progress, onProgress]);

  useEffect(() => {
    if (!active) return;

    const onKey = (event: KeyboardEvent) => {
      if (event.altKey) return;

      /* Never steal a keystroke from a text field. These shortcuts are bare
         letters, so without this check typing a handle anywhere in the site
         loses every a, o, n, m, u and f to the board. */
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.isContentEditable ||
          target.tagName === 'INPUT' ||
          target.tagName === 'TEXTAREA' ||
          target.tagName === 'SELECT')
      ) {
        return;
      }

      const key = event.key.toLowerCase();

      if ((event.metaKey || event.ctrlKey) && key === 'z') {
        event.preventDefault();
        undo();
        return;
      }
      if (event.metaKey || event.ctrlKey) return;

      const gates: Record<string, 'NOT' | 'AND' | 'OR'> = {
        n: 'NOT',
        a: 'AND',
        o: 'OR',
      };

      const moves: Record<string, () => void> = {
        m: () => apply(mergeSelection),
        enter: () => apply(setOutput),
        delete: () => apply(deleteSelected),
        backspace: () => apply(deleteSelected),
        u: undo,
        escape: () => setState(clearSelection),
      };

      const gate = gates[key];
      if (gate) {
        event.preventDefault();
        // Pressing the same key again puts the part back down.
        setState((s) =>
          arm(
            s,
            s.armed?.kind === 'gate' && s.armed.gate === gate
              ? null
              : { kind: 'gate', gate },
          ),
        );
        return;
      }

      const run = moves[key];
      if (run) {
        event.preventDefault();
        run();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [apply, undo]);

  const best = progress[state.puzzle.id];
  const upNext = nextPuzzle(state.puzzle.id);

  return (
    <div className="app">
      <header>
        <select
          value={state.puzzle.id}
          onChange={(e) => startPuzzle(e.target.value)}
        >
          {PUZZLES.map((p) => {
            const record = progress[p.id];
            return (
              <option key={p.id} value={p.id}>
                {record !== undefined ? '✓ ' : ''}
                {p.name} · {p.inputCount} in · par {p.par}
                {record !== undefined ? ` · best ${record}` : ''}
              </option>
            );
          })}
        </select>
        <p className="hint">{state.puzzle.hint}</p>
        <button className="ghost" onClick={() => setShowHelp(true)}>
          How to play
        </button>
        <button className="ghost" onClick={() => startPuzzle(state.puzzle.id)}>
          Reset
        </button>
      </header>

      {showHelp && <HowToPlay onClose={dismissHelp} />}

      <Toolbox
        chips={[...state.registry.values()]}
        armed={state.armed}
        onArm={(tool) => setState((s) => arm(s, tool))}
        onTrash={() => apply(deleteSelected)}
      />

      <main>
        <div className={`coach ${guidance.tone}`}>{guidance.text}</div>
        {solved && (
          <div className="banner">
            <span>
              Solved in <strong>{breakdown.total}</strong> · par {state.puzzle.par}
              {best !== undefined && best < breakdown.total
                ? ` · your best ${best}`
                : ''}
            </span>
            {upNext && (
              <button onClick={() => startPuzzle(upNext.id)}>
                Next: {upNext.name} &rarr;
              </button>
            )}
          </div>
        )}
        <Board
          circuit={state.circuit}
          registry={state.registry}
          values={values}
          cells={state.cells}
          selection={state.selection}
          armed={state.armed}
          selectionPackages={proposal.ok}
          target={state.puzzle.target}
          probeRow={probeRow}
          onSelect={(id) => setState((s) => toggleSelect(s, id))}
          onPlace={(cell: Cell) => apply((s) => placeArmed(s, cell))}
          onMove={(id, cell) => apply((s) => moveNode(s, id, cell))}
          onWire={(t, pin, src) => apply((s) => wire(s, t, pin, src))}
          onUnwire={(t, pin) => apply((s) => unwire(s, t, pin))}
          onFlipInput={(index) =>
            setInputBits((bits) => bits.map((on, i) => (i === index ? !on : on)))
          }
          onBackground={() => setState(clearSelection)}
        />
        {state.message && <p className="message">{state.message}</p>}
      </main>

      <aside className="right">
        <ScorePanel
          breakdown={breakdown}
          par={state.puzzle.par}
          solved={solved}
          best={best}
        />

        <div className="panel">
          <h2>Actions</h2>
          <div className="buttons wide">
            <button
              className={proposal.ok ? 'merge ready' : 'merge'}
              disabled={!proposal.ok}
              onClick={() => apply(mergeSelection)}
            >
              {proposal.ok
                ? `Package as ${proposal.candidate.name} · ${proposal.candidate.nodeIds.length} → 1`
                : 'Package as component'}
              <kbd>M</kbd>
            </button>
            <button onClick={() => apply(setOutput)}>
              Set as output <kbd>&crarr;</kbd>
            </button>
            <button disabled={past.length === 0} onClick={undo}>
              Undo <kbd>U</kbd>
            </button>
            <button className="ghost" onClick={() => setState(clearSelection)}>
              Clear <kbd>Esc</kbd>
            </button>
          </div>

          {!proposal.ok && state.selection.length > 0 && (
            <p className="why">{proposal.detail}</p>
          )}
        </div>


        <div className="panel">
          <h2>Target</h2>
          <TruthTable
            inputCount={state.puzzle.inputCount}
            target={state.puzzle.target}
            actual={actual}
            actualLabel={actualLabel}
            probeRow={probeRow}
            onProbe={(row) =>
              setInputBits(
                Array.from(
                  { length: state.puzzle.inputCount },
                  (_, i) => ((row >> i) & 1) === 1,
                ),
              )
            }
          />
          <p className="caption">
            {describeGoal(state.puzzle.inputCount)}
            <br />
            Clicking a row flips the switches to match it.
          </p>
        </div>

        <Catalogue registry={state.registry} />
      </aside>
    </div>
  );
}
