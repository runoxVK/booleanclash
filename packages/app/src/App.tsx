import { useEffect, useMemo, useState } from 'react';
import { evaluate, score, type NodeId } from '@logiclash/engine';
import { Board } from './components/Board';
import { ScorePanel } from './components/ScorePanel';
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

  /* Keyboard shortcuts. Speed matters once there is a clock. */
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

  const chips = [...state.registry.values()];

  return (
    <div className="app">
      <header>
        <h1>Logiclash</h1>
        <select
          value={state.puzzle.id}
          onChange={(e) => {
            const next = PUZZLES.find((p) => p.id === e.target.value);
            if (next) setState(newGame(next));
          }}
        >
          {PUZZLES.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name} · {p.inputCount} inputs · par {p.par}
            </option>
          ))}
        </select>
        <p className="hint">{state.puzzle.hint}</p>
        <button className="ghost" onClick={() => setState(newGame(state.puzzle))}>
          Reset
        </button>
      </header>

      <aside className="left">
        <div className="panel">
          <h2>Target</h2>
          <TruthTable
            inputCount={state.puzzle.inputCount}
            target={state.puzzle.target}
            actual={actual}
            actualLabel={actualLabel}
          />
          <p className="caption">
            {state.selection.length === 1
              ? 'Comparing the selected gate.'
              : state.circuit.outputId !== null
                ? 'Comparing the output gate.'
                : 'Select a gate, or set one as the output.'}
          </p>
        </div>
      </aside>

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
          onToggle={(id) => setState(toggleSelect(state, id))}
        />
      </main>

      <aside className="right">
        <div className="panel">
          <h2>Build</h2>
          <p className="caption">
            Click signals on the board, then apply a gate. Order matters.
          </p>
          <div className="buttons">
            <button onClick={() => setState(placeGate(state, 'NOT'))}>
              NOT <kbd>N</kbd>
            </button>
            <button onClick={() => setState(placeGate(state, 'AND'))}>
              AND <kbd>A</kbd>
            </button>
            <button onClick={() => setState(placeGate(state, 'OR'))}>
              OR <kbd>O</kbd>
            </button>
          </div>

          {chips.length > 0 && (
            <>
              <h3>Your chips</h3>
              <div className="buttons">
                {chips.map((chip) => (
                  <button
                    key={chip.id}
                    className="chip-btn"
                    onClick={() => setState(placeChip(state, chip.id))}
                  >
                    {chip.name}
                    <em>{chip.arity} pins</em>
                  </button>
                ))}
              </div>
            </>
          )}

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
          </div>

          {!proposal.ok && state.selection.length > 0 && (
            <p className="why">{proposal.detail}</p>
          )}

          <div className="buttons wide">
            <button onClick={() => setState(setOutput(state))}>
              Set as output <kbd>&crarr;</kbd>
            </button>
            <button onClick={() => setState(deleteSelected(state))}>
              Delete <kbd>Del</kbd>
            </button>
            <button className="ghost" onClick={() => setState(clearSelection(state))}>
              Clear selection <kbd>Esc</kbd>
            </button>
          </div>

          {state.message && <p className="message">{state.message}</p>}
        </div>

        <ScorePanel
          breakdown={breakdown}
          par={state.puzzle.par}
          solved={solved}
        />
      </aside>
    </div>
  );
}
