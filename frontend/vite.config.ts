import react from '@vitejs/plugin-react';
import { defineConfig } from 'vitest/config';

// In development the API runs on :8000; the proxy keeps the browser on one origin.
export default defineConfig({
  plugins: [react()],
  // three.js is most of the bundle; its own chunk caches across app releases.
  build: { chunkSizeWarningLimit: 700, rollupOptions: { output: { manualChunks: { three: ['three'] } } } },
  server: { port: 5173, proxy: { '/api': { target: 'http://localhost:8000', changeOrigin: true } } },
  test: { environment: 'node', include: ['src/**/*.test.ts'] },
});
