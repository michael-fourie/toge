import { cloudflare } from '@cloudflare/vite-plugin';
import { defineConfig } from 'vite';

export default defineConfig({
  // The plugin runs the Worker (src/server/worker.ts + Durable Objects) inside `vite dev`, so /ws and /api just work.
  plugins: [cloudflare()],
  server: { port: 5173 },
  // three.js is most of the bundle (~155 kB gzipped); that's expected.
  build: { outDir: 'dist', target: 'es2022', chunkSizeWarningLimit: 800 },
});
