import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { extname, join, normalize, resolve, sep } from 'node:path';
import * as api from './api.js';
import * as race from './race.js';
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
const HOST = process.env.HOST ?? '0.0.0.0';

/**
 * Where the built client lives, if it has been built.
 *
 * Serving the app from the same process is what makes this shareable: one URL,
 * one origin, no CORS, nothing for a friend to configure. Without a build the
 * server is still a plain API and the dev server handles the UI.
 */
const CLIENT_DIR = resolve(
  process.env.CLIENT_DIR ?? 'packages/app/dist',
);

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

/**
 * Serve a file from the built client. Returns false if there is nothing to send,
 * so the caller can fall through to the API's own 404.
 *
 * Paths are normalised and confined to CLIENT_DIR: a request for
 * ../../etc/passwd must not escape, and this is reachable from the internet.
 */
async function serveClient(
  req: IncomingMessage,
  res: ServerResponse,
  path: string,
): Promise<boolean> {
  const wanted = path === '/' ? '/index.html' : path;
  const full = join(CLIENT_DIR, normalize(wanted));
  if (full !== CLIENT_DIR && !full.startsWith(CLIENT_DIR + sep)) return false;

  let body: Buffer;
  try {
    const info = await stat(full);
    if (!info.isFile()) return false;
    body = await readFile(full);
  } catch {
    return false;
  }

  const type = MIME[extname(full).toLowerCase()] ?? 'application/octet-stream';
  /* Vite fingerprints asset filenames, so those are safe to cache hard; the
     entry HTML must never be, or a deploy will not reach anyone. */
  const cache = full.includes(`${sep}assets${sep}`)
    ? 'public, max-age=31536000, immutable'
    : 'no-cache';

  res.writeHead(200, {
    'content-type': type,
    'content-length': body.byteLength,
    'cache-control': cache,
  });
  res.end(req.method === 'HEAD' ? undefined : body);
  return true;
}
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

  { method: 'GET', pattern: /^\/api\/race-seeks$/, handler: (c) => race.listRaceSeeks(c) },
  { method: 'POST', pattern: /^\/api\/race-seeks$/, handler: (c, _p, b) => race.createRaceSeek(c, b) },
  { method: 'DELETE', pattern: /^\/api\/race-seeks\/([\w-]+)$/, handler: (c, p) => race.cancelRaceSeek(c, p[0]) },
  { method: 'POST', pattern: /^\/api\/race-seeks\/([\w-]+)\/accept$/, handler: (c, p) => race.acceptRaceSeek(c, p[0]) },

  { method: 'GET', pattern: /^\/api\/races$/, handler: (c) => race.myRaces(c) },
  { method: 'GET', pattern: /^\/api\/races\/([\w-]+)$/, handler: (c, p) => race.getRace(c, p[0]) },
  { method: 'POST', pattern: /^\/api\/races\/([\w-]+)\/submit$/, handler: (c, p, b) => race.submitRace(c, p[0], b) },
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

const ENDPOINTS = [
  ['POST', '/api/players', 'Create a player. Body: {handle}. Returns a token — keep it.'],
  ['GET', '/api/me', 'Who am I? Needs Authorization: Bearer <token>.'],
  ['GET', '/api/seeks', 'Open challenges waiting for an opponent.'],
  ['POST', '/api/seeks', 'Post a challenge. Body: {inputCount: 3 | 4 | 5}.'],
  ['DELETE', '/api/seeks/:id', 'Withdraw your challenge.'],
  ['POST', '/api/seeks/:id/accept', 'Accept a challenge and start a game.'],
  ['GET', '/api/games', 'Your games, most recently moved first.'],
  ['GET', '/api/games/:id', 'One game: the puzzle and every move played.'],
  ['POST', '/api/games/:id/moves', 'Play a move. Body: {move, expectedPly}.'],
  ['GET', '/api/race-seeks', 'Open race challenges (separate boards, one clock).'],
  ['POST', '/api/race-seeks', 'Post a race challenge. Body: {inputCount, timeLimitMs}.'],
  ['DELETE', '/api/race-seeks/:id', 'Withdraw your race challenge.'],
  ['POST', '/api/race-seeks/:id/accept', 'Accept a race challenge and start it.'],
  ['GET', '/api/races', 'Your races.'],
  ['GET', '/api/races/:id', 'One race: your board, the opponent status, the clock.'],
  ['POST', '/api/races/:id/submit', 'Record your circuit. Body: {circuit}.'],
] as const;

