import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import * as api from './api.js';
import { ApiError } from './api.js';
import { openDatabase } from './db.js';

/**
 * HTTP front door.
 *
 * Hand-rolled on node:http rather than a framework: the surface is eight
 * routes, and the engine already has zero dependencies. Keeping the server the
 * same way means the whole thing installs with nothing to compile.
 *
 * Turn-based play needs no sockets. Clients poll, which at correspondence pace
 * is a rounding error and removes an entire class of connection handling.
 */

const PORT = Number(process.env.PORT ?? 8787);
const DB_FILE = process.env.DB_FILE ?? 'logiclash.db';
const db = openDatabase(DB_FILE);

type Handler = (ctx: api.Context, params: string[], body: unknown) => unknown;

const routes: {
  method: string;
  pattern: RegExp;
  handler: Handler;
}[] = [
  { method: 'POST', pattern: /^\/api\/players$/, handler: (c, _p, b) => api.signUp(c, b) },
  { method: 'GET', pattern: /^\/api\/me$/, handler: (c) => api.me(c) },

  { method: 'GET', pattern: /^\/api\/seeks$/, handler: (c) => api.listSeeks(c) },
  { method: 'POST', pattern: /^\/api\/seeks$/, handler: (c, _p, b) => api.createSeek(c, b) },
  { method: 'DELETE', pattern: /^\/api\/seeks\/([\w-]+)$/, handler: (c, p) => api.cancelSeek(c, p[0]) },
  { method: 'POST', pattern: /^\/api\/seeks\/([\w-]+)\/accept$/, handler: (c, p) => api.acceptSeek(c, p[0]) },

  { method: 'GET', pattern: /^\/api\/games$/, handler: (c) => api.myGames(c) },
  { method: 'GET', pattern: /^\/api\/games\/([\w-]+)$/, handler: (c, p) => api.getGame(c, p[0]) },
  { method: 'POST', pattern: /^\/api\/games\/([\w-]+)\/moves$/, handler: (c, p, b) => api.postMove(c, p[0], b) },
];

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      // A move is a few hundred bytes; anything larger is not a move.
      if (size > 64 * 1024) {
        reject(new ApiError(413, 'Request too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (raw.length === 0) return resolve(undefined);
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new ApiError(400, 'Body must be JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function send(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload ?? null);
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'content-length': Buffer.byteLength(body),
    'cache-control': 'no-store',
  });
  res.end(body);
}

const server = createServer((req, res) => {
  void (async () => {
    // Dev clients are served from a different port, so allow cross-origin.
    // Tighten to a known origin before this is public.
    res.setHeader('access-control-allow-origin', '*');
    res.setHeader('access-control-allow-headers', 'content-type, authorization');
    res.setHeader('access-control-allow-methods', 'GET, POST, DELETE, OPTIONS');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    const path = (req.url ?? '/').split('?')[0];
    const route = routes.find(
      (r) => r.method === req.method && r.pattern.test(path),
    );

    if (!route) {
      send(res, 404, { error: 'No such endpoint.' });
      return;
    }

    try {
      const body = await readBody(req);
      const header = req.headers.authorization ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      const player = token ? api.playerByToken(db, token) : null;

      const params = route.pattern.exec(path)?.slice(1) ?? [];
      const result = route.handler({ db, player }, params, body);
      send(res, 200, result);
    } catch (error) {
      if (error instanceof ApiError) {
        send(res, error.status, { error: error.message });
        return;
      }
      console.error('unhandled', error);
      send(res, 500, { error: 'Something went wrong.' });
    }
  })();
});

server.listen(PORT, () => {
  console.log(`Logiclash server on http://localhost:${PORT}  (db: ${DB_FILE})`);
});
