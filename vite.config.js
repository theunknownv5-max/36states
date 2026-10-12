import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  publicDir: 'public',
  server: {
    host: true,
    port: 5173,
    fs: { allow: ['..'] },
    proxy: {
      '/ws': { target: 'ws://localhost:2567', ws: true },
      '/api': 'http://localhost:2567',
      '/ads': 'http://localhost:2567',
      '/admin': 'http://localhost:2567'
    }
  },
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 }
});
