import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  // The plugin runs the Worker (src/server/worker.ts + Durable Objects) inside `vite dev`, so /ws and /api just work.
  plugins: [cloudflare()],
  server: { port: 5173 },
  // three.js is a big part of the bundle; that's expected.
  build: { outDir: 'dist', target: 'es2022', chunkSizeWarningLimit: 1000 },
});
