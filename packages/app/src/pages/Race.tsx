import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  evaluate,
  fromWire,
  score,
  toWire,
  type ChipRegistry,
  type Circuit,
  type NodeId,
} from '@logiclash/engine';
import { Board } from '../components/Board';
import { Catalogue } from '../components/Catalogue';
import { SignIn } from '../components/SignIn';
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
import {
  forgetToken,
  net,
  NetError,
  savedToken,
  type Player,
  type RaceSeek,
  type RaceView,
} from '../net';
import type { Puzzle } from '../puzzles';

const LOBBY_POLL_MS = 2000;
const RACE_POLL_MS = 2000;
/** Quiet period after your last edit before the circuit is sent. */
const SUBMIT_DEBOUNCE_MS = 900;

const LIMITS = [
  { ms: 60_000, label: '1 min' },
  { ms: 180_000, label: '3 min' },
  { ms: 300_000, label: '5 min' },
] as const;

function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
}

/** A race's puzzle, dressed as the shape the solo board already understands. */
function puzzleOf(race: RaceView): Puzzle {
  return {
    id: `race-${race.id}`,
    name: 'Race',
    inputCount: race.puzzle.inputCount,
    target: BigInt(race.puzzle.target),
    par: race.par,
    hint: '',
    kind: 'campaign',
  };
}

type Screen =
  | { readonly kind: 'signIn' }
  | { readonly kind: 'lobby' }
  | { readonly kind: 'race'; readonly id: string };

