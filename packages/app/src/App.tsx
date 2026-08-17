import { useEffect, useMemo, useState } from 'react';
import { evaluate, score, type NodeId } from '@logiclash/engine';
import { Board } from './components/Board';
import { ScorePanel } from './components/ScorePanel';
import { Toolbox } from './components/Toolbox';
import { TruthTable } from './components/TruthTable';
import {
  clearSelection,
  currentProposal,
  deleteSelected,
  mergeSelection,
  newGame,
  placeChip,
  placeGate,
  setOutput,
  toggleSelect,
  type GameState,
} from './game';
import { PUZZLES } from './puzzles';

/** Double Trouble first: it is the puzzle that teaches what merging is for. */
const OPENING_PUZZLE = 1;

export function App() {
  const [state, setState] = useState<GameState>(() =>
    newGame(PUZZLES[OPENING_PUZZLE]),
  );
  /** Switch positions for each circuit input, driving the live signal values. */
  const [inputBits, setInputBits] = useState<boolean[]>(() =>
    new Array(PUZZLES[OPENING_PUZZLE].inputCount).fill(false),
  );

  /* Switch positions and truth-table row are the same thing seen two ways. */
  const probeRow = inputBits.reduce(
    (acc, on, i) => (on ? acc | (1 << i) : acc),
    0,
  );

  const setProbeRow = (row: number) =>
    setInputBits(
      Array.from(
        { length: state.puzzle.inputCount },
        (_, i) => ((row >> i) & 1) === 1,
      ),
    );

  const startPuzzle = (puzzleId: string) => {
    const next = PUZZLES.find((p) => p.id === puzzleId);
    if (!next) return;
    setState(newGame(next));
    setInputBits(new Array(next.inputCount).fill(false));
  };

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

  const focusId: NodeId | null =
    state.selection.length === 1 ? state.selection[0] : state.circuit.outputId;
  const actual = focusId !== null ? values.get(focusId) ?? null : null;
  const actualLabel =
    focusId === null ? 'got' : state.selection.length === 1 ? 'sel' : 'out';

  const solved =
    state.circuit.outputId !== null &&
    values.get(state.circuit.outputId) === state.puzzle.target;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      const key = event.key.toLowerCase();

      const action: Record<string, () => void> = {
        n: () => setState(placeGate(state, 'NOT')),
        a: () => setState(placeGate(state, 'AND')),
        o: () => setState(placeGate(state, 'OR')),
        m: () => setState(mergeSelection(state)),
        enter: () => setState(setOutput(state)),
        escape: () => setState(clearSelection(state)),
        delete: () => setState(deleteSelected(state)),
        backspace: () => setState(deleteSelected(state)),
      };

      const run = action[key];
      if (run) {
        event.preventDefault();
        run();
      }
    };

    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state]);

  return (
    <div className="app">
      <header>
        <h1>Logiclash</h1>
        <select
          value={state.puzzle.id}
          onChange={(e) => startPuzzle(e.target.value)}
        >
          {PUZZLES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.inputCount} inputs · par {p.par}
            </option>
          ))}
        </select>
        <p className="hint">{state.puzzle.hint}</p>
        <button className="ghost" onClick={() => startPuzzle(state.puzzle.id)}>
          Reset
        </button>
      </header>

      <Toolbox
        chips={[...state.registry.values()]}
        onPlaceGate={(kind) => setState(placeGate(state, kind))}
        onPlaceChip={(chipId) => setState(placeChip(state, chipId))}
        onTrash={() => setState(deleteSelected(state))}
      />

      <main>
        {solved && (
          <div className="banner">
            Solved in {breakdown.total} — par is {state.puzzle.par}.
          </div>
        )}
        <Board
          circuit={state.circuit}
          registry={state.registry}
          values={values}
          selection={state.selection}
          target={state.puzzle.target}
          probeRow={probeRow}
          onToggle={(id) => setState(toggleSelect(state, id))}
          onFlipInput={(index) =>
            setInputBits((bits) =>
              bits.map((on, i) => (i === index ? !on : on)),
            )
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
            onProbe={setProbeRow}
          />
          <p className="caption">
            {state.selection.length === 1
              ? 'Comparing the selected part.'
              : state.circuit.outputId !== null
                ? 'Comparing the output.'
                : 'Select a part, or set one as the output.'}
            <br />
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
              onClick={() => setState(mergeSelection(state))}
            >
              {proposal.ok
                ? `Merge into ${proposal.candidate.name} ×${proposal.candidate.matches.length} · saves ${proposal.candidate.saved}`
                : 'Merge'}
              <kbd>M</kbd>
            </button>
            <button onClick={() => setState(setOutput(state))}>
              Set as output <kbd>&crarr;</kbd>
            </button>
            <button
              className="ghost"
              onClick={() => setState(clearSelection(state))}
            >
              Clear selection <kbd>Esc</kbd>
            </button>
          </div>

          {!proposal.ok && state.selection.length > 0 && (
            <p className="why">{proposal.detail}</p>
          )}
        </div>

        <ScorePanel breakdown={breakdown} par={state.puzzle.par} solved={solved} />
      </aside>
    </div>
  );
}
