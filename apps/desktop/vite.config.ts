import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  plugins: [react()],
  root: fileURLToPath(new URL('./src/renderer', import.meta.url)),
  base: './',
  css: { postcss: fileURLToPath(new URL('../..', import.meta.url)) },
  server: { host: 'localhost', port: 5173, strictPort: true },
  build: {
    outDir: fileURLToPath(new URL('./dist/renderer', import.meta.url)),
    emptyOutDir: true,
  },
});