export function Race() {
  const [me, setMe] = useState<Player | null>(null);
  const [screen, setScreen] = useState<Screen>(
    savedToken() ? { kind: 'lobby' } : { kind: 'signIn' },
  );
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!savedToken() || me) return;
    net
      .me()
      .then(setMe)
      .catch((e: unknown) => {
        if (e instanceof NetError && e.status === 401) {
          forgetToken();
          setScreen({ kind: 'signIn' });
        } else if (e instanceof Error) {
          setError(e.message);
        }
      });
  }, [me]);

  return (
    <div className="page duel">
      <header className="page-head duel-head">
        <div>
          <h1>Race</h1>
          <p>
            Same puzzle, your own board, one clock. Fewest parts wins — and
            neither of you can see the other&rsquo;s circuit until it is over.
          </p>
        </div>
        {me && (
          <div className="who">
            <span className="handle">{me.handle}</span>
            <span className="rating">{me.rating}</span>
            <button
              className="ghost"
              onClick={() => {
                forgetToken();
                setMe(null);
                setScreen({ kind: 'signIn' });
              }}
            >
              Sign out
            </button>
          </div>
        )}
      </header>

      {error && (
        <p className="net-error">
          {error}{' '}
          <button className="ghost" onClick={() => setError(null)}>
            dismiss
          </button>
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
          onOpen={(id) => setScreen({ kind: 'race', id })}
          onError={setError}
        />
      )}

      {screen.kind === 'race' && me && (
        <RaceBoard
          me={me}
          raceId={screen.id}
          onBack={() => setScreen({ kind: 'lobby' })}
          onError={setError}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Lobby                                                              */
/* ------------------------------------------------------------------ */

function Lobby({
  me,
  onOpen,
  onError,
}: {
  readonly me: Player;
  readonly onOpen: (id: string) => void;
  readonly onError: (message: string) => void;
}) {
  const [seeks, setSeeks] = useState<RaceSeek[]>([]);
  const [races, setRaces] = useState<RaceView[]>([]);
  const [inputCount, setInputCount] = useState(4);
  const [limit, setLimit] = useState<number>(180_000);

  const refresh = useCallback(async () => {
    try {
      const [s, r] = await Promise.all([net.listRaceSeeks(), net.myRaces()]);
      setSeeks(s);
      setRaces(r);
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not reach the server.');
    }
  }, [onError]);

  useEffect(() => {
    void refresh();
    const timer = setInterval(() => void refresh(), LOBBY_POLL_MS);
    return () => clearInterval(timer);
  }, [refresh]);

  const mine = seeks.filter((s) => s.player.id === me.id);
  const theirs = seeks.filter((s) => s.player.id !== me.id);
  const live = races.filter((r) => r.result === null);
  const done = races.filter((r) => r.result !== null).slice(0, 8);

  return (
    <>
      <section className="lobby-block">
        <h2>Challenge someone</h2>
        <div className="signin-row">
          <select
            value={inputCount}
            onChange={(e) => setInputCount(Number(e.target.value))}
          >
            <option value={3}>3 inputs</option>
            <option value={4}>4 inputs</option>
            <option value={5}>5 inputs</option>
          </select>
          <select value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
            {LIMITS.map((l) => (
              <option key={l.ms} value={l.ms}>
                {l.label}
              </option>
            ))}
          </select>
          <button
            onClick={() =>
              void net
                .createRaceSeek(inputCount, limit)
                .then(refresh)
                .catch((e: Error) => onError(e.message))
            }
          >
            Post challenge
          </button>
        </div>
        {mine.length > 0 && (
          <p className="aside">
            Waiting for someone to accept.{' '}
            <button
              className="ghost"
              onClick={() =>
                void Promise.all(mine.map((s) => net.cancelRaceSeek(s.id))).then(
                  refresh,
                )
              }
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
            Nobody waiting. Post one above and send your friend the link.
          </p>
        ) : (
          <ul className="lobby-list">
            {theirs.map((seek) => (
              <li key={seek.id}>
                <span className="lname">{seek.player.handle}</span>
                <span className="lmeta">
                  {seek.player.rating} · {seek.inputCount} inputs ·{' '}
                  {LIMITS.find((l) => l.ms === seek.timeLimitMs)?.label ?? '?'}
                </span>
                <button
                  onClick={() =>
                    void net
                      .acceptRaceSeek(seek.id)
                      .then((race) => onOpen(race.id))
                      .catch((e: Error) => onError(e.message))
                  }
                >
                  Race
                </button>
              </li>
            ))}
          </ul>
        )}
      </section>

      {live.length > 0 && (
        <section className="lobby-block">
          <h2>In progress</h2>
          <ul className="lobby-list">
            {live.map((race) => (
              <li key={race.id} className="turn">
                <span className="lname">
                  vs {race.players[race.seat === 0 ? 1 : 0]?.handle ?? '—'}
                </span>
                <span className="lmeta">{clock(race.msLeft)} left</span>
                <button onClick={() => onOpen(race.id)}>Resume</button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {done.length > 0 && (
        <section className="lobby-block">
          <h2>Finished</h2>
          <ul className="lobby-list">
            {done.map((race) => {
              const won =
                race.result?.kind === 'win' && race.result.winner === race.seat;
              return (
                <li key={race.id}>
                  <span className="lname">
                    vs {race.players[race.seat === 0 ? 1 : 0]?.handle ?? '—'}
                  </span>
                  <span className="lmeta">
                    {race.result?.kind === 'draw'
                      ? 'drawn'
                      : won
                        ? 'you won'
                        : 'you lost'}
                    {race.you.score !== null ? ` · you ${race.you.score}` : ''}
                    {race.opponent.score !== null
                      ? ` · them ${race.opponent.score}`
                      : ''}
                  </span>
                  <button onClick={() => onOpen(race.id)}>Review</button>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
/* The race board                                                     */
/* ------------------------------------------------------------------ */

function RaceBoard({
  me,
  raceId,
  onBack,
  onError,
}: {
  readonly me: Player;
  readonly raceId: string;
  readonly onBack: () => void;
  readonly onError: (message: string) => void;
}) {
  const [race, setRace] = useState<RaceView | null>(null);
  const [state, setState] = useState<GameState | null>(null);
  const [inputBits, setInputBits] = useState<boolean[]>([]);
  const [msLeft, setMsLeft] = useState(0);

  /* Load once, then build a local board for the race's puzzle. */
  useEffect(() => {
    let alive = true;
    net
      .getRace(raceId)
      .then((view) => {
        if (!alive) return;
        setRace(view);
        setMsLeft(view.msLeft);
        setInputBits(new Array(view.puzzle.inputCount).fill(false));
        setState((current) => current ?? newGame(puzzleOf(view)));
      })
      .catch((e: Error) => onError(e.message));
    return () => {
      alive = false;
    };
  }, [raceId, onError]);

  const over = race?.result !== null && race !== undefined;

  /* The clock ticks locally and resyncs from the server on every poll, so it
     stays smooth without drifting away from the authoritative deadline. */
  useEffect(() => {
    if (over) return;
    const timer = setInterval(() => setMsLeft((ms) => Math.max(0, ms - 250)), 250);
    return () => clearInterval(timer);
  }, [over]);

  const poll = useCallback(async () => {
    try {
      const view = await net.getRace(raceId);
      setRace(view);
      setMsLeft(view.msLeft);
    } catch {
      // A missed poll is not worth shouting about; the next one will do.
    }
  }, [raceId]);

  useEffect(() => {
    if (over) return;
    const timer = setInterval(() => void poll(), RACE_POLL_MS);
    return () => clearInterval(timer);
  }, [over, poll]);

  /* Send the circuit shortly after editing stops, and let the server score it.
     Submitting as you go keeps the closeness tiebreak honest and means a
     dropped connection does not lose the work.

     Note what is NOT in the dependency list: msLeft. The clock ticks four times
     a second, and depending on it tore down the pending timer on every tick, so
     the debounce never elapsed and nothing was ever submitted. Deadline is read
     from the race's own fields instead. */
  const lastSent = useRef<string>('');
  const solvedRef = useRef(false);

  useEffect(() => {
    if (!state || !race || race.result !== null) return;
    if (Date.now() >= race.startedAt + race.timeLimitMs) return;

    const payload = JSON.stringify(toWire(state.circuit, state.registry));
    if (payload === lastSent.current) return;

    const send = () => {
      lastSent.current = payload;
      void net
        .submitRace(raceId, JSON.parse(payload))
        .then((view) => {
          setRace(view);
          setMsLeft(view.msLeft);
        })
        .catch((e: Error) => onError(e.message));
    };

    // A solve goes immediately: waiting nearly a second to bank it could lose a
    // race that was won.
    if (solvedRef.current) {
      send();
      return;
    }

    const timer = setTimeout(send, SUBMIT_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [
    state,
    raceId,
    onError,
    race?.result,
    race?.startedAt,
    race?.timeLimitMs,
    race,
  ]);

  const values = useMemo(
    () =>
      state
        ? evaluate(state.circuit, state.registry)
        : new Map<NodeId, bigint>(),
    [state],
  );

  const breakdown = useMemo(
    () => (state ? score(state.circuit, state.registry) : null),
    [state],
  );

  const proposal = useMemo(
    () => (state ? currentProposal(state) : null),
    [state],
  );

  /* Dock the output the moment a part matches the target, exactly as solo does. */
  useEffect(() => {
    if (!state || !race || state.circuit.outputId !== null) return;
    const target = BigInt(race.puzzle.target);
    for (const [id, value] of values) {
      if (value !== target) continue;
      const node = state.circuit.nodes.get(id);
      if (node && node.kind !== 'INPUT') {
        setState((s) => (s && s.circuit.outputId === null ? dockOutput(s, id) : s));
        return;
      }
    }
  }, [values, state, race]);

  if (!race || !state || !breakdown || !proposal) {
    return (
      <section className="lobby-block">
        <p className="aside">Loading…</p>
      </section>
    );
  }

  const target = BigInt(race.puzzle.target);
  const them = race.players[race.seat === 0 ? 1 : 0];
  const probeRow = inputBits.reduce(
    (acc, on, i) => (on ? acc | (1 << i) : acc),
    0,
  );
  const focus =
    state.selection.length === 1 ? state.selection[0] : state.circuit.outputId;
  const solved =
    state.circuit.outputId !== null &&
    values.get(state.circuit.outputId) === target;
  solvedRef.current = solved;
  const low = msLeft <= 15_000;
  const frozen = race.result !== null || msLeft <= 0;
  /* Every edit goes through this, so nothing can change after time is up. */
  const edit = (change: (s: GameState) => GameState) => {
    if (frozen) return;
    setState((s) => (s ? change(s) : s));
  };

  const verdict = () => {
    if (!race.result) return null;
    if (race.result.kind === 'draw') {
      return race.result.reason === 'identical'
        ? 'Drawn — same score, same moment.'
        : 'Drawn — neither of you solved it, and you got equally close.';
    }
    const youWon = race.result.winner === race.seat;
    const why = {
      'fewer-parts': 'fewer parts',
      faster: 'same score, but faster',
      'only-solver': 'the only one to solve it',
      closer: 'nobody solved it — you got closer',
    }[race.result.reason];
    const whyThem = {
      'fewer-parts': 'fewer parts',
      faster: 'same score, but faster',
      'only-solver': 'the only one to solve it',
      closer: 'nobody solved it — they got closer',
    }[race.result.reason];
    return youWon ? `You won — ${why}.` : `${them?.handle} won — ${whyThem}.`;
  };

  return (
    <div className="duel-game">
      <div className={`duel-bar${low && !race.result ? ' urgent' : ''}`}>
        <button className="ghost" onClick={onBack}>
          &larr; Lobby
        </button>
        <span className={`race-clock${low && !race.result ? ' low' : ''}`}>
          {race.result ? 'time' : clock(msLeft)}
        </span>
        <span className="seats">
          <span className="seat you">
            {me.handle}
            <em>{breakdown.total} parts</em>
          </span>
          <span className="seat">
            {them?.handle ?? '—'}
            <em>
              {race.opponent.solvedAt !== null
                ? `solved · ${race.opponent.score}`
                : `${race.opponent.close}/${1 << race.puzzle.inputCount} rows`}
            </em>
          </span>
        </span>
        <span className={`whose${solved ? ' mine' : ''}`}>
          {frozen && !race.result
            ? 'Time up — waiting for the result'
            : race.result
            ? verdict()
            : solved
              ? `Solved in ${breakdown.total} — can you trim it?`
              : `par ${race.par}`}
        </span>
      </div>

      {race.result && (
        <div className="banner">
          <span>{verdict() ?? ''}</span>
          <button onClick={onBack}>Back to lobby</button>
        </div>
      )}

      <div className="duel-body">
        <Toolbox
          chips={frozen ? [] : [...state.registry.values()]}
          armed={state.armed}
          onArm={(tool) => edit((s) => arm(s, tool))}
          onTrash={() => edit(deleteSelected)}
        />

        <Board
          circuit={state.circuit}
          registry={state.registry}
          values={values}
          cells={state.cells}
          selection={state.selection}
          armed={state.armed}
          selectionPackages={proposal.ok}
          target={target}
          probeRow={probeRow}
          onSelect={(id) => edit((s) => toggleSelect(s, id))}
          onPlace={(cell: Cell) => edit((s) => placeArmed(s, cell))}
          onMove={(id, cell) => edit((s) => moveNode(s, id, cell))}
          onWire={(t, pin, src) => edit((s) => wire(s, t, pin, src))}
          onUnwire={(t, pin) => edit((s) => unwire(s, t, pin))}
          onFlipInput={(index) =>
            setInputBits((bits) => bits.map((on, i) => (i === index ? !on : on)))
          }
          onBackground={() => edit(clearSelection)}
        />

        <div className="duel-side">
          <div className="panel">
            <h2>
              Score <span className="score-total">{breakdown.total}</span>
            </h2>
            <div className="par">
              par <strong>{race.par}</strong>
              {race.you.score !== null && (
                <span className="best">banked {race.you.score}</span>
              )}
            </div>
            <div className="buttons wide">
              <button
                className={proposal.ok ? 'merge ready' : 'merge'}
                disabled={!proposal.ok}
                onClick={() => edit(mergeSelection)}
              >
                {proposal.ok
                  ? `Package as ${proposal.candidate.name}`
                  : 'Package'}
                <kbd>M</kbd>
              </button>
              <button onClick={() => edit(setOutput)}>
                Set as output
              </button>
            </div>
            {!proposal.ok && state.selection.length > 0 && (
              <p className="why">{proposal.detail}</p>
            )}
          </div>

          <div className="panel">
            <h2>Target</h2>
            <TruthTable
              inputCount={race.puzzle.inputCount}
              target={target}
              actual={focus !== null ? values.get(focus) ?? null : null}
              actualLabel={state.selection.length === 1 ? 'sel' : 'out'}
              probeRow={probeRow}
              onProbe={(row) =>
                setInputBits(
                  Array.from(
                    { length: race.puzzle.inputCount },
                    (_, i) => ((row >> i) & 1) === 1,
                  ),
                )
              }
            />
          </div>

          <Catalogue registry={state.registry} />
        </div>
      </div>

      {race.result !== null && race.opponent.circuit != null && (
        <Reveal
          label={`${them?.handle ?? 'Opponent'} — ${race.opponent.score ?? 'unsolved'}`}
          wire={race.opponent.circuit}
          target={target}
          probeRow={probeRow}
          onError={onError}
        />
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Post-race reveal                                                   */
/* ------------------------------------------------------------------ */

function Reveal({
  label,
  wire: payload,
  target,
  probeRow,
  onError,
}: {
  readonly label: string;
  readonly wire: unknown;
  readonly target: bigint;
  readonly probeRow: number;
  readonly onError: (message: string) => void;
}) {
  const rebuilt = useMemo(() => {
    try {
      return fromWire(payload, { maxNodes: 200 });
    } catch (e) {
      onError(e instanceof Error ? e.message : 'Could not read that circuit.');
      return null;
    }
  }, [payload, onError]);

  const laidOut = useMemo(() => {
    if (!rebuilt) return null;
    // The opponent's cell positions are not sent, so lay it out from scratch.
    return autoCells(rebuilt.circuit, rebuilt.registry);
  }, [rebuilt]);

  if (!rebuilt || !laidOut) return null;

  const values = evaluate(rebuilt.circuit, rebuilt.registry);

  return (
    <div className="panel reveal">
      <h2>{label}</h2>
      <p className="caption">
        Their circuit, now that the race is over. This is the part worth looking
        at: same target, different answer.
      </p>
      <Board
        circuit={rebuilt.circuit}
        registry={rebuilt.registry}
        values={values}
        cells={laidOut}
        selection={[]}
        armed={null}
        selectionPackages={false}
        target={target}
        probeRow={probeRow}
        onSelect={() => {}}
        onPlace={() => {}}
        onMove={() => {}}
        onWire={() => {}}
        onUnwire={() => {}}
        onFlipInput={() => {}}
        onBackground={() => {}}
      />
    </div>
  );
}

/** Lay a circuit out by depth, for a board whose positions were never sent. */
function autoCells(circuit: Circuit, registry: ChipRegistry) {
  const depth = new Map<NodeId, number>();
  const depthOf = (id: NodeId): number => {
    const seen = depth.get(id);
    if (seen !== undefined) return seen;
    const node = circuit.nodes.get(id);
    let d = 0;
    if (node && node.kind !== 'INPUT') {
      const feeders = node.inputs.filter((r): r is NodeId => r !== null);
      d = feeders.length === 0 ? 1 : 1 + Math.max(...feeders.map(depthOf));
    }
    depth.set(id, d);
    return d;
  };

  const rows = new Map<number, NodeId[]>();
  for (const id of circuit.nodes.keys()) {
    const d = depthOf(id);
    const row = rows.get(d);
    if (row) row.push(id);
    else rows.set(d, [id]);
  }

  const deepest = Math.max(0, ...rows.keys());
  const cells = new Map<NodeId, { col: number; row: number }>();
  for (const [d, ids] of rows) {
    ids.forEach((id, i) => {
      cells.set(id, { col: Math.min(10, i), row: Math.max(0, deepest - d) });
    });
  }
  void registry;
  return cells;
}
