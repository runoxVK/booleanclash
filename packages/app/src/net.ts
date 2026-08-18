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

const BASE: string =
  (import.meta.env.VITE_SERVER as string | undefined) ?? 'http://localhost:8787';

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
};
