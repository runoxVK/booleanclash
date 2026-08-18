import type { DatabaseSync } from 'node:sqlite';
import {
  applyMove,
  generatePuzzle,
  replay,
  type DuelMove,
  type DuelPuzzle,
} from '@logiclash/engine';
import {
  createPlayer,
  gameById,
  gamesForPlayer,
  newId,
  openSeeks,
  playerById,
  playerByToken,
  setRating,
  type GameRow,
  type PlayerRow,
} from './db.js';
import { updateRatings } from './elo.js';

/**
 * The API.
 *
 * Every route that changes a game replays the whole move list through the
 * engine before deciding anything. The client is never believed about the
 * position — only about which move it would like to make next.
 */

export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

const HANDLE = /^[A-Za-z0-9_-]{2,20}$/;

export interface Context {
  readonly db: DatabaseSync;
  readonly player: PlayerRow | null;
}

export function requirePlayer(ctx: Context): PlayerRow {
  if (!ctx.player) throw new ApiError(401, 'Sign in first.');
  return ctx.player;
}

function puzzleOf(game: GameRow): DuelPuzzle {
  return { inputCount: game.input_count, target: BigInt(game.target) };
}

function movesOf(game: GameRow): DuelMove[] {
  return JSON.parse(game.moves) as DuelMove[];
}

/**
 * The public shape of a game.
 *
 * Deliberately the puzzle plus the moves, not a serialized board: the client
 * replays them with the same engine the server used, so there is exactly one
 * implementation of what a position means.
 */
function viewGame(db: DatabaseSync, game: GameRow) {
  const moves = movesOf(game);
  const outcome = replay(puzzleOf(game), moves);
  const p0 = playerById(db, game.player0);
  const p1 = playerById(db, game.player1);

  return {
    id: game.id,
    players: [
      { id: p0?.id, handle: p0?.handle, rating: p0?.rating },
      { id: p1?.id, handle: p1?.handle, rating: p1?.rating },
    ],
    puzzle: { inputCount: game.input_count, target: game.target },
    moves,
    ply: moves.length,
    turn: outcome.ok ? outcome.state.turn : 0,
    result: game.result ? JSON.parse(game.result) : null,
    createdAt: game.created_at,
    updatedAt: game.updated_at,
  };
}

/* ------------------------------------------------------------------ */
/* Handlers                                                           */
/* ------------------------------------------------------------------ */

export function signUp(ctx: Context, body: unknown) {
  const handle = (body as { handle?: unknown })?.handle;
  if (typeof handle !== 'string' || !HANDLE.test(handle)) {
    throw new ApiError(
      400,
      'Handles are 2-20 characters: letters, digits, dash, underscore.',
    );
  }

  const taken = ctx.db
    .prepare('SELECT id FROM players WHERE handle = ?')
    .get(handle);
  if (taken) throw new ApiError(409, 'That handle is taken.');

  const { player, token } = createPlayer(ctx.db, handle);
  /* The only time the token is ever readable. There is no password to reset,
     so the client must keep this; that is the trade for having no passwords to
     leak in the first place. */
  return { ...player, token };
}

export function me(ctx: Context) {
  return requirePlayer(ctx);
}

export function listSeeks(ctx: Context) {
  return openSeeks(ctx.db).map((seek) => {
    const player = playerById(ctx.db, seek.player_id);
    return {
      id: seek.id,
      inputCount: seek.input_count,
      createdAt: seek.created_at,
      player: { id: player?.id, handle: player?.handle, rating: player?.rating },
    };
  });
}

export function createSeek(ctx: Context, body: unknown) {
  const player = requirePlayer(ctx);
  const raw = (body as { inputCount?: unknown })?.inputCount;
  const inputCount = typeof raw === 'number' ? raw : 4;
  if (![3, 4, 5].includes(inputCount)) {
    throw new ApiError(400, 'Duels run on 3, 4 or 5 inputs.');
  }

  const existing = ctx.db
    .prepare('SELECT id FROM seeks WHERE player_id = ? AND game_id IS NULL')
    .get(player.id);
  if (existing) throw new ApiError(409, 'You already have an open challenge.');

  const id = newId();
  ctx.db
    .prepare(
      `INSERT INTO seeks (id, player_id, input_count, created_at) VALUES (?, ?, ?, ?)`,
    )
    .run(id, player.id, inputCount, Date.now());
  return { id, inputCount };
}

export function cancelSeek(ctx: Context, seekId: string) {
  const player = requirePlayer(ctx);
  const changed = ctx.db
    .prepare('DELETE FROM seeks WHERE id = ? AND player_id = ? AND game_id IS NULL')
    .run(seekId, player.id);
  if (changed.changes === 0) throw new ApiError(404, 'No such open challenge.');
  return { ok: true };
}

