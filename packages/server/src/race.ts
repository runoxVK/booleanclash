import { randomUUID } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import {
  CircuitError,
  evaluateOutput,
  fromWire,
  generatePuzzle,
  rowsMatching,
  totalScore,
} from '@logiclash/engine';
import { ApiError, applyRating, requirePlayer, type Context } from './api.js';

/**
 * Races: separate boards, one clock, fewest units wins.
 *
 * The server never trusts a submitted circuit. It rebuilds it from the wire
 * format, which validates the structure, then evaluates and scores it itself. A
 * client claiming "solved in 3" proves nothing; the circuit does.
 *
 * Opponent circuits are withheld until the race is over. Showing them mid-race
 * would let you copy the answer, and copying is not the skill this game is
 * about. Afterwards both are revealed, which is the interesting part.
 */

const LIMITS = [60_000, 180_000, 300_000] as const;
const MIN_INPUTS = 3;
const MAX_INPUTS = 5;

interface RaceRow {
  id: string;
  player0: string;
  player1: string;
  input_count: number;
  target: string;
  par: number;
  time_limit_ms: number;
  started_at: number;
  circuit0: string | null;
  score0: number | null;
  solved0_at: number | null;
  close0: number;
  circuit1: string | null;
  score1: number | null;
  solved1_at: number | null;
  close1: number;
  result: string | null;
  created_at: number;
  updated_at: number;
}

export type RaceResult =
  | {
      kind: 'win';
      winner: 0 | 1;
      reason: 'fewer-parts' | 'faster' | 'only-solver' | 'closer';
    }
  | { kind: 'draw'; reason: 'identical' | 'neither-solved' };

function raceById(db: DatabaseSync, id: string): RaceRow | null {
  return (db.prepare('SELECT * FROM races WHERE id = ?').get(id) as unknown as RaceRow) ?? null;
}

function seatOf(race: RaceRow, playerId: string): 0 | 1 {
  if (race.player0 === playerId) return 0;
  if (race.player1 === playerId) return 1;
  throw new ApiError(403, 'You are not in this race.');
}

export function msLeft(race: RaceRow, now = Date.now()): number {
  return Math.max(0, race.started_at + race.time_limit_ms - now);
}

/**
 * Who won, or null while it is still undecided.
 *
 * Both solved: fewer units wins, then whoever got there first. One solved and
 * the clock is gone: they win. Neither solved: whoever matched more rows of the
 * target, so partial progress beats giving up.
 */
export function decide(race: RaceRow, now = Date.now()): RaceResult | null {
  const solved0 = race.solved0_at !== null;
  const solved1 = race.solved1_at !== null;

  if (solved0 && solved1) {
    const s0 = race.score0 ?? Number.MAX_SAFE_INTEGER;
    const s1 = race.score1 ?? Number.MAX_SAFE_INTEGER;
    if (s0 !== s1) {
      return { kind: 'win', winner: s0 < s1 ? 0 : 1, reason: 'fewer-parts' };
    }
    const t0 = race.solved0_at ?? Number.MAX_SAFE_INTEGER;
    const t1 = race.solved1_at ?? Number.MAX_SAFE_INTEGER;
    if (t0 !== t1) {
      return { kind: 'win', winner: t0 < t1 ? 0 : 1, reason: 'faster' };
    }
    return { kind: 'draw', reason: 'identical' };
  }

  // One solver does not end it: the other may still solve it in fewer parts.
  if (msLeft(race, now) > 0) return null;

  if (solved0 !== solved1) {
    return { kind: 'win', winner: solved0 ? 0 : 1, reason: 'only-solver' };
  }
  if (race.close0 !== race.close1) {
    return {
      kind: 'win',
      winner: race.close0 > race.close1 ? 0 : 1,
      reason: 'closer',
    };
  }
  return { kind: 'draw', reason: 'neither-solved' };
}

/** Settle once, applying ratings. Safe to call repeatedly. */
function settle(db: DatabaseSync, race: RaceRow): RaceRow {
  if (race.result !== null) return race;
  const result = decide(race);
  if (!result) return race;

  db.prepare('UPDATE races SET result = ?, updated_at = ? WHERE id = ?').run(
    JSON.stringify(result),
    Date.now(),
    race.id,
  );
  applyRating(
    db,
    race.player0,
    race.player1,
    result.kind === 'draw' ? 0.5 : result.winner === 0 ? 1 : 0,
  );
  return raceById(db, race.id) ?? race;
}

