import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  evaluate,
  partsLeft,
  proposeMerge,
  replay,
  score,
  TUNING,
  type DuelMove,
  type DuelState,
  type NodeId,
} from '@logiclash/engine';
import { Board } from '../components/Board';
import { TruthTable } from '../components/TruthTable';
import {
  forgetToken,
  net,
  NetError,
  savedToken,
  type GameView,
  type Player,
  type Seek,
} from '../net';
import type { Cell } from '../grid';
import type { Tool } from '../game';

/** How often to ask again while waiting for the opponent. */
const POLL_MS = 1500;

type Screen =
  | { readonly kind: 'signIn' }
  | { readonly kind: 'lobby' }
  | { readonly kind: 'game'; readonly id: string };

export function Duel() {
  const [me, setMe] = useState<Player | null>(null);
  const [screen, setScreen] = useState<Screen>(
    savedToken() ? { kind: 'lobby' } : { kind: 'signIn' },
  );
  const [error, setError] = useState<string | null>(null);

  /* Restore the session from the stored token on first load. */
  useEffect(() => {
    if (!savedToken() || me) return;
    net
      .me()
      .then(setMe)
      .catch((e: unknown) => {
        // A token the server no longer knows is worse than none: drop it.
        if (e instanceof NetError && e.status === 401) {
          forgetToken();
          setScreen({ kind: 'signIn' });
        } else if (e instanceof NetError) {
          setError(e.message);
        }
      });
  }, [me]);

  const signOut = () => {
    forgetToken();
    setMe(null);
    setScreen({ kind: 'signIn' });
  };

  return (
    <div className="page duel">
      <header className="page-head duel-head">
        <div>
          <h1>Duel</h1>
          <p>
            One board, one target, alternating turns. Whoever completes the
            target on their own turn wins.
          </p>
        </div>
        {me && (
          <div className="who">
            <span className="handle">{me.handle}</span>
            <span className="rating">{me.rating}</span>
            <button className="ghost" onClick={signOut}>
              Sign out
            </button>
          </div>
        )}
      </header>

      {error && (
        <p className="net-error">
          {error} <button className="ghost" onClick={() => setError(null)}>dismiss</button>
        </p>
      )}

      {screen.kind === 'signIn' && (
        <SignIn
          onSignedIn={(player) => {
            setMe(player);
            setScreen({ kind: 'lobby' });
          }}
          onError={setError}
        />
      )}

      {screen.kind === 'lobby' && me && (
        <Lobby
          me={me}
          onOpenGame={(id) => setScreen({ kind: 'game', id })}
          onError={setError}
        />
      )}

      {screen.kind === 'game' && me && (
        <GameScreen
          me={me}
          gameId={screen.id}
          onBack={() => setScreen({ kind: 'lobby' })}
          onError={setError}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Sign in                                                            */
/* ------------------------------------------------------------------ */

function SignIn({
  onSignedIn,
  onError,
}: {
  readonly onSignedIn: (player: Player) => void;
  readonly onError: (message: string) => void;
}) {
  const [handle, setHandle] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    if (handle.trim().length === 0 || busy) return;
    setBusy(true);
    try {
      onSignedIn(await net.signUp(handle.trim()));
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not sign in.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="signin">
      <h2>Pick a handle</h2>
      <p className="aside">
        No password and no email — a handle gets you a token, kept in this
        browser. Good enough to play with a friend; not good enough to be public.
      </p>
      <div className="signin-row">
        <input
          value={handle}
          maxLength={20}
          placeholder="handle"
          onChange={(e) => setHandle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') void submit();
          }}
        />
        <button className="primary" disabled={busy} onClick={() => void submit()}>
          {busy ? 'Creating…' : 'Continue'}
        </button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
/* Lobby                                                              */
/* ------------------------------------------------------------------ */

function Lobby({
  me,
  onOpenGame,
  onError,
}: {
  readonly me: Player;
  readonly onOpenGame: (id: string) => void;
  readonly onError: (message: string) => void;
}) {
  const [seeks, setSeeks] = useState<Seek[]>([]);
  const [games, setGames] = useState<GameView[]>([]);
  const [inputCount, setInputCount] = useState(4);

  const refresh = useCallback(async () => {
    try {
      const [s, g] = await Promise.all([net.listSeeks(), net.myGames()]);
      setSeeks(s);
      setGames(g);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not reach the server.');
    }
  }, [onError]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const post = async () => {
    try {
      await net.createSeek(inputCount);
      await refresh();
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not post a challenge.');
    }
  };

  const accept = async (id: string) => {
    try {
      const game = await net.acceptSeek(id);
      onOpenGame(game.id);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not accept.');
    }
  };

  const mine = seeks.filter((s) => s.player.id === me.id);
  const theirs = seeks.filter((s) => s.player.id !== me.id);
  const yourTurn = (g: GameView) =>
    g.result === null && g.players[g.turn]?.id === me.id;

  return (
    <>
      <section className="lobby-block">
        <h2>New challenge</h2>
        <div className="signin-row">
          <select
            value={inputCount}
            onChange={(e) => setInputCount(Number(e.target.value))}
          >
            <option value={3}>3 inputs</option>
            <option value={4}>4 inputs</option>
            <option value={5}>5 inputs</option>
          </select>
          <button onClick={() => void post()}>Post challenge</button>
        </div>
        {mine.length > 0 && (
          <p className="aside">
            Waiting for an opponent on {mine.map((s) => `${s.inputCount} inputs`).join(', ')}.{' '}
            <button
              className="ghost"
              onClick={() => {
                void Promise.all(mine.map((s) => net.cancelSeek(s.id))).then(refresh);
              }}
            >
              withdraw
            </button>
          </p>
        )}
      </section>

      <section className="lobby-block">
        <h2>Open challenges</h2>
        {theirs.length === 0 ? (
          <p className="aside">
            Nobody waiting. Post one above — or open this page in a second
            browser to play both sides.
          </p>
        ) : (
          <ul className="lobby-list">
            {theirs.map((seek) => (
              <li key={seek.id}>
                <span className="lname">{seek.player.handle}</span>
                <span className="lmeta">
                  {seek.player.rating} · {seek.inputCount} inputs
                </span>
                <button onClick={() => void accept(seek.id)}>Accept</button>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="lobby-block">
        <h2>Your games</h2>
        {games.length === 0 ? (
          <p className="aside">No games yet.</p>
        ) : (
          <ul className="lobby-list">
            {games.map((game) => {
              const other = game.players.find((p) => p.id !== me.id);
              return (
                <li key={game.id} className={yourTurn(game) ? 'turn' : undefined}>
                  <span className="lname">vs {other?.handle ?? '—'}</span>
                  <span className="lmeta">
                    {game.result
                      ? game.result.kind === 'draw'
                        ? 'drawn'
                        : game.players[game.result.winner]?.id === me.id
                          ? 'you won'
                          : 'you lost'
                      : yourTurn(game)
                        ? 'your turn'
                        : 'their turn'}{' '}
                    · {game.ply} moves
                  </span>
                  <button onClick={() => onOpenGame(game.id)}>Open</button>
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ */
/* The game                                                           */
/* ------------------------------------------------------------------ */

function describeMove(move: DuelMove): string {
  switch (move.kind) {
    case 'place':
      return `place ${move.gate.toLowerCase()}`;
    case 'place-chip':
      return 'place chip';
    case 'rewire':
      return move.source === null ? 'unplug a pin' : 'rewire a pin';
    case 'package':
      return `package ${move.nodeIds.length} parts`;
    case 'resign':
      return 'resign';
  }
}

function GameScreen({
  me,
  gameId,
  onBack,
  onError,
}: {
  readonly me: Player;
  readonly gameId: string;
  readonly onBack: () => void;
  readonly onError: (message: string) => void;
}) {
  const [view, setView] = useState<GameView | null>(null);
  const [selection, setSelection] = useState<readonly NodeId[]>([]);
  const [armed, setArmed] = useState<Tool | null>(null);
  const [inputBits, setInputBits] = useState<boolean[]>([]);
  const [busy, setBusy] = useState(false);
  /* A cell chosen before the inputs were picked. Placement needs a gate, its
     inputs and a cell; insisting on one particular order is a trap, so either
     order works and the move fires once all three are known. */
  const [pendingCell, setPendingCell] = useState<Cell | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const next = await net.getGame(gameId);
      setView(next);
      setInputBits((bits) =>
        bits.length === next.puzzle.inputCount
          ? bits
          : new Array(next.puzzle.inputCount).fill(false),
      );
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not load the game.');
    }
  }, [gameId, onError]);

  useEffect(() => {
    void load();
  }, [load]);

  /* Replaying the move list locally gives the same state the server holds —
     the rules live in the engine, so there is nothing to keep in sync. */
  const state: DuelState | null = useMemo(() => {
    if (!view) return null;
    const outcome = replay(
      { inputCount: view.puzzle.inputCount, target: BigInt(view.puzzle.target) },
      view.moves,
    );
    return outcome.ok ? outcome.state : null;
  }, [view]);

  const seat: 0 | 1 | null = view
    ? view.players[0]?.id === me.id
      ? 0
      : view.players[1]?.id === me.id
        ? 1
        : null
    : null;

  const myTurn =
    state !== null && seat !== null && state.result === null && state.turn === seat;

  /* Poll only while it is not our move; there is nothing to learn otherwise. */
  const pollingFor = useRef(gameId);
  useEffect(() => {
    pollingFor.current = gameId;
    if (myTurn || state?.result) return;
    const timer = setInterval(() => void load(), POLL_MS);
    return () => clearInterval(timer);
  }, [gameId, myTurn, state?.result, load]);

  const values = useMemo(
    () => (state ? evaluate(state.circuit, state.registry) : new Map<NodeId, bigint>()),
    [state],
  );

  const probeRow = inputBits.reduce(
    (acc, on, i) => (on ? acc | (1 << i) : acc),
    0,
  );

  const packageProposal = useMemo(
    () =>
      state
        ? proposeMerge(state.circuit, [...selection], state.registry)
        : { ok: false as const, reason: 'empty-selection' as const, detail: '' },
    [state, selection],
  );

  const send = async (move: DuelMove) => {
    if (!view || busy) return;
    setBusy(true);
    try {
      setView(await net.postMove(gameId, move, view.ply));
      setSelection([]);
      setArmed(null);
      setPendingCell(null);
      setNotice(null);
    } catch (e) {
      // A rejected move usually means the board moved under us; refetch so the
      // player sees the real position rather than arguing with a stale one.
      onError(e instanceof Error ? e.message : 'Move refused.');
      await load();
    } finally {
      setBusy(false);
    }
  };

  const attemptPlace = (cell: Cell) => {
    if (armed === null) {
      setNotice('Pick a part from the left first.');
      return;
    }
    if (selection.length !== arity) {
      setPendingCell(cell);
      const missing = arity - selection.length;
      setNotice(
        missing > 0
          ? `Cell chosen. Now click ${missing} signal${missing === 1 ? '' : 's'} to feed it.`
          : `That part takes ${arity}; you have ${selection.length} selected.`,
      );
      return;
    }
    void send(
      armed.kind === 'gate'
        ? { kind: 'place', gate: armed.gate, cell, inputs: [...selection] }
        : { kind: 'place-chip', chipId: armed.chipId, cell, inputs: [...selection] },
    );
  };

  const chooseSignal = (id: NodeId) => {
    const next = selection.includes(id)
      ? selection.filter((s) => s !== id)
      : [...selection, id];
    setSelection(next);
    setNotice(null);

    // If a cell is already waiting and this completes the pin count, go.
    if (armed !== null && pendingCell !== null && next.length === arity) {
      void send(
        armed.kind === 'gate'
          ? { kind: 'place', gate: armed.gate, cell: pendingCell, inputs: next }
          : {
              kind: 'place-chip',
              chipId: armed.chipId,
              cell: pendingCell,
              inputs: next,
            },
      );
    }
  };

  if (!view || !state) {
    return (
      <section className="lobby-block">
        <p className="aside">Loading…</p>
      </section>
    );
  }

  const armedChip =
    armed?.kind === 'chip' ? state.registry.get(armed.chipId) ?? null : null;
  const arity =
    armed === null
      ? 0
      : armed.kind === 'gate'
        ? armed.gate === 'NOT'
          ? 1
          : 2
        : armedChip?.arity ?? 0;
  const readyToPlace = armed !== null && selection.length === arity;
  const left = partsLeft(state);
  const target = BigInt(view.puzzle.target);
  const focus = selection.length === 1 ? selection[0] : state.circuit.outputId;

  return (
    <div className="duel-game">
      <div className="duel-bar">
        <button className="ghost" onClick={onBack}>
          &larr; Lobby
        </button>
        <span className="seats">
          {view.players.map((p, i) => (
            <span
              key={p.id}
              className={`seat${state.turn === i && !state.result ? ' active' : ''}${p.id === me.id ? ' you' : ''}`}
            >
              {p.handle}
              {p.id === me.id ? ' (you)' : ''}
            </span>
          ))}
        </span>
        <span className="budget">
          {left} of {TUNING.duel.partBudget} parts left
        </span>
        <span className={`whose${myTurn ? ' mine' : ''}`}>
          {state.result
            ? state.result.kind === 'draw'
              ? `Draw — ${state.result.reason.replace(/-/g, ' ')}`
              : view.players[state.result.winner]?.id === me.id
                ? 'You won'
                : `${view.players[state.result.winner]?.handle} won`
            : myTurn
              ? 'Your move'
              : 'Waiting…'}
        </span>
      </div>

      <div className="duel-body">
        <div className="duel-tools">
          {/* When the board is not yours, say so here rather than only in the
              bar above — a column of dead buttons with no explanation reads as
              a broken game. */}
          {!myTurn && !state.result && (
            <p className="waiting-note">
              Waiting for{' '}
              <strong>{view.players[state.turn]?.handle ?? 'your opponent'}</strong>.
              Nothing is clickable until they move.
            </p>
          )}
          {state.result && (
            <p className="waiting-note">This game is over.</p>
          )}

          <h3>Place</h3>
          <p className="aside">
            Pick a part, click the signals feeding it, then click an empty cell —
            in either order. The whole sequence is one move.
          </p>
          {(['NOT', 'AND', 'OR'] as const).map((gate) => (
            <button
              key={gate}
              className={
                armed?.kind === 'gate' && armed.gate === gate ? 'armed' : undefined
              }
              disabled={!myTurn}
              onClick={() =>
                setArmed(
                  armed?.kind === 'gate' && armed.gate === gate
                    ? null
                    : { kind: 'gate', gate },
                )
              }
            >
              {gate.toLowerCase()}
              <em>{gate === 'NOT' ? '1 pin' : '2 pins'}</em>
            </button>
          ))}

          {[...state.registry.values()].map((chip) => (
            <button
              key={chip.id}
              className={
                armed?.kind === 'chip' && armed.chipId === chip.id ? 'armed' : undefined
              }
              disabled={!myTurn}
              onClick={() =>
                setArmed(
                  armed?.kind === 'chip' && armed.chipId === chip.id
                    ? null
                    : { kind: 'chip', chipId: chip.id },
                )
              }
            >
              {chip.name}
              <em>{chip.arity} pins</em>
            </button>
          ))}

          <h3>Or</h3>
          <button
            className={packageProposal.ok ? 'ready' : undefined}
            disabled={!myTurn || !packageProposal.ok}
            onClick={() => void send({ kind: 'package', nodeIds: [...selection] })}
          >
            {packageProposal.ok
              ? `Package ${packageProposal.candidate.name}`
              : 'Package'}
          </button>
          <button
            className="ghost"
            disabled={selection.length === 0}
            onClick={() => setSelection([])}
          >
            Clear selection
          </button>
          <button
            className="ghost danger"
            disabled={!myTurn}
            onClick={() => void send({ kind: 'resign' })}
          >
            Resign
          </button>

          {armed && (
            <p className="chosen">
              inputs:{' '}
              {selection.length === 0
                ? '—'
                : selection
                    .map((id) => {
                      const node = state.circuit.nodes.get(id);
                      if (!node) return '?';
                      if (node.kind === 'INPUT') {
                        return 'abcdefgh'[node.inputIndex ?? 0];
                      }
                      if (node.kind === 'CHIP') {
                        return node.chipId
                          ? state.registry.get(node.chipId)?.name ?? 'chip'
                          : 'chip';
                      }
                      return node.kind.toLowerCase();
                    })
                    .join(', ')}{' '}
              <span className="of">
                ({selection.length} of {arity})
              </span>
            </p>
          )}
          {armed && (
            <p className={readyToPlace ? 'why ready' : 'why'}>
              {readyToPlace
                ? pendingCell
                  ? 'Sending…'
                  : 'Now click an empty cell.'
                : `Click ${arity - selection.length} more signal${arity - selection.length === 1 ? '' : 's'} on the board${pendingCell ? ' — the cell is already chosen.' : ', then an empty cell.'}`}
            </p>
          )}
          {notice && <p className="message">{notice}</p>}
          {!packageProposal.ok && selection.length > 1 && !armed && (
            <p className="why">{packageProposal.detail}</p>
          )}
        </div>

        <Board
          circuit={state.circuit}
          registry={state.registry}
          values={values}
          cells={state.cells}
          selection={selection}
          armed={armed}
          selectionPackages={packageProposal.ok}
          highlightSignals={myTurn && armed !== null && selection.length < arity}
          target={target}
          probeRow={probeRow}
          onSelect={chooseSignal}
          onPlace={attemptPlace}
          onMove={() => {
            /* Shuffling a part around is not a move in the duel. */
          }}
          onWire={(targetId, pin, sourceId) =>
            void send({ kind: 'rewire', target: targetId, pin, source: sourceId })
          }
          onUnwire={(targetId, pin) =>
            void send({ kind: 'rewire', target: targetId, pin, source: null })
          }
          onFlipInput={(index) =>
            setInputBits((bits) => bits.map((on, i) => (i === index ? !on : on)))
          }
          onBackground={() => setSelection([])}
        />

        <div className="duel-side">
          <div className="panel">
            <h2>Target</h2>
            <TruthTable
              inputCount={view.puzzle.inputCount}
              target={target}
              actual={focus !== null ? values.get(focus) ?? null : null}
              actualLabel={selection.length === 1 ? 'sel' : 'out'}
              probeRow={probeRow}
              onProbe={(row) =>
                setInputBits(
                  Array.from(
                    { length: view.puzzle.inputCount },
                    (_, i) => ((row >> i) & 1) === 1,
                  ),
                )
              }
            />
          </div>

          <div className="panel">
            <h2>
              Moves <span className="ply">{view.ply}</span>
            </h2>
            <ol className="movelist">
              {view.moves.map((move, i) => (
                <li key={i} className={i % 2 === 0 ? 'p0' : 'p1'}>
                  <span className="mno">{i + 1}</span>
                  {describeMove(move)}
                </li>
              ))}
            </ol>
            {view.moves.length === 0 && (
              <p className="aside">No moves yet.</p>
            )}
          </div>

          <div className="panel">
            <h2>Board</h2>
            <p className="aside">
              {score(state.circuit, state.registry).total} units wired to the
              output. Packaging returns parts to the shared budget, so it buys
              tempo as well as space.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
