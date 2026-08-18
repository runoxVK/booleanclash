import type { DuelMove, DuelResult } from '@logiclash/engine';

/**
 * Talking to the duel server.
 *
 * Turn-based play needs no sockets — the client asks again every few seconds
 * while it is waiting, which at correspondence pace costs nothing and removes a
 * whole category of connection handling.
 *
 * The token is the whole of authentication for now: created once, kept in
 * localStorage, sent as a bearer header. That is deliberately thin, and is the
 * first thing to replace before this faces the public internet.
 */

/**
 * Where the API lives.
 *
 * In production the server serves this bundle itself, so an empty base means
 * same-origin — which is what makes the whole thing shareable as one URL, with
 * no CORS and nothing to configure. In dev the app runs on Vite's port while the
 * API runs on its own, so point at it explicitly. VITE_SERVER overrides both.
 */
const BASE: string =
  (import.meta.env.VITE_SERVER as string | undefined) ??
  (import.meta.env.DEV ? 'http://localhost:8787' : '');

const TOKEN_KEY = 'logiclash.token.v1';

export function savedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

function keepToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Private browsing. The session still works, it just will not survive a reload.
  }
}

export function forgetToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Nothing to do.
  }
}

/** A failure the server explained, as opposed to the network falling over. */
export class NetError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = 'NetError';
  }
}

async function request<T>(
  method: string,
  path: string,
  body?: unknown,
): Promise<T> {
  const token = savedToken();
  let response: Response;

  try {
    response = await fetch(`${BASE}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new NetError(
      0,
      `Cannot reach the server at ${BASE}. Is it running? (npm run server)`,
    );
  }

  const text = await response.text();
  const payload: unknown = text.length > 0 ? JSON.parse(text) : null;

  if (!response.ok) {
    const message =
      typeof payload === 'object' &&
      payload !== null &&
      typeof (payload as { error?: unknown }).error === 'string'
        ? (payload as { error: string }).error
        : `Request failed (${response.status}).`;
    throw new NetError(response.status, message);
  }

  return payload as T;
}

/* ------------------------------------------------------------------ */
/* Shapes the server sends back                                       */
/* ------------------------------------------------------------------ */

export interface Player {
  readonly id: string;
  readonly handle: string;
  readonly rating: number;
}

export interface Seek {
  readonly id: string;
  readonly inputCount: number;
  readonly player: {
    readonly id: string;
    readonly handle: string;
    readonly rating: number;
  };
  readonly createdAt: number;
}

/** Target arrives as a string: JSON has no bigint. */
export interface GameView {
  readonly id: string;
  readonly players: readonly {
    readonly id: string;
    readonly handle: string;
    readonly rating: number;
  }[];
  readonly puzzle: { readonly inputCount: number; readonly target: string };
  readonly moves: readonly DuelMove[];
  readonly ply: number;
  readonly turn: 0 | 1;
  readonly result: DuelResult | null;
  readonly createdAt: number;
  readonly updatedAt: number;
}

export interface RaceSeek {
  readonly id: string;
  readonly inputCount: number;
  readonly timeLimitMs: number;
  readonly createdAt: number;
  readonly player: {
    readonly id: string;
    readonly handle: string;
    readonly rating: number;
  };
}

export type RaceResult =
  | {
      readonly kind: 'win';
      readonly winner: 0 | 1;
      readonly reason: 'fewer-parts' | 'faster' | 'only-solver' | 'closer';
    }
  | { readonly kind: 'draw'; readonly reason: 'identical' | 'neither-solved' };

export interface RaceSide {
  readonly score: number | null;
  readonly solvedAt: number | null;
  /** Rows of the target matched — the tiebreak if the clock runs out. */
  readonly close: number;
  /** Your own always; the opponent's only once the race is over. */
  readonly circuit: unknown | null;
}

export interface RaceView {
  readonly id: string;
  readonly kind: 'race';
  readonly players: readonly {
    readonly id: string;
    readonly handle: string;
    readonly rating: number;
  }[];
  readonly seat: 0 | 1;
  readonly puzzle: { readonly inputCount: number; readonly target: string };
  readonly par: number;
  readonly timeLimitMs: number;
  readonly startedAt: number;
  readonly msLeft: number;
  readonly you: RaceSide;
  readonly opponent: RaceSide;
  readonly result: RaceResult | null;
}

/* ------------------------------------------------------------------ */
/* Calls                                                              */
/* ------------------------------------------------------------------ */

export const net = {
  async signUp(handle: string): Promise<Player> {
    const player = await request<Player & { token: string }>(
      'POST',
      '/api/players',
      { handle },
    );
    keepToken(player.token);
    return player;
  },

  me(): Promise<Player> {
    return request<Player>('GET', '/api/me');
  },

  listSeeks(): Promise<Seek[]> {
    return request<Seek[]>('GET', '/api/seeks');
  },

  createSeek(inputCount: number): Promise<{ id: string }> {
    return request<{ id: string }>('POST', '/api/seeks', { inputCount });
  },

  cancelSeek(id: string): Promise<unknown> {
    return request('DELETE', `/api/seeks/${id}`);
  },

  /** Returns the freshly created game, not just its id. */
  acceptSeek(id: string): Promise<GameView> {
    return request<GameView>('POST', `/api/seeks/${id}/accept`);
  },

  myGames(): Promise<GameView[]> {
    return request<GameView[]>('GET', '/api/games');
  },

  getGame(id: string): Promise<GameView> {
    return request<GameView>('GET', `/api/games/${id}`);
  },

  /**
   * Send a move. `expectedPly` is the ply the client believed it was on, so the
   * server can reject a move composed against a stale board rather than
   * applying it to a position the player never saw.
   */
  postMove(id: string, move: DuelMove, expectedPly: number): Promise<GameView> {
    return request<GameView>('POST', `/api/games/${id}/moves`, {
      move,
      expectedPly,
    });
  },

  /* ---- races: separate boards, one clock ---- */

  listRaceSeeks(): Promise<RaceSeek[]> {
    return request<RaceSeek[]>('GET', '/api/race-seeks');
  },

  createRaceSeek(inputCount: number, timeLimitMs: number): Promise<{ id: string }> {
    return request<{ id: string }>('POST', '/api/race-seeks', {
      inputCount,
      timeLimitMs,
    });
  },

  cancelRaceSeek(id: string): Promise<unknown> {
    return request('DELETE', `/api/race-seeks/${id}`);
  },

  acceptRaceSeek(id: string): Promise<RaceView> {
    return request<RaceView>('POST', `/api/race-seeks/${id}/accept`);
  },

  myRaces(): Promise<RaceView[]> {
    return request<RaceView[]>('GET', '/api/races');
  },

  getRace(id: string): Promise<RaceView> {
    return request<RaceView>('GET', `/api/races/${id}`);
  },

  /** Record the circuit as it stands. The server scores it, not the client. */
  submitRace(id: string, circuit: unknown): Promise<RaceView> {
    return request<RaceView>('POST', `/api/races/${id}/submit`, { circuit });
  },
};
