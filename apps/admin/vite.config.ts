import { defineConfig } from 'vite';

export default defineConfig({
  base: '/admin/',
  esbuild: { jsx: 'automatic', jsxImportSource: 'preact' },
  build: { outDir: 'dist', emptyOutDir: true, target: 'es2019' },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3000',
      '/media': 'http://localhost:3000',
      '/player': 'http://localhost:3000',
      '/tv': 'http://localhost:3000',
      '/ws': { target: 'ws://localhost:3000', ws: true },
    },
  },
});