function view(db: DatabaseSync, race: RaceRow, viewerId: string) {
  const settled = settle(db, race);
  const seat = seatOf(settled, viewerId);
  const over = settled.result !== null;

  const player = (id: string) =>
    db.prepare('SELECT id, handle, rating FROM players WHERE id = ?').get(id);

  const side = (n: 0 | 1) => ({
    score: n === 0 ? settled.score0 : settled.score1,
    solvedAt: n === 0 ? settled.solved0_at : settled.solved1_at,
    close: n === 0 ? settled.close0 : settled.close1,
    /* Your own circuit always; theirs only once it cannot be copied. */
    circuit:
      n === seat || over
        ? JSON.parse((n === 0 ? settled.circuit0 : settled.circuit1) ?? 'null')
        : null,
  });

  return {
    id: settled.id,
    kind: 'race' as const,
    players: [player(settled.player0), player(settled.player1)],
    seat,
    puzzle: { inputCount: settled.input_count, target: settled.target },
    par: settled.par,
    timeLimitMs: settled.time_limit_ms,
    startedAt: settled.started_at,
    msLeft: msLeft(settled),
    you: side(seat),
    opponent: side(seat === 0 ? 1 : 0),
    result: settled.result ? (JSON.parse(settled.result) as RaceResult) : null,
  };
}

/* ------------------------------------------------------------------ */
/* Endpoints                                                          */
/* ------------------------------------------------------------------ */

interface SeekRow {
  id: string;
  player_id: string;
  input_count: number;
  time_limit_ms: number;
  created_at: number;
  race_id: string | null;
}

export function listRaceSeeks(ctx: Context) {
  const rows = ctx.db
    .prepare('SELECT * FROM race_seeks WHERE race_id IS NULL ORDER BY created_at')
    .all() as unknown as SeekRow[];

  return rows.map((seek) => ({
    id: seek.id,
    inputCount: seek.input_count,
    timeLimitMs: seek.time_limit_ms,
    createdAt: seek.created_at,
    player: ctx.db
      .prepare('SELECT id, handle, rating FROM players WHERE id = ?')
      .get(seek.player_id),
  }));
}

export function createRaceSeek(ctx: Context, body: unknown) {
  const player = requirePlayer(ctx);
  const raw = (body ?? {}) as { inputCount?: unknown; timeLimitMs?: unknown };

  const inputCount = Number(raw.inputCount ?? 4);
  if (
    !Number.isInteger(inputCount) ||
    inputCount < MIN_INPUTS ||
    inputCount > MAX_INPUTS
  ) {
    throw new ApiError(400, `inputCount must be ${MIN_INPUTS} to ${MAX_INPUTS}.`);
  }

  const timeLimitMs = Number(raw.timeLimitMs ?? 180_000);
  if (!(LIMITS as readonly number[]).includes(timeLimitMs)) {
    throw new ApiError(400, `timeLimitMs must be one of ${LIMITS.join(', ')}.`);
  }

  const id = randomUUID();
  ctx.db
    .prepare(
      'INSERT INTO race_seeks (id, player_id, input_count, time_limit_ms, created_at) VALUES (?, ?, ?, ?, ?)',
    )
    .run(id, player.id, inputCount, timeLimitMs, Date.now());

  return { id, inputCount, timeLimitMs };
}

export function cancelRaceSeek(ctx: Context, seekId: string) {
  const player = requirePlayer(ctx);
  ctx.db
    .prepare(
      'DELETE FROM race_seeks WHERE id = ? AND player_id = ? AND race_id IS NULL',
    )
    .run(seekId, player.id);
  return { ok: true };
}

