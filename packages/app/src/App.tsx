import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { evaluate, score, type NodeId } from '@logiclash/engine';
import { coach, describeGoal } from './coach';
import { Board } from './components/Board';
import { HowToPlay } from './components/HowToPlay';
import { ScorePanel } from './components/ScorePanel';
import { Toolbox } from './components/Toolbox';
import { TruthTable } from './components/TruthTable';
import {
  clearSelection,
  currentProposal,
  deleteSelected,
  dockOutput,
  mergeSelection,
  newGame,
  placeChip,
  placeGate,
  selectSuggestion,
  setOutput,
  suggestMerge,
  toggleSelect,
  type GameState,
} from './game';
import { loadProgress, recordSolve, type Progress } from './progress';
import { nextPuzzle, PUZZLES, puzzleById } from './puzzles';

/** Start on the gentlest puzzle. Double Trouble is a bad first impression. */
const OPENING_PUZZLE = PUZZLES[0];
const UNDO_LIMIT = 60;
const SEEN_HELP_KEY = 'logiclash.seenHelp.v1';

export function App() {
  const [state, setState] = useState<GameState>(() => newGame(OPENING_PUZZLE));
  const [past, setPast] = useState<GameState[]>([]);
  const [inputBits, setInputBits] = useState<boolean[]>(() =>
    new Array(OPENING_PUZZLE.inputCount).fill(false),
  );
  const [progress, setProgress] = useState<Progress>(loadProgress);
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

  /* Any move that changes the circuit is undoable. */
  const apply = useCallback((move: (s: GameState) => GameState) => {
    setState((current) => {
      const next = move(current);
      if (next.circuit !== current.circuit || next.registry !== current.registry) {
        setPast((stack) => [...stack, current].slice(-UNDO_LIMIT));
      }
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

  const proposal = useMemo(() => currentProposal(state), [state]);

  /* Only look for an unnoticed merge when the current selection is not already
     one, so the hint does not fight the thing the player is doing. */
  const suggestion = useMemo(
    () => (proposal.ok ? null : suggestMerge(state)),
    [proposal.ok, state],
  );

  const focusId: NodeId | null =
    state.selection.length === 1 ? state.selection[0] : state.circuit.outputId;
  const actual = focusId !== null ? values.get(focusId) ?? null : null;
  const actualLabel =
    focusId === null ? 'got' : state.selection.length === 1 ? 'sel' : 'out';

  const solved =
    state.circuit.outputId !== null &&
    values.get(state.circuit.outputId) === state.puzzle.target;

  /* The moment a part computes the target, dock it. Requiring the player to
     separately discover "set as output" is a dead end nobody enjoys finding. */
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

  const guidance = coach(
    state,
    values,
    proposal,
    solved,
    breakdown.total,
    state.puzzle.par,
    suggestion,
  );

  const highlightSuggestion = useCallback(() => {
    if (!suggestion) return;
    setState((s) => selectSuggestion(s, suggestion.selection));
  }, [suggestion]);

  /* Bank the score the moment it is achieved, not on some "submit" button. */
  const bankedFor = useRef<string | null>(null);
  useEffect(() => {
    if (!solved) return;
    const stamp = `${state.puzzle.id}:${breakdown.total}`;
    if (bankedFor.current === stamp) return;
    bankedFor.current = stamp;
    setProgress((p) => recordSolve(p, state.puzzle.id, breakdown.total));
  }, [solved, state.puzzle.id, breakdown.total]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.altKey) return;
      const key = event.key.toLowerCase();

      if ((event.metaKey || event.ctrlKey) && key === 'z') {
        event.preventDefault();
        undo();
        return;
      }
      if (event.metaKey || event.ctrlKey) return;

      const moves: Record<string, () => void> = {
        n: () => apply((s) => placeGate(s, 'NOT')),
        a: () => apply((s) => placeGate(s, 'AND')),
        o: () => apply((s) => placeGate(s, 'OR')),
        m: () => apply(mergeSelection),
        enter: () => apply(setOutput),
        delete: () => apply(deleteSelected),
        backspace: () => apply(deleteSelected),
        u: undo,
        f: highlightSuggestion,
        escape: () => setState(clearSelection),
      };

      const run = moves[key];
      if (run) {
        event.preventDefault();
        run();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [apply, undo, highlightSuggestion]);

  const best = progress[state.puzzle.id];
  const upNext = nextPuzzle(state.puzzle.id);
  const solvedCount = PUZZLES.filter((p) => progress[p.id] !== undefined).length;

  return (
    <div className="app">
      <header>
        <h1>Logiclash</h1>
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
        <span className="tally">
          {solvedCount}/{PUZZLES.length} solved
        </span>
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
        selected={state.selection.length}
        onPlaceGate={(kind) => apply((s) => placeGate(s, kind))}
        onPlaceChip={(chipId) => apply((s) => placeChip(s, chipId))}
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
              {breakdown.total < state.puzzle.par ? ' · under par!' : ''}
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
          selection={state.selection}
          target={state.puzzle.target}
          probeRow={probeRow}
          onToggle={(id) => setState((s) => toggleSelect(s, id))}
          onFlipInput={(index) =>
            setInputBits((bits) => bits.map((on, i) => (i === index ? !on : on)))
          }
        />
        {state.message && <p className="message">{state.message}</p>}
      </main>

      <aside className="right">
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
            <br />
            {state.selection.length === 1
              ? 'The GOT column is the part you have selected.'
              : state.circuit.outputId !== null
                ? 'The GOT column is your output.'
                : 'Select a part to compare it against the target.'}{' '}
            Clicking a row flips the switches to match it.
          </p>
        </div>

        <div className="panel">
          <h2>Actions</h2>
          <div className="buttons wide">
            <button
              className={proposal.ok ? 'merge ready' : 'merge'}
              disabled={!proposal.ok}
              title={proposal.ok ? undefined : proposal.detail}
              onClick={() => apply(mergeSelection)}
            >
              {proposal.ok
                ? `Merge into ${proposal.candidate.name} ×${proposal.candidate.matches.length} · saves ${proposal.candidate.saved}`
                : 'Merge'}
              <kbd>M</kbd>
            </button>
            <button onClick={() => apply(setOutput)}>
              Set as output <kbd>&crarr;</kbd>
            </button>
            <button
              className={suggestion ? 'ready' : ''}
              disabled={!suggestion}
              onClick={highlightSuggestion}
              title={
                suggestion
                  ? `Highlight a repeated shape worth ${suggestion.saved}`
                  : 'No repeated shape on the board yet'
              }
            >
              {suggestion ? `Find repeat · ${suggestion.name}` : 'Find repeat'}
              <kbd>F</kbd>
            </button>
            <button disabled={past.length === 0} onClick={undo}>
              Undo <kbd>U</kbd>
            </button>
            <button className="ghost" onClick={() => setState(clearSelection)}>
              Clear selection <kbd>Esc</kbd>
            </button>
          </div>

          {!proposal.ok && state.selection.length > 0 && (
            <p className="why">{proposal.detail}</p>
          )}
        </div>

        <ScorePanel
          breakdown={breakdown}
          par={state.puzzle.par}
          solved={solved}
          best={best}
        />
      </aside>
    </div>
  );
}
