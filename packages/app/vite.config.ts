import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

/**
 * Serve from the root by default, which is what local preview and every
 * drag-and-drop host (Netlify, Vercel, Cloudflare Pages) expect.
 *
 * GitHub Pages is the odd one out: a project repo is served from /<repo>/, so
 * that workflow sets BASE_PATH=/booleanclash/ instead of this being the default
 * and quietly breaking everywhere else.
 */
const BASE = process.env.BASE_PATH ?? '/';

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