export function acceptRaceSeek(ctx: Context, seekId: string) {
  const player = requirePlayer(ctx);
  const seek = ctx.db
    .prepare('SELECT * FROM race_seeks WHERE id = ?')
    .get(seekId) as unknown as SeekRow | undefined;

  if (!seek) throw new ApiError(404, 'No such challenge.');
  if (seek.race_id !== null) throw new ApiError(409, 'Already taken.');
  if (seek.player_id === player.id) {
    throw new ApiError(400, 'That is your own challenge.');
  }

  // A fresh seed, so neither player has met this puzzle before.
  const seed = Math.floor(Math.random() * 1_000_000) + 1;
  const puzzle = generatePuzzle(seed, seek.input_count);
  const id = randomUUID();
  const now = Date.now();

  ctx.db
    .prepare(
      `INSERT INTO races (id, player0, player1, input_count, target, par,
                          time_limit_ms, started_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      id,
      seek.player_id,
      player.id,
      seek.input_count,
      `0x${puzzle.target.toString(16)}`,
      puzzle.par,
      seek.time_limit_ms,
      now,
      now,
      now,
    );
  ctx.db.prepare('UPDATE race_seeks SET race_id = ? WHERE id = ?').run(id, seekId);

  const race = raceById(ctx.db, id);
  if (!race) throw new ApiError(500, 'Race vanished.');
  return view(ctx.db, race, player.id);
}

export function myRaces(ctx: Context) {
  const player = requirePlayer(ctx);
  const rows = ctx.db
    .prepare(
      'SELECT * FROM races WHERE player0 = ? OR player1 = ? ORDER BY updated_at DESC',
    )
    .all(player.id, player.id) as unknown as RaceRow[];
  return rows.map((race) => view(ctx.db, race, player.id));
}

export function getRace(ctx: Context, raceId: string) {
  const player = requirePlayer(ctx);
  const race = raceById(ctx.db, raceId);
  if (!race) throw new ApiError(404, 'No such race.');
  return view(ctx.db, race, player.id);
}

/**
 * Record a player's circuit as it stands.
 *
 * Sent while they build rather than only when finished: it keeps the closeness
 * tiebreak honest if the clock runs out, and a dropped connection does not
 * erase the work. The recorded score is the BEST solve, so tinkering after
 * solving can never make your result worse.
 */
export function submitRace(ctx: Context, raceId: string, body: unknown) {
  const player = requirePlayer(ctx);
  const race = raceById(ctx.db, raceId);
  if (!race) throw new ApiError(404, 'No such race.');
  const seat = seatOf(race, player.id);

  if (race.result !== null) throw new ApiError(409, 'This race is over.');
  // Past the buzzer: settle and hand back the verdict rather than an error.
  if (msLeft(race) <= 0) return view(ctx.db, race, player.id);

  const raw = (body ?? {}) as { circuit?: unknown };
  let rebuilt;
  try {
    rebuilt = fromWire(raw.circuit, { maxNodes: 200 });
  } catch (error) {
    throw new ApiError(
      400,
      error instanceof CircuitError ? error.message : 'Unreadable circuit.',
    );
  }

  if (rebuilt.circuit.inputCount !== race.input_count) {
    throw new ApiError(400, 'That circuit has the wrong number of inputs.');
  }

  const target = BigInt(race.target);
  const produced = evaluateOutput(rebuilt.circuit, rebuilt.registry);
  const solved = produced !== null && produced === target;
  const score = totalScore(rebuilt.circuit, rebuilt.registry);
  const close =
    produced === null ? 0 : rowsMatching(produced, target, race.input_count);

  const now = Date.now();
  const wasSolvedAt = seat === 0 ? race.solved0_at : race.solved1_at;
  const bestScore = seat === 0 ? race.score0 : race.score1;
  const bestClose = seat === 0 ? race.close0 : race.close1;

  const keepScore = solved
    ? bestScore === null
      ? score
      : Math.min(bestScore, score)
    : bestScore;
  const keepSolvedAt = solved ? (wasSolvedAt ?? now) : wasSolvedAt;

  const columns =
    seat === 0
      ? 'circuit0 = ?, score0 = ?, solved0_at = ?, close0 = ?'
      : 'circuit1 = ?, score1 = ?, solved1_at = ?, close1 = ?';

  ctx.db
    .prepare(`UPDATE races SET ${columns}, updated_at = ? WHERE id = ?`)
    .run(
      JSON.stringify(raw.circuit),
      keepScore,
      keepSolvedAt,
      Math.max(close, bestClose),
      now,
      raceId,
    );

  const updated = raceById(ctx.db, raceId);
  if (!updated) throw new ApiError(500, 'Race vanished.');
  return view(ctx.db, updated, player.id);
}
