import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  root: fileURLToPath(new URL('./src', import.meta.url)),
  base: '/',
  css: { postcss: fileURLToPath(new URL('../..', import.meta.url)) },
  server: {
    host: 'localhost', port: 5174, strictPort: true,
    proxy: {
      '/api': { target: 'http://127.0.0.1:8711', changeOrigin: true, ws: true },
      '/mcp': { target: 'http://127.0.0.1:8711', changeOrigin: true },
    },
  },
  build: { outDir: fileURLToPath(new URL('./dist', import.meta.url)), emptyOutDir: true },
});
