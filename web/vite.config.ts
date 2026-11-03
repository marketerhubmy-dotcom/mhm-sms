import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const root = fileURLToPath(new URL('.', import.meta.url));
const api = process.env.API_ORIGIN ?? 'http://127.0.0.1:8787';

export default defineConfig({
  root,
  plugins: [react()],
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false },
  server: { host: '0.0.0.0', port: 5173, proxy: { '/api': { target: api, changeOrigin: false } } },
  preview: { host: '0.0.0.0', port: 4173, proxy: { '/api': { target: api, changeOrigin: false } } },
});
