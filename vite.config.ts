import { defineConfig } from 'vite';

const SERVER_PORT = Number(process.env.PORT ?? 3001);

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      // Game server websocket; in production the server serves the client itself.
      '/ws': { target: `ws://localhost:${SERVER_PORT}`, ws: true },
    },
  },
  // three.js is most of the bundle (~155 kB gzipped); that's expected.
  build: { outDir: 'dist', target: 'es2022', chunkSizeWarningLimit: 800 },
});
