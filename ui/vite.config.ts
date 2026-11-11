import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The UI talks to the Scoped Runner server (server.mjs) through this proxy, so the browser
// only ever sees one origin. The server accepts requests whose Host is this machine on any
// port, and a POST whose Origin matches that Host, so the proxy must keep both unchanged
// (changeOrigin stays off).
//
//   npm run dev                  -> server on 4317 (npm start, or npm run start:fake)
//   npm run dev -- --mode fake   -> server on 4321 (node server.mjs --fake --port 4321), UI on 5174
//   RUNNER_URL=http://127.0.0.1:N npm run dev   for anywhere else
export default defineConfig(({ mode }) => {
  const target = process.env.RUNNER_URL ?? (mode === 'fake' ? 'http://127.0.0.1:4321' : 'http://127.0.0.1:4317');
  return {
    plugins: [react()],
    server: {
      host: '127.0.0.1',
      port: mode === 'fake' ? 5174 : 5173,
      strictPort: true,
      proxy: { '/api': { target, changeOrigin: false } },
    },
    build: { outDir: 'dist', chunkSizeWarningLimit: 900 },
  };
});