/**
 * Opening the API root in a browser used to return a bare 404, which is a
 * miserable first impression when you are trying to work out whether the thing
 * is even running. It answers for itself now.
 */
function sendIndex(res: ServerResponse, wantsHtml: boolean): void {
  if (!wantsHtml) {
    send(res, 200, {
      name: 'logiclash-server',
      status: 'ok',
      note: 'This is the API. The game UI is a separate dev server on port 5173.',
      endpoints: ENDPOINTS.map(([method, path, note]) => ({ method, path, note })),
    });
    return;
  }

  /* Notes contain things like <token>, which a browser would happily swallow as
     a tag. The JSON view keeps them literal, so escaping belongs here. */
  const escape = (text: string) =>
    text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');

  const rows = ENDPOINTS.map(
    ([method, path, note]) =>
      `<tr><td class="m">${method}</td><td><code>${escape(path)}</code></td><td>${escape(note)}</td></tr>`,
  ).join('');

  const html = `<!doctype html>
<meta charset="utf-8"><title>Logiclash server</title>
<style>
  body { font: 15px/1.6 ui-sans-serif, system-ui, sans-serif; color: #1c1c1a;
         background: #f6f6f4; margin: 0; padding: 40px 24px; }
  main { max-width: 780px; margin: 0 auto; }
  h1 { font-size: 20px; letter-spacing: .06em; text-transform: uppercase; }
  p { max-width: 62ch; color: #55544e; }
  table { border-collapse: collapse; width: 100%; margin-top: 20px; font-size: 13.5px; }
  th { text-align: left; font-size: 10.5px; letter-spacing: .1em; text-transform: uppercase;
       color: #75746d; border-bottom: 1.5px solid #111; padding: 4px 10px 6px 0; }
  td { padding: 7px 10px 7px 0; border-bottom: 1px solid #dcdbd4; vertical-align: top; }
  td.m { font: 700 11px ui-monospace, monospace; color: #1668c4; white-space: nowrap; }
  code { background: #eceae3; border: 1px solid #dcdbd4; border-radius: 3px; padding: 1px 5px;
         font-size: 12.5px; }
  .ok { color: #1c8f4a; font-weight: 700; }
</style>
<main>
  <h1>Logiclash server</h1>
  <p><span class="ok">Running.</span> This is the multiplayer API — there is no
     website here. The game itself is a separate dev server, normally on
     <code>http://localhost:5173</code>.</p>
  <p>Everything below needs <code>Authorization: Bearer &lt;token&gt;</code>
     except creating a player and listing open challenges.</p>
  <table>
    <tr><th>Method</th><th>Path</th><th>What it does</th></tr>
    ${rows}
  </table>
</main>`;

  res.writeHead(200, {
    'content-type': 'text/html; charset=utf-8',
    'content-length': Buffer.byteLength(html),
    'cache-control': 'no-store',
  });
  res.end(html);
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

    /* The built client, when there is one. Checked before the API index so that
       visiting the root gets the game rather than a list of endpoints. */
    if ((req.method === 'GET' || req.method === 'HEAD') && !path.startsWith('/api')) {
      if (await serveClient(req, res, path)) return;
    }

    if (req.method === 'GET' && (path === '/' || path === '/api')) {
      const accept = req.headers.accept ?? '';
      sendIndex(res, accept.includes('text/html'));
      return;
    }

    const route = routes.find(
      (r) => r.method === req.method && r.pattern.test(path),
    );

    if (!route) {
      send(res, 404, {
        error: `No such endpoint: ${req.method} ${path}`,
        hint: 'Open / for the list of endpoints.',
      });
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

server.listen(PORT, HOST, () => {
  console.log(`Logiclash server on http://localhost:${PORT}  (db: ${DB_FILE})`);
});
