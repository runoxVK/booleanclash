import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
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
});
