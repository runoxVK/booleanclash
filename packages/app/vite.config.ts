import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * `base` only applies to production builds. GitHub Pages serves a project repo
 * from /<repo>/, so assets need that prefix — but applying it in dev would move
 * the dev server to localhost:5173/booleanclash/ for no reason.
 *
 * Deploying somewhere that serves from the root (Vercel, Netlify, a custom
 * domain) instead? Set BASE_PATH=/ and this gets out of the way.
 */
const BASE = process.env.BASE_PATH ?? '/booleanclash/';

// Keyed on `mode`, not `command`: `vite preview` reports command 'serve' just
// like the dev server, so keying on command would serve the built site from '/'
// while its HTML asks for '/booleanclash/' — a blank page that only shows up
// when you actually load the production bundle.
export default defineConfig(({ mode }) => ({
  base: mode === 'production' ? BASE : '/',
  plugins: [react()],
  resolve: {
    alias: {
      // Point straight at the engine's TypeScript source so edits there show up
      // instantly without a build step.
      '@logiclash/engine': fileURLToPath(
        new URL('../engine/src/index.ts', import.meta.url),
      ),
    },
  },
  server: { port: 5173 },
}));