export function acceptSeek(ctx: Context, seekId: string) {
  const player = requirePlayer(ctx);
  const seek = ctx.db
    .prepare('SELECT * FROM seeks WHERE id = ? AND game_id IS NULL')
    .get(seekId) as { id: string; player_id: string; input_count: number } | undefined;

  if (!seek) throw new ApiError(404, 'That challenge is gone.');
  if (seek.player_id === player.id) {
    throw new ApiError(400, 'You cannot accept your own challenge.');
  }

  /* Seeded from a random number, so neither player can look the puzzle up in
     advance, and the seed is enough to reproduce the whole game later. */
  const seed = Math.floor(Math.random() * 2 ** 31);
  const generated = generatePuzzle(seed, seek.input_count);

  const gameId = newId();
  const now = Date.now();
  ctx.db
    .prepare(
      `INSERT INTO games (id, player0, player1, input_count, target, moves, result, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, '[]', NULL, ?, ?)`,
    )
    .run(
      gameId,
      seek.player_id,
      player.id,
      seek.input_count,
      `0x${generated.target.toString(16)}`,
      now,
      now,
    );
  ctx.db.prepare('UPDATE seeks SET game_id = ? WHERE id = ?').run(gameId, seekId);

  const game = gameById(ctx.db, gameId);
  if (!game) throw new ApiError(500, 'Game vanished.');
  return viewGame(ctx.db, game);
}

export function getGame(ctx: Context, gameId: string) {
  const game = gameById(ctx.db, gameId);
  if (!game) throw new ApiError(404, 'No such game.');
  return viewGame(ctx.db, game);
}

export function myGames(ctx: Context) {
  const player = requirePlayer(ctx);
  return gamesForPlayer(ctx.db, player.id).map((game) =>
    viewGame(ctx.db, game),
  );
}

export function postMove(ctx: Context, gameId: string, body: unknown) {
  const player = requirePlayer(ctx);
  const game = gameById(ctx.db, gameId);
  if (!game) throw new ApiError(404, 'No such game.');
  if (game.result) throw new ApiError(409, 'That game has finished.');

  const seat: 0 | 1 | null =
    game.player0 === player.id ? 0 : game.player1 === player.id ? 1 : null;
  if (seat === null) throw new ApiError(403, 'You are not in this game.');

  const move = (body as { move?: unknown })?.move as DuelMove | undefined;
  if (!move || typeof move !== 'object' || typeof move.kind !== 'string') {
    throw new ApiError(400, 'Send a move.');
  }

  const moves = movesOf(game);

  /* Optimistic concurrency. Two taps on a flaky connection should not play the
     same move twice, and a stale client should be told to refresh rather than
     silently moving from a position it is no longer looking at. */
  const expected = (body as { expectedPly?: unknown })?.expectedPly;
  if (typeof expected === 'number' && expected !== moves.length) {
    throw new ApiError(409, 'The game has moved on; reload it.');
  }

  const current = replay(puzzleOf(game), moves);
  if (!current.ok) throw new ApiError(500, 'Stored game will not replay.');

  const outcome = applyMove(current.state, seat, move);
  if (!outcome.ok) throw new ApiError(400, outcome.detail);

  const nextMoves = [...moves, move];
  const result = outcome.state.result;
  const now = Date.now();

  ctx.db
    .prepare(
      `UPDATE games SET moves = ?, result = ?, updated_at = ? WHERE id = ?`,
    )
    .run(
      JSON.stringify(nextMoves),
      result ? JSON.stringify(result) : null,
      now,
      game.id,
    );

  if (result) settleRatings(ctx.db, game, result);

  const updated = gameById(ctx.db, game.id);
  if (!updated) throw new ApiError(500, 'Game vanished.');
  return viewGame(ctx.db, updated);
}

/** Move rating between two players by id. Shared with races. */
export function applyRating(
  db: DatabaseSync,
  player0: string,
  player1: string,
  scoreForP0: number,
): void {
  const p0 = playerById(db, player0);
  const p1 = playerById(db, player1);
  if (!p0 || !p1) return;

  const next = updateRatings(p0.rating, p1.rating, scoreForP0);
  setRating(db, p0.id, next.a);
  setRating(db, p1.id, next.b);
}

function settleRatings(
  db: DatabaseSync,
  game: GameRow,
  result: { kind: string; winner?: number },
): void {
  applyRating(
    db,
    game.player0,
    game.player1,
    result.kind === 'draw' ? 0.5 : result.winner === 0 ? 1 : 0,
  );
}

export { playerByToken };
