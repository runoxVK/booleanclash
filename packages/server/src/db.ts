import { createHash, randomUUID, randomBytes } from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { START_RATING } from './elo.js';

/**
 * Storage.
 *
 * SQLite through Node's built-in driver: one file, no service to run, no native
 * module to compile. At correspondence pace — a handful of moves per player per
 * day — this will not be the bottleneck for a very long time, and moving to
 * Postgres later is a schema port, not a rewrite.
 *
 * Games store the PUZZLE AND THE MOVE LIST, not the resulting board. The board
 * is always recomputed by replaying the moves through the engine, which means
 * the server never has to trust a client's idea of the position, and the move
 * list doubles as the anti-cheat trace we said we would collect from day one.
 */

export interface PlayerRow {
  id: string;
  handle: string;
  rating: number;
  created_at: number;
}

export interface GameRow {
  id: string;
  player0: string;
  player1: string;
  input_count: number;
  target: string;
  moves: string;
  result: string | null;
  created_at: number;
  updated_at: number;
}

export interface SeekRow {
  id: string;
  player_id: string;
  input_count: number;
  created_at: number;
  game_id: string | null;
}

export function openDatabase(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL');
  db.exec('PRAGMA foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS players (
      id          TEXT PRIMARY KEY,
      handle      TEXT NOT NULL UNIQUE,
      token_hash  TEXT NOT NULL UNIQUE,
      rating      INTEGER NOT NULL,
      created_at  INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS games (
      id           TEXT PRIMARY KEY,
      player0      TEXT NOT NULL REFERENCES players(id),
      player1      TEXT NOT NULL REFERENCES players(id),
      input_count  INTEGER NOT NULL,
      target       TEXT NOT NULL,
      moves        TEXT NOT NULL,
      result       TEXT,
      created_at   INTEGER NOT NULL,
      updated_at   INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS seeks (
      id           TEXT PRIMARY KEY,
      player_id    TEXT NOT NULL REFERENCES players(id),
      input_count  INTEGER NOT NULL,
      created_at   INTEGER NOT NULL,
      game_id      TEXT REFERENCES games(id)
    );

    CREATE INDEX IF NOT EXISTS games_player0 ON games(player0);
    CREATE INDEX IF NOT EXISTS games_player1 ON games(player1);
    CREATE INDEX IF NOT EXISTS seeks_open ON seeks(game_id);
  `);

  return db;
}

/**
 * Tokens are stored hashed, never in the clear.
 *
 * A token is the whole of a player's identity here, so a leaked database
 * should not hand out accounts. Hashing costs nothing and removes that.
 */
export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function newToken(): string {
  return randomBytes(32).toString('base64url');
}

export function newId(): string {
  return randomUUID();
}

export function createPlayer(
  db: DatabaseSync,
  handle: string,
): { player: PlayerRow; token: string } {
  const id = newId();
  const token = newToken();
  const now = Date.now();

  db.prepare(
    `INSERT INTO players (id, handle, token_hash, rating, created_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(id, handle, hashToken(token), START_RATING, now);

  return {
    player: { id, handle, rating: START_RATING, created_at: now },
    token,
  };
}

export function playerByToken(
  db: DatabaseSync,
  token: string,
): PlayerRow | null {
  const row = db
    .prepare(
      `SELECT id, handle, rating, created_at FROM players WHERE token_hash = ?`,
    )
    .get(hashToken(token));
  return (row as PlayerRow | undefined) ?? null;
}

export function playerById(db: DatabaseSync, id: string): PlayerRow | null {
  const row = db
    .prepare(`SELECT id, handle, rating, created_at FROM players WHERE id = ?`)
    .get(id);
  return (row as PlayerRow | undefined) ?? null;
}

export function setRating(db: DatabaseSync, id: string, rating: number): void {
  db.prepare(`UPDATE players SET rating = ? WHERE id = ?`).run(rating, id);
}

export function gameById(db: DatabaseSync, id: string): GameRow | null {
  const row = db.prepare(`SELECT * FROM games WHERE id = ?`).get(id);
  return (row as GameRow | undefined) ?? null;
}

export function gamesForPlayer(db: DatabaseSync, id: string): GameRow[] {
  return db
    .prepare(
      `SELECT * FROM games WHERE player0 = ? OR player1 = ?
       ORDER BY updated_at DESC LIMIT 50`,
    )
    .all(id, id) as unknown as GameRow[];
}

export function openSeeks(db: DatabaseSync): SeekRow[] {
  return db
    .prepare(
      `SELECT * FROM seeks WHERE game_id IS NULL ORDER BY created_at ASC LIMIT 50`,
    )
    .all() as unknown as SeekRow[];
}
