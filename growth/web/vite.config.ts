import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
// Built into ../dist and served by the Worker behind authentication. Relative base so it works under /growth/.
export default defineConfig({
  root: __dirname,
  base: './',
  plugins: [react()],
  build: { outDir: '../dist', emptyOutDir: true, sourcemap: false },
  server: { proxy: { '/api': 'http://127.0.0.1:8787' } },
});
